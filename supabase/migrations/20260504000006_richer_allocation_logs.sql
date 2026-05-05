-- ============================================================================
-- Richer allocation logs for all three FIFO allocation functions.
--
-- Every movement_log note now includes:
--   • Allocation ID + type + timestamp header
--   • Material, project, total qty, total cost
--   • Per-packaging-variant section with units issued + subtotal
--     └─ Per-batch row: batch#, date, units, packaging price, base price, cost
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. allocate_material_fifo  (auto-FIFO — crosses all price variants)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.allocate_material_fifo(
  p_material_id  BIGINT,
  p_project_id   BIGINT,
  p_required_qty NUMERIC(12,3)
)
RETURNS TABLE (
  allocation_id   BIGINT,
  total_allocated NUMERIC(12,3),
  total_cost      NUMERIC(14,2),
  breakdown       JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_allocation_id   BIGINT;
  v_remaining       NUMERIC(12,3) := p_required_qty;
  v_total_cost      NUMERIC(14,2) := 0;
  v_breakdown       JSONB         := '[]'::JSONB;
  v_batch_lines     TEXT[]        := ARRAY[]::TEXT[];
  v_qty_to_alloc    NUMERIC(12,3);
  v_floor_batch     NUMERIC(12,3);
  v_total_whole     NUMERIC(12,3);
  v_material_name   TEXT;
  v_metric          TEXT;
  v_project_name    TEXT;
  v_batch_units     NUMERIC(12,3);
  v_price_per_pkg   NUMERIC(14,2);
  r                 RECORD;
BEGIN
  IF p_required_qty IS NULL OR p_required_qty <= 0 THEN
    RAISE EXCEPTION 'required_qty must be > 0';
  END IF;

  SELECT material_name, metric INTO v_material_name, v_metric
  FROM public.materials_master WHERE material_id = p_material_id;
  IF v_material_name IS NULL THEN
    RAISE EXCEPTION 'Material % does not exist', p_material_id;
  END IF;

  SELECT project_name INTO v_project_name
  FROM public.projects WHERE project_id = p_project_id;
  IF v_project_name IS NULL THEN
    RAISE EXCEPTION 'Project % does not exist', p_project_id;
  END IF;

  SELECT COALESCE(SUM(FLOOR(b.quantity_available)), 0)
    INTO v_total_whole
  FROM public.material_stock_batches b
  JOIN public.material_price_variants v ON v.variant_id = b.variant_id
  WHERE v.material_id = p_material_id;

  IF v_total_whole < p_required_qty THEN
    RAISE EXCEPTION
      'Insufficient whole-unit stock for "%": need %, available = %',
      v_material_name, p_required_qty, v_total_whole;
  END IF;

  INSERT INTO public.material_allocations (
    material_id, project_id, allocated_quantity, status, allocated_by
  ) VALUES (
    p_material_id, p_project_id, p_required_qty, 'Reserved', auth.uid()
  )
  RETURNING material_allocations.allocation_id INTO v_allocation_id;

  FOR r IN
    SELECT b.batch_id,
           b.variant_id,
           b.batch_date,
           v.variant_name,
           v.unit_price,
           mv.variant_name    AS qty_variant_name,
           mv.quantity_per_unit
      FROM public.material_stock_batches b
      JOIN public.material_price_variants v  ON v.variant_id  = b.variant_id
      LEFT JOIN public.material_variants  mv ON mv.variant_id = v.quantity_variant_id
     WHERE v.material_id = p_material_id
       AND b.quantity_available >= 1
     ORDER BY b.batch_date ASC, b.batch_id ASC
     FOR UPDATE OF b
  LOOP
    EXIT WHEN v_remaining <= 0;

    v_floor_batch  := FLOOR(r.quantity_available);
    CONTINUE WHEN v_floor_batch <= 0;

    v_qty_to_alloc := LEAST(v_floor_batch, v_remaining);
    v_batch_units  := ROUND(v_qty_to_alloc / COALESCE(NULLIF(r.quantity_per_unit, 0), 1), 3);
    v_price_per_pkg := ROUND(r.unit_price * COALESCE(r.quantity_per_unit, 1), 2);

    INSERT INTO public.allocation_variant_breakdown (
      allocation_id, batch_id, variant_id, qty_allocated, unit_price
    ) VALUES (
      v_allocation_id, r.batch_id, r.variant_id, v_qty_to_alloc, r.unit_price
    );

    UPDATE public.material_stock_batches AS b
       SET quantity_available = b.quantity_available - v_qty_to_alloc
     WHERE b.batch_id = r.batch_id;

    v_breakdown := v_breakdown || jsonb_build_array(jsonb_build_object(
      'batch_id',        r.batch_id,
      'variant_id',      r.variant_id,
      'variant_name',    COALESCE(r.qty_variant_name, r.variant_name),
      'batch_date',      r.batch_date,
      'units',           v_batch_units,
      'qty',             v_qty_to_alloc,
      'unit_price',      r.unit_price,
      'price_per_pkg',   v_price_per_pkg,
      'cost',            v_qty_to_alloc * r.unit_price
    ));

    v_batch_lines := v_batch_lines || (
      '  Batch#' || r.batch_id
      || ' [' || r.batch_date::TEXT || ']'
      || ' | ' || COALESCE(r.qty_variant_name, r.variant_name)
      || ' | ' || v_batch_units::TEXT || ' units'
      || ' (' || v_qty_to_alloc::TEXT || ' ' || COALESCE(v_metric, '') || ')'
      || ' | Rs.' || v_price_per_pkg::TEXT || '/unit'
      || ' (Rs.' || r.unit_price::TEXT || '/' || COALESCE(v_metric, 'unit') || ')'
      || ' = Rs.' || ROUND(v_qty_to_alloc * r.unit_price, 2)::TEXT
    );

    v_total_cost := v_total_cost + (v_qty_to_alloc * r.unit_price);
    v_remaining  := v_remaining  - v_qty_to_alloc;
  END LOOP;

  IF v_remaining > 0 THEN
    RAISE EXCEPTION
      'Whole-unit FIFO: only % of % allocated (fractional remainders skipped).',
      p_required_qty - v_remaining, p_required_qty;
  END IF;

  -- Rich PROJECT IN log
  INSERT INTO public.material_movement_logs (
    material_id, movement_type, project_id, quantity,
    reference_type, reference_id, notes, created_by
  ) VALUES (
    p_material_id, 'Project In', p_project_id, p_required_qty,
    'Material Request', v_allocation_id,
    'ALLOCATION #' || v_allocation_id || ' | PROJECT IN (auto-FIFO) | ' || NOW()::TEXT
    || E'\nMaterial : ' || v_material_name
    || E'\nProject  : "' || v_project_name || '" (#' || p_project_id || ')'
    || E'\nQty      : ' || p_required_qty::TEXT || ' ' || COALESCE(v_metric, '')
    || E'\nCost     : Rs.' || ROUND(v_total_cost, 2)::TEXT
    || E'\nBatch breakdown:'
    || E'\n' || array_to_string(v_batch_lines, E'\n'),
    auth.uid()
  );

  -- Rich STORE OUT log
  INSERT INTO public.material_movement_logs (
    material_id, movement_type, project_id, quantity,
    reference_type, reference_id, notes, created_by
  ) VALUES (
    p_material_id, 'Store Out', p_project_id, p_required_qty,
    'Material Request', v_allocation_id,
    'ALLOCATION #' || v_allocation_id || ' | STORE OUT (auto-FIFO) | ' || NOW()::TEXT
    || E'\nMaterial : ' || v_material_name
    || E'\nProject  : "' || v_project_name || '" (#' || p_project_id || ')'
    || E'\nQty      : ' || p_required_qty::TEXT || ' ' || COALESCE(v_metric, '')
    || E'\nValue    : Rs.' || ROUND(v_total_cost, 2)::TEXT
    || E'\nBatch breakdown:'
    || E'\n' || array_to_string(v_batch_lines, E'\n'),
    auth.uid()
  );

  RETURN QUERY SELECT v_allocation_id, p_required_qty, v_total_cost, v_breakdown;
END;
$$;

GRANT EXECUTE ON FUNCTION public.allocate_material_fifo(BIGINT, BIGINT, NUMERIC) TO authenticated;


-- ---------------------------------------------------------------------------
-- 2. allocate_material_fifo_by_variant  (single price-variant FIFO)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.allocate_material_fifo_by_variant(
  p_variant_id   BIGINT,
  p_project_id   BIGINT,
  p_required_qty NUMERIC(12,3)
)
RETURNS TABLE (
  allocation_id   BIGINT,
  total_allocated NUMERIC(12,3),
  total_cost      NUMERIC(14,2),
  breakdown       JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_allocation_id  BIGINT;
  v_remaining      NUMERIC(12,3) := p_required_qty;
  v_total_cost     NUMERIC(14,2) := 0;
  v_breakdown      JSONB         := '[]'::JSONB;
  v_batch_lines    TEXT[]        := ARRAY[]::TEXT[];
  v_qty_to_alloc   NUMERIC(12,3);
  v_floor_batch    NUMERIC(12,3);
  v_total_whole    NUMERIC(12,3);
  v_material_id    BIGINT;
  v_material_name  TEXT;
  v_metric         TEXT;
  v_variant_name   TEXT;
  v_unit_price     NUMERIC(12,2);
  v_project_name   TEXT;
  v_qty_variant_nm TEXT;
  v_qty_per_unit   NUMERIC(12,3);
  v_batch_units    NUMERIC(12,3);
  v_price_per_pkg  NUMERIC(14,2);
  r                RECORD;
BEGIN
  PERFORM public._assert_admin();

  IF p_required_qty IS NULL OR p_required_qty <= 0 THEN
    RAISE EXCEPTION 'required_qty must be > 0';
  END IF;

  SELECT mpv.material_id, mpv.variant_name, mpv.unit_price,
         m.material_name, m.metric,
         mv.variant_name AS qty_variant_name, mv.quantity_per_unit
  INTO   v_material_id, v_variant_name, v_unit_price,
         v_material_name, v_metric,
         v_qty_variant_nm, v_qty_per_unit
  FROM public.material_price_variants mpv
  JOIN public.materials_master m     ON m.material_id  = mpv.material_id
  LEFT JOIN public.material_variants mv ON mv.variant_id = mpv.quantity_variant_id
  WHERE mpv.variant_id = p_variant_id;

  IF v_material_id IS NULL THEN
    RAISE EXCEPTION 'Variant % does not exist', p_variant_id;
  END IF;

  SELECT project_name INTO v_project_name
  FROM public.projects WHERE project_id = p_project_id;
  IF v_project_name IS NULL THEN
    RAISE EXCEPTION 'Project % does not exist', p_project_id;
  END IF;

  v_price_per_pkg := ROUND(v_unit_price * COALESCE(v_qty_per_unit, 1), 2);

  SELECT COALESCE(SUM(FLOOR(b.quantity_available)), 0)
    INTO v_total_whole
  FROM public.material_stock_batches b
  WHERE b.variant_id = p_variant_id;

  IF v_total_whole < p_required_qty THEN
    RAISE EXCEPTION
      'Insufficient stock for variant "%": need %, whole-unit available = %',
      v_variant_name, p_required_qty, v_total_whole;
  END IF;

  INSERT INTO public.material_allocations (
    material_id, project_id, allocated_quantity, status, allocated_by
  ) VALUES (
    v_material_id, p_project_id, p_required_qty, 'Reserved', auth.uid()
  )
  RETURNING material_allocations.allocation_id INTO v_allocation_id;

  FOR r IN
    SELECT b.batch_id, b.batch_date, b.quantity_available
      FROM public.material_stock_batches b
     WHERE b.variant_id = p_variant_id
       AND b.quantity_available >= 1
     ORDER BY b.batch_date ASC, b.batch_id ASC
     FOR UPDATE OF b
  LOOP
    EXIT WHEN v_remaining <= 0;

    v_floor_batch  := FLOOR(r.quantity_available);
    CONTINUE WHEN v_floor_batch <= 0;

    v_qty_to_alloc := LEAST(v_floor_batch, v_remaining);
    v_batch_units  := ROUND(v_qty_to_alloc / COALESCE(NULLIF(v_qty_per_unit, 0), 1), 3);

    INSERT INTO public.allocation_variant_breakdown (
      allocation_id, batch_id, variant_id, qty_allocated, unit_price
    ) VALUES (
      v_allocation_id, r.batch_id, p_variant_id, v_qty_to_alloc, v_unit_price
    );

    UPDATE public.material_stock_batches AS b
       SET quantity_available = b.quantity_available - v_qty_to_alloc
     WHERE b.batch_id = r.batch_id;

    v_breakdown := v_breakdown || jsonb_build_array(jsonb_build_object(
      'batch_id',       r.batch_id,
      'variant_id',     p_variant_id,
      'variant_name',   COALESCE(v_qty_variant_nm, v_variant_name),
      'batch_date',     r.batch_date,
      'units',          v_batch_units,
      'qty',            v_qty_to_alloc,
      'unit_price',     v_unit_price,
      'price_per_pkg',  v_price_per_pkg,
      'cost',           v_qty_to_alloc * v_unit_price
    ));

    v_batch_lines := v_batch_lines || (
      '  Batch#' || r.batch_id
      || ' [' || r.batch_date::TEXT || ']'
      || ' | ' || v_batch_units::TEXT || ' units'
      || ' (' || v_qty_to_alloc::TEXT || ' ' || COALESCE(v_metric, '') || ')'
      || ' | Rs.' || v_price_per_pkg::TEXT || '/unit'
      || ' (Rs.' || v_unit_price::TEXT || '/' || COALESCE(v_metric, 'unit') || ')'
      || ' = Rs.' || ROUND(v_qty_to_alloc * v_unit_price, 2)::TEXT
    );

    v_total_cost := v_total_cost + (v_qty_to_alloc * v_unit_price);
    v_remaining  := v_remaining  - v_qty_to_alloc;
  END LOOP;

  IF v_remaining > 0 THEN
    RAISE EXCEPTION
      'FIFO for variant "%": only % of % could be allocated.',
      v_variant_name, p_required_qty - v_remaining, p_required_qty;
  END IF;

  INSERT INTO public.material_movement_logs (
    material_id, movement_type, project_id, quantity,
    reference_type, reference_id, notes, created_by
  ) VALUES (
    v_material_id, 'Project In', p_project_id, p_required_qty,
    'Material Request', v_allocation_id,
    'ALLOCATION #' || v_allocation_id || ' | PROJECT IN | ' || NOW()::TEXT
    || E'\nMaterial : ' || v_material_name
    || E'\nProject  : "' || v_project_name || '" (#' || p_project_id || ')'
    || E'\nPackaging: ' || COALESCE(v_qty_variant_nm, v_variant_name)
    || ' (' || v_qty_per_unit::TEXT || ' ' || COALESCE(v_metric, '') || '/unit)'
    || E'\nQty      : ' || p_required_qty::TEXT || ' ' || COALESCE(v_metric, '')
    || ' = ' || ROUND(p_required_qty / COALESCE(NULLIF(v_qty_per_unit, 0), 1), 3)::TEXT || ' units'
    || E'\nPrice    : Rs.' || v_price_per_pkg::TEXT || '/unit'
    || ' (Rs.' || v_unit_price::TEXT || '/' || COALESCE(v_metric, 'unit') || ')'
    || E'\nCost     : Rs.' || ROUND(v_total_cost, 2)::TEXT
    || E'\nBatch breakdown:'
    || E'\n' || array_to_string(v_batch_lines, E'\n'),
    auth.uid()
  );

  INSERT INTO public.material_movement_logs (
    material_id, movement_type, project_id, quantity,
    reference_type, reference_id, notes, created_by
  ) VALUES (
    v_material_id, 'Store Out', p_project_id, p_required_qty,
    'Material Request', v_allocation_id,
    'ALLOCATION #' || v_allocation_id || ' | STORE OUT | ' || NOW()::TEXT
    || E'\nMaterial : ' || v_material_name
    || E'\nProject  : "' || v_project_name || '" (#' || p_project_id || ')'
    || E'\nPackaging: ' || COALESCE(v_qty_variant_nm, v_variant_name)
    || ' (' || v_qty_per_unit::TEXT || ' ' || COALESCE(v_metric, '') || '/unit)'
    || E'\nQty      : ' || p_required_qty::TEXT || ' ' || COALESCE(v_metric, '')
    || ' = ' || ROUND(p_required_qty / COALESCE(NULLIF(v_qty_per_unit, 0), 1), 3)::TEXT || ' units'
    || E'\nPrice    : Rs.' || v_price_per_pkg::TEXT || '/unit'
    || ' (Rs.' || v_unit_price::TEXT || '/' || COALESCE(v_metric, 'unit') || ')'
    || E'\nValue    : Rs.' || ROUND(v_total_cost, 2)::TEXT
    || E'\nBatch breakdown:'
    || E'\n' || array_to_string(v_batch_lines, E'\n'),
    auth.uid()
  );

  RETURN QUERY SELECT v_allocation_id, p_required_qty, v_total_cost, v_breakdown;
END;
$$;

GRANT EXECUTE ON FUNCTION public.allocate_material_fifo_by_variant(BIGINT, BIGINT, NUMERIC) TO authenticated;


-- ---------------------------------------------------------------------------
-- 3. allocate_material_fifo_multi_qty_variant  (multi-packaging FIFO)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.allocate_material_fifo_multi_qty_variant(
  p_allocations  JSONB,
  p_project_id   BIGINT
)
RETURNS TABLE (
  allocation_id   BIGINT,
  total_allocated NUMERIC(12,3),
  total_cost      NUMERIC(14,2),
  breakdown       JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_allocation_id   BIGINT;
  v_material_id     BIGINT;
  v_material_name   TEXT;
  v_metric          TEXT;
  v_project_name    TEXT;
  v_total_qty       NUMERIC(12,3) := 0;
  v_total_cost      NUMERIC(14,2) := 0;
  v_full_breakdown  JSONB         := '[]'::JSONB;
  v_body            TEXT          := '';      -- accumulates per-variant sections
  -- per qty-variant
  v_qty_variant_id  BIGINT;
  v_qty_variant_nm  TEXT;
  v_qty_per_unit    NUMERIC(12,3);
  v_required_qty    NUMERIC(12,3);
  v_remaining       NUMERIC(12,3);
  v_variant_units   NUMERIC(12,3);           -- physical units issued this variant
  v_variant_cost    NUMERIC(14,2);           -- cost subtotal this variant
  v_variant_section TEXT;                    -- assembled text for this variant
  v_total_whole     NUMERIC(12,3);
  -- per batch
  v_qty_to_alloc    NUMERIC(12,3);
  v_floor_batch     NUMERIC(12,3);
  v_batch_units     NUMERIC(12,3);
  v_price_per_pkg   NUMERIC(14,2);
  alloc_elem        JSONB;
  r                 RECORD;
BEGIN
  PERFORM public._assert_admin();

  IF p_allocations IS NULL OR jsonb_array_length(p_allocations) = 0 THEN
    RAISE EXCEPTION 'allocations array must not be empty';
  END IF;

  SELECT COALESCE(SUM((elem->>'qty')::NUMERIC(12,3)), 0)
  INTO v_total_qty
  FROM jsonb_array_elements(p_allocations) elem
  WHERE (elem->>'qty')::NUMERIC(12,3) > 0;

  IF v_total_qty <= 0 THEN
    RAISE EXCEPTION 'Total allocated qty must be > 0';
  END IF;

  SELECT mv.material_id, m.material_name, m.metric
  INTO v_material_id, v_material_name, v_metric
  FROM jsonb_array_elements(p_allocations) elem
  JOIN public.material_variants mv ON mv.variant_id = (elem->>'qty_variant_id')::BIGINT
  JOIN public.materials_master  m  ON m.material_id  = mv.material_id
  LIMIT 1;

  IF v_material_id IS NULL THEN
    RAISE EXCEPTION 'No valid qty_variant_id found in allocations array';
  END IF;

  SELECT project_name INTO v_project_name
  FROM public.projects WHERE project_id = p_project_id;
  IF v_project_name IS NULL THEN
    RAISE EXCEPTION 'Project % does not exist', p_project_id;
  END IF;

  INSERT INTO public.material_allocations (
    material_id, project_id, allocated_quantity, status, allocated_by
  ) VALUES (
    v_material_id, p_project_id, v_total_qty, 'Reserved', auth.uid()
  )
  RETURNING material_allocations.allocation_id INTO v_allocation_id;

  FOR alloc_elem IN SELECT * FROM jsonb_array_elements(p_allocations)
  LOOP
    v_qty_variant_id := (alloc_elem->>'qty_variant_id')::BIGINT;
    v_required_qty   := COALESCE((alloc_elem->>'qty')::NUMERIC(12,3), 0);
    CONTINUE WHEN v_required_qty <= 0;

    SELECT mv.variant_name, mv.quantity_per_unit
    INTO v_qty_variant_nm, v_qty_per_unit
    FROM public.material_variants mv
    WHERE mv.variant_id = v_qty_variant_id AND mv.material_id = v_material_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Qty variant % not found or belongs to different material', v_qty_variant_id;
    END IF;

    SELECT COALESCE(SUM(FLOOR(b.quantity_available)), 0)
    INTO v_total_whole
    FROM public.material_stock_batches b
    JOIN public.material_price_variants mpv ON mpv.variant_id = b.variant_id
    WHERE mpv.quantity_variant_id = v_qty_variant_id;

    IF v_total_whole < v_required_qty THEN
      RAISE EXCEPTION
        'Insufficient stock for packaging "%": need %, whole-unit available = %',
        v_qty_variant_nm, v_required_qty, v_total_whole;
    END IF;

    v_remaining       := v_required_qty;
    v_variant_units   := 0;
    v_variant_cost    := 0;
    v_variant_section := '';

    FOR r IN
      SELECT b.batch_id, b.batch_date, b.quantity_available,
             mpv.variant_id AS price_variant_id,
             mpv.variant_name AS price_variant_name,
             mpv.unit_price
      FROM public.material_stock_batches b
      JOIN public.material_price_variants mpv ON mpv.variant_id = b.variant_id
      WHERE mpv.quantity_variant_id = v_qty_variant_id
        AND b.quantity_available >= 1
      ORDER BY b.batch_date ASC, b.batch_id ASC
      FOR UPDATE OF b
    LOOP
      EXIT WHEN v_remaining <= 0;

      v_floor_batch  := FLOOR(r.quantity_available);
      CONTINUE WHEN v_floor_batch <= 0;

      v_qty_to_alloc  := LEAST(v_floor_batch, v_remaining);
      v_batch_units   := ROUND(v_qty_to_alloc / COALESCE(NULLIF(v_qty_per_unit, 0), 1), 3);
      v_price_per_pkg := ROUND(r.unit_price * COALESCE(v_qty_per_unit, 1), 2);

      INSERT INTO public.allocation_variant_breakdown (
        allocation_id, batch_id, variant_id, qty_allocated, unit_price
      ) VALUES (
        v_allocation_id, r.batch_id, r.price_variant_id, v_qty_to_alloc, r.unit_price
      );

      UPDATE public.material_stock_batches AS b
        SET quantity_available = b.quantity_available - v_qty_to_alloc
      WHERE b.batch_id = r.batch_id;

      v_variant_units  := v_variant_units + v_batch_units;
      v_variant_cost   := v_variant_cost  + (v_qty_to_alloc * r.unit_price);
      v_total_cost     := v_total_cost    + (v_qty_to_alloc * r.unit_price);
      v_remaining      := v_remaining     - v_qty_to_alloc;

      v_full_breakdown := v_full_breakdown || jsonb_build_array(jsonb_build_object(
        'batch_id',           r.batch_id,
        'qty_variant_id',     v_qty_variant_id,
        'qty_variant_name',   v_qty_variant_nm,
        'price_variant_id',   r.price_variant_id,
        'price_variant_name', r.price_variant_name,
        'batch_date',         r.batch_date,
        'units',              v_batch_units,
        'qty',                v_qty_to_alloc,
        'unit_price',         r.unit_price,
        'price_per_pkg',      v_price_per_pkg,
        'cost',               v_qty_to_alloc * r.unit_price
      ));

      -- Per-batch line within this variant section
      v_variant_section := v_variant_section
        || '    Batch#' || r.batch_id
        || ' [' || r.batch_date::TEXT || ']'
        || ' | ' || v_batch_units::TEXT || ' units'
        || ' (' || v_qty_to_alloc::TEXT || ' ' || COALESCE(v_metric, '') || ')'
        || ' | Rs.' || v_price_per_pkg::TEXT || '/unit'
        || ' (Rs.' || r.unit_price::TEXT || '/' || COALESCE(v_metric, 'unit') || ')'
        || ' = Rs.' || ROUND(v_qty_to_alloc * r.unit_price, 2)::TEXT
        || E'\n';
    END LOOP;

    IF v_remaining > 0 THEN
      RAISE EXCEPTION
        'FIFO for packaging "%": only % of % could be allocated.',
        v_qty_variant_nm, v_required_qty - v_remaining, v_required_qty;
    END IF;

    -- Prepend variant header to its batch lines
    v_body := v_body
      || '  [' || v_qty_variant_nm || ']'
      || ' ' || ROUND(v_variant_units, 3)::TEXT || ' units'
      || ' (' || v_required_qty::TEXT || ' ' || COALESCE(v_metric, '') || ')'
      || ' | Rs.' || ROUND(v_qty_per_unit, 3)::TEXT || '/' || COALESCE(v_metric, 'unit') || ' per unit'
      || ' | subtotal: Rs.' || ROUND(v_variant_cost, 2)::TEXT
      || E'\n'
      || v_variant_section;
  END LOOP;

  INSERT INTO public.material_movement_logs (
    material_id, movement_type, project_id, quantity,
    reference_type, reference_id, notes, created_by
  ) VALUES (
    v_material_id, 'Project In', p_project_id, v_total_qty,
    'Material Request', v_allocation_id,
    'ALLOCATION #' || v_allocation_id || ' | PROJECT IN | ' || NOW()::TEXT
    || E'\nMaterial : ' || v_material_name
    || E'\nProject  : "' || v_project_name || '" (#' || p_project_id || ')'
    || E'\nTotal qty: ' || v_total_qty::TEXT || ' ' || COALESCE(v_metric, '')
    || E'\nTotal cost: Rs.' || ROUND(v_total_cost, 2)::TEXT
    || E'\nPackaging breakdown:'
    || E'\n' || v_body,
    auth.uid()
  );

  INSERT INTO public.material_movement_logs (
    material_id, movement_type, project_id, quantity,
    reference_type, reference_id, notes, created_by
  ) VALUES (
    v_material_id, 'Store Out', p_project_id, v_total_qty,
    'Material Request', v_allocation_id,
    'ALLOCATION #' || v_allocation_id || ' | STORE OUT | ' || NOW()::TEXT
    || E'\nMaterial : ' || v_material_name
    || E'\nProject  : "' || v_project_name || '" (#' || p_project_id || ')'
    || E'\nTotal qty: ' || v_total_qty::TEXT || ' ' || COALESCE(v_metric, '')
    || E'\nTotal value: Rs.' || ROUND(v_total_cost, 2)::TEXT
    || E'\nPackaging breakdown:'
    || E'\n' || v_body,
    auth.uid()
  );

  RETURN QUERY SELECT v_allocation_id, v_total_qty, v_total_cost, v_full_breakdown;
END;
$$;

GRANT EXECUTE ON FUNCTION public.allocate_material_fifo_multi_qty_variant(JSONB, BIGINT) TO authenticated;

NOTIFY pgrst, 'reload schema';
