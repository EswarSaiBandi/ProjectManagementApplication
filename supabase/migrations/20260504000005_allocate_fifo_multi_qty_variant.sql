-- ============================================================================
-- allocate_material_fifo_multi_qty_variant
--
-- Admin specifies units per PACKAGING variant (material_variants).
-- FIFO picks the oldest batches across ALL price variants of that packaging
-- automatically — admin never needs to know about price tiers.
--
-- Example: 150 kg of Cement
--   2 × 50 kg Bag  → 100 kg (FIFO picks from oldest 50-kg-bag batches)
--   2 × 25 kg Bag  → 50 kg  (FIFO picks from oldest 25-kg-bag batches)
--
-- Input:
--   p_allocations  JSONB array of {"qty_variant_id": N, "qty": X.XXX}
--                  qty is already in base metric units (kg, m³, …)
--   p_project_id   target project
-- ============================================================================

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
  v_all_lines       TEXT[]        := ARRAY[]::TEXT[];
  -- per qty-variant
  v_qty_variant_id  BIGINT;
  v_qty_variant_nm  TEXT;
  v_qty_per_unit    NUMERIC(12,3);
  v_required_qty    NUMERIC(12,3);
  v_remaining       NUMERIC(12,3);
  v_qty_to_alloc    NUMERIC(12,3);
  v_floor_batch     NUMERIC(12,3);
  v_total_whole     NUMERIC(12,3);
  alloc_elem        JSONB;
  r                 RECORD;
