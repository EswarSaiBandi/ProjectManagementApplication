-- ============================================================================
-- allocate_material_fifo_multi_variant
--
-- Admin specifies a mix of packaging variants to fulfill one MR.
-- E.g.: 150 kg = 2× 50 kg Bag (100 kg) + 2× 25 kg Bag (50 kg).
--
-- All variant FIFO loops run inside ONE transaction → one allocation record,
-- one set of movement logs. Either everything succeeds or nothing changes.
--
-- Input:
--   p_allocations  JSONB array of {"variant_id": N, "qty": X.XXX}
--                  where qty is already in base metric units (kg, m³, …)
--   p_project_id   target project
-- ============================================================================

CREATE OR REPLACE FUNCTION public.allocate_material_fifo_multi_variant(
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
  v_allocation_id  BIGINT;
  v_material_id    BIGINT;
  v_material_name  TEXT;
  v_metric         TEXT;
  v_project_name   TEXT;
  v_total_qty      NUMERIC(12,3) := 0;
  v_total_cost     NUMERIC(14,2) := 0;
  v_full_breakdown JSONB         := '[]'::JSONB;
  v_all_lines      TEXT[]        := ARRAY[]::TEXT[];
  -- per variant
  v_variant_id     BIGINT;
  v_required_qty   NUMERIC(12,3);
  v_variant_name   TEXT;
  v_unit_price     NUMERIC(12,2);
  v_remaining      NUMERIC(12,3);
  v_qty_to_alloc   NUMERIC(12,3);
  v_floor_batch    NUMERIC(12,3);
  v_total_whole    NUMERIC(12,3);
  alloc_elem       JSONB;
  r                RECORD;
BEGIN
  PERFORM public._assert_admin();

  IF p_allocations IS NULL OR jsonb_array_length(p_allocations) = 0 THEN
    RAISE EXCEPTION 'allocations array must not be empty';
  END IF;

  -- Total base-metric qty across all variants
  SELECT COALESCE(SUM((elem->>'qty')::NUMERIC(12,3)), 0)
  INTO v_total_qty
  FROM jsonb_array_elements(p_allocations) elem
  WHERE (elem->>'qty')::NUMERIC(12,3) > 0;

  IF v_total_qty <= 0 THEN
    RAISE EXCEPTION 'Total allocated qty must be > 0';
  END IF;

  -- Derive material from the first variant; validate project exists
  SELECT mpv.material_id, m.material_name, m.metric
  INTO v_material_id, v_material_name, v_metric
  FROM jsonb_array_elements(p_allocations) elem
  JOIN public.material_price_variants mpv
    ON mpv.variant_id = (elem->>'variant_id')::BIGINT
  JOIN public.materials_master m
    ON m.material_id = mpv.material_id
  LIMIT 1;

  IF v_material_id IS NULL THEN
    RAISE EXCEPTION 'No valid variant found in allocations array';
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

  -- Process each variant
  FOR alloc_elem IN SELECT * FROM jsonb_array_elements(p_allocations)
  LOOP
    v_variant_id   := (alloc_elem->>'variant_id')::BIGINT;
    v_required_qty := COALESCE((alloc_elem->>'qty')::NUMERIC(12,3), 0);
    CONTINUE WHEN v_required_qty <= 0;

    -- Validate variant belongs to the same material
    SELECT mpv.variant_name, mpv.unit_price
    INTO v_variant_name, v_unit_price
    FROM public.material_price_variants mpv
    WHERE mpv.variant_id = v_variant_id
      AND mpv.material_id = v_material_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'Variant % not found or belongs to a different material than %',
        v_variant_id, v_material_name;
    END IF;

    -- Check whole-unit availability for this variant
    SELECT COALESCE(SUM(FLOOR(b.quantity_available)), 0)
    INTO v_total_whole
    FROM public.material_stock_batches b
    WHERE b.variant_id = v_variant_id;

    IF v_total_whole < v_required_qty THEN
      RAISE EXCEPTION
        'Insufficient stock for variant "%": need %, whole-unit available = %',
        v_variant_name, v_required_qty, v_total_whole;
    END IF;

    v_remaining := v_required_qty;

    -- FIFO within this variant — oldest batch first
    FOR r IN
      SELECT b.batch_id, b.batch_date, b.quantity_available
      FROM public.material_stock_batches b
      WHERE b.variant_id = v_variant_id
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
        v_allocation_id, r.batch_id, v_variant_id, v_qty_to_alloc, v_unit_price
      );

      UPDATE public.material_stock_batches AS b
        SET quantity_available = b.quantity_available - v_qty_to_alloc
      WHERE b.batch_id = r.batch_id;

      v_total_cost     := v_total_cost     + (v_qty_to_alloc * v_unit_price);
      v_remaining      := v_remaining      - v_qty_to_alloc;

      v_full_breakdown := v_full_breakdown || jsonb_build_array(jsonb_build_object(
        'batch_id',     r.batch_id,
        'variant_id',   v_variant_id,
        'variant_name', v_variant_name,
        'batch_date',   r.batch_date,
        'qty',          v_qty_to_alloc,
        'unit_price',   v_unit_price,
        'cost',         v_qty_to_alloc * v_unit_price
      ));

      v_all_lines := v_all_lines || (
        v_qty_to_alloc::TEXT || ' @ Rs.' || v_unit_price::TEXT
        || ' (variant="' || v_variant_name || '"'
        || ', batch#='   || r.batch_id
        || ', date='     || r.batch_date::TEXT || ')'
        || ' = Rs.'      || (v_qty_to_alloc * v_unit_price)::TEXT
      );
    END LOOP;

    IF v_remaining > 0 THEN
      RAISE EXCEPTION
        'FIFO for variant "%": only % of requested % could be allocated.',
        v_variant_name, v_required_qty - v_remaining, v_required_qty;
    END IF;
  END LOOP;

  -- Dual movement logs (PROJECT IN + STORE OUT)
  INSERT INTO public.material_movement_logs (
    material_id, movement_type, project_id, quantity,
    reference_type, reference_id, notes, created_by
  ) VALUES (
    v_material_id, 'Project In', p_project_id, v_total_qty,
    'Material Request', v_allocation_id,
    'PROJECT IN: '    || v_total_qty::TEXT || ' ' || COALESCE(v_metric, '')
    || ' of '         || v_material_name
    || ' (multi-variant) allocated to project "'
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
    || ' (multi-variant)'
    || ' | alloc#='       || v_allocation_id
    || ' | total value = Rs.' || v_total_cost::TEXT
    || ' | at=' || NOW()::TEXT,
    auth.uid()
  );

  RETURN QUERY SELECT v_allocation_id, v_total_qty, v_total_cost, v_full_breakdown;
END;
$$;

GRANT EXECUTE ON FUNCTION public.allocate_material_fifo_multi_variant(JSONB, BIGINT) TO authenticated;

NOTIFY pgrst, 'reload schema';