BEGIN
  PERFORM public._assert_admin();

  IF p_allocations IS NULL OR jsonb_array_length(p_allocations) = 0 THEN
    RAISE EXCEPTION 'allocations array must not be empty';
  END IF;

  -- Compute total base-metric qty
  SELECT COALESCE(SUM((elem->>'qty')::NUMERIC(12,3)), 0)
  INTO v_total_qty
  FROM jsonb_array_elements(p_allocations) elem
  WHERE (elem->>'qty')::NUMERIC(12,3) > 0;

  IF v_total_qty <= 0 THEN
    RAISE EXCEPTION 'Total allocated qty must be > 0';
  END IF;

  -- Derive material from first qty-variant; validate project
  SELECT mv.material_id, m.material_name, m.metric
  INTO v_material_id, v_material_name, v_metric
  FROM jsonb_array_elements(p_allocations) elem
  JOIN public.material_variants mv
    ON mv.variant_id = (elem->>'qty_variant_id')::BIGINT
  JOIN public.materials_master m
    ON m.material_id = mv.material_id
  LIMIT 1;

  IF v_material_id IS NULL THEN
    RAISE EXCEPTION 'No valid qty_variant_id found in allocations array';
  END IF;

  SELECT project_name INTO v_project_name
  FROM public.projects WHERE project_id = p_project_id;
  IF v_project_name IS NULL THEN
    RAISE EXCEPTION 'Project % does not exist', p_project_id;
  END IF;

  -- Single allocation record for the whole fulfillment
  INSERT INTO public.material_allocations (
    material_id, project_id, allocated_quantity, status, allocated_by
  ) VALUES (
    v_material_id, p_project_id, v_total_qty, 'Reserved', auth.uid()
  )
  RETURNING material_allocations.allocation_id INTO v_allocation_id;

  -- Process each packaging variant
  FOR alloc_elem IN SELECT * FROM jsonb_array_elements(p_allocations)
  LOOP
    v_qty_variant_id := (alloc_elem->>'qty_variant_id')::BIGINT;
    v_required_qty   := COALESCE((alloc_elem->>'qty')::NUMERIC(12,3), 0);
    CONTINUE WHEN v_required_qty <= 0;

    -- Validate qty_variant belongs to the same material
    SELECT mv.variant_name, mv.quantity_per_unit
    INTO v_qty_variant_nm, v_qty_per_unit
    FROM public.material_variants mv
    WHERE mv.variant_id = v_qty_variant_id
      AND mv.material_id = v_material_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'Qty variant % not found or belongs to a different material than %',
        v_qty_variant_id, v_material_name;
    END IF;

    -- Check whole-unit stock across ALL price variants of this packaging
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

    v_remaining := v_required_qty;

    -- FIFO across ALL price variants of this packaging — oldest batch date first.
    -- Each batch carries its own unit_price from the price variant it belongs to.
    FOR r IN
      SELECT
        b.batch_id,
        b.batch_date,
        b.quantity_available,
        mpv.variant_id   AS price_variant_id,
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

      v_qty_to_alloc := LEAST(v_floor_batch, v_remaining);

      INSERT INTO public.allocation_variant_breakdown (
        allocation_id, batch_id, variant_id, qty_allocated, unit_price
      ) VALUES (
        v_allocation_id, r.batch_id, r.price_variant_id, v_qty_to_alloc, r.unit_price
      );

      UPDATE public.material_stock_batches AS b
        SET quantity_available = b.quantity_available - v_qty_to_alloc
      WHERE b.batch_id = r.batch_id;

      v_total_cost    := v_total_cost    + (v_qty_to_alloc * r.unit_price);
      v_remaining     := v_remaining     - v_qty_to_alloc;

      v_full_breakdown := v_full_breakdown || jsonb_build_array(jsonb_build_object(
        'batch_id',            r.batch_id,
        'qty_variant_id',      v_qty_variant_id,
        'qty_variant_name',    v_qty_variant_nm,
        'price_variant_id',    r.price_variant_id,
        'price_variant_name',  r.price_variant_name,
        'batch_date',          r.batch_date,
        'qty',                 v_qty_to_alloc,
        'unit_price',          r.unit_price,
        'cost',                v_qty_to_alloc * r.unit_price
      ));

      v_all_lines := v_all_lines || (
        v_qty_to_alloc::TEXT || ' ' || v_qty_variant_nm
        || ' @ Rs.' || r.unit_price::TEXT || '/' || COALESCE(v_metric, 'unit')
        || ' (batch#=' || r.batch_id
        || ', date='   || r.batch_date::TEXT || ')'
        || ' = Rs.'    || (v_qty_to_alloc * r.unit_price)::TEXT
      );
    END LOOP;

    IF v_remaining > 0 THEN
      RAISE EXCEPTION
        'FIFO for packaging "%": only % of requested % could be allocated.',
        v_qty_variant_nm, v_required_qty - v_remaining, v_required_qty;
    END IF;
  END LOOP;

  -- Dual movement logs
  INSERT INTO public.material_movement_logs (
    material_id, movement_type, project_id, quantity,
    reference_type, reference_id, notes, created_by
  ) VALUES (
    v_material_id, 'Project In', p_project_id, v_total_qty,
    'Material Request', v_allocation_id,
    'PROJECT IN: '    || v_total_qty::TEXT || ' ' || COALESCE(v_metric, '')
    || ' of '         || v_material_name
    || ' (multi-packaging) allocated to project "'
    || v_project_name || '" (#' || p_project_id || ')'
    || ' | breakdown: [' || array_to_string(v_all_lines, '; ') || ']'
    || ' | total cost = Rs.' || v_total_cost::TEXT
    || ' | alloc#=' || v_allocation_id
    || ' | at=' || NOW()::TEXT,
    auth.uid()
  );

  INSERT INTO public.material_movement_logs (
    material_id, movement_type, project_id, quantity,
    reference_type, reference_id, notes, created_by
  ) VALUES (
    v_material_id, 'Store Out', p_project_id, v_total_qty,
    'Material Request', v_allocation_id,
    'STORE OUT (to project "' || v_project_name || '" #' || p_project_id || '): '
    || v_total_qty::TEXT || ' ' || COALESCE(v_metric, '')
    || ' of '  || v_material_name
    || ' (multi-packaging)'
    || ' | alloc#='       || v_allocation_id
    || ' | total value = Rs.' || v_total_cost::TEXT
    || ' | at=' || NOW()::TEXT,
    auth.uid()
  );

  RETURN QUERY SELECT v_allocation_id, v_total_qty, v_total_cost, v_full_breakdown;
END;
$$;

GRANT EXECUTE ON FUNCTION public.allocate_material_fifo_multi_qty_variant(JSONB, BIGINT) TO authenticated;

NOTIFY pgrst, 'reload schema';
