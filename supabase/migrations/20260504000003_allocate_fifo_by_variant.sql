-- ============================================================================
-- allocate_material_fifo_by_variant
--
-- Like allocate_material_fifo but scoped to a single price variant.
-- Admin explicitly picks which packaging variant to draw stock from;
-- FIFO order is preserved within that variant's batches (oldest first).
--
-- Used by the store fulfill dialog when the admin selects a specific variant.
-- ============================================================================

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
  v_lines          TEXT[]        := ARRAY[]::TEXT[];
  v_qty_to_alloc   NUMERIC(12,3);
  v_floor_batch    NUMERIC(12,3);
  v_total_whole    NUMERIC(12,3);
  v_material_id    BIGINT;
  v_material_name  TEXT;
  v_metric         TEXT;
  v_variant_name   TEXT;
  v_unit_price     NUMERIC(12,2);
  v_project_name   TEXT;
  v_notes_proj     TEXT;
  v_notes_store    TEXT;
  r RECORD;
BEGIN
  PERFORM public._assert_admin();

  IF p_required_qty IS NULL OR p_required_qty <= 0 THEN
    RAISE EXCEPTION 'required_qty must be > 0';
  END IF;

  -- Fetch variant + material details.
  SELECT
    mpv.material_id, mpv.variant_name, mpv.unit_price,
    m.material_name, m.metric
  INTO
    v_material_id, v_variant_name, v_unit_price,
    v_material_name, v_metric
  FROM public.material_price_variants mpv
  JOIN public.materials_master m ON m.material_id = mpv.material_id
  WHERE mpv.variant_id = p_variant_id;

  IF v_material_id IS NULL THEN
    RAISE EXCEPTION 'Variant % does not exist', p_variant_id;
  END IF;

  SELECT project_name INTO v_project_name
  FROM public.projects WHERE project_id = p_project_id;
  IF v_project_name IS NULL THEN
    RAISE EXCEPTION 'Project % does not exist', p_project_id;
  END IF;

  -- Check whole-unit stock available for this specific variant.
  SELECT COALESCE(SUM(FLOOR(b.quantity_available)), 0)
    INTO v_total_whole
  FROM public.material_stock_batches b
  WHERE b.variant_id = p_variant_id;

  IF v_total_whole < p_required_qty THEN
    RAISE EXCEPTION
      'Insufficient stock for variant "%": need %, whole-unit available = %',
      v_variant_name, p_required_qty, v_total_whole;
  END IF;

  -- Create allocation record.
  INSERT INTO public.material_allocations (
    material_id, project_id, allocated_quantity, status, allocated_by
  ) VALUES (
    v_material_id, p_project_id, p_required_qty, 'Reserved', auth.uid()
  )
  RETURNING material_allocations.allocation_id INTO v_allocation_id;

  -- FIFO loop — batches of this variant, oldest first.
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

    INSERT INTO public.allocation_variant_breakdown (
      allocation_id, batch_id, variant_id, qty_allocated, unit_price
    ) VALUES (
      v_allocation_id, r.batch_id, p_variant_id, v_qty_to_alloc, v_unit_price
    );

    UPDATE public.material_stock_batches AS b
       SET quantity_available = b.quantity_available - v_qty_to_alloc
     WHERE b.batch_id = r.batch_id;

    v_breakdown := v_breakdown || jsonb_build_array(jsonb_build_object(
      'batch_id',     r.batch_id,
      'variant_id',   p_variant_id,
      'variant_name', v_variant_name,
      'batch_date',   r.batch_date,
      'qty',          v_qty_to_alloc,
      'unit_price',   v_unit_price,
      'cost',         v_qty_to_alloc * v_unit_price
    ));
    v_lines := v_lines || (
      v_qty_to_alloc::TEXT || ' @ Rs.' || v_unit_price::TEXT ||
      ' (variant="' || v_variant_name || '", batch#=' || r.batch_id ||
      ', batch_date=' || r.batch_date::TEXT || ')' ||
      ' = Rs.' || (v_qty_to_alloc * v_unit_price)::TEXT
    );

    v_total_cost := v_total_cost + (v_qty_to_alloc * v_unit_price);
    v_remaining  := v_remaining  - v_qty_to_alloc;
  END LOOP;

  IF v_remaining > 0 THEN
    RAISE EXCEPTION
      'FIFO for variant "%": only % of requested % could be allocated.',
      v_variant_name, p_required_qty - v_remaining, p_required_qty;
  END IF;

  -- Dual movement logs.
  v_notes_proj :=
    'PROJECT IN: ' || p_required_qty::TEXT || ' ' || COALESCE(v_metric, '') ||
    ' of ' || v_material_name ||
    ' (variant "' || v_variant_name || '")' ||
    ' allocated to project "' || v_project_name || '" (#' || p_project_id || ')' ||
    ' | breakdown: [' || array_to_string(v_lines, '; ') || ']' ||
    ' | total cost = Rs.' || v_total_cost::TEXT ||
    ' | alloc#=' || v_allocation_id ||
    ' | at=' || NOW()::TEXT;

  INSERT INTO public.material_movement_logs (
    material_id, movement_type, project_id, quantity,
    reference_type, reference_id, notes, created_by
  ) VALUES (
    v_material_id, 'Project In', p_project_id, p_required_qty,
    'Material Request', v_allocation_id, v_notes_proj, auth.uid()
  );

  v_notes_store :=
    'STORE OUT (to project "' || v_project_name || '" #' || p_project_id || '): ' ||
    p_required_qty::TEXT || ' ' || COALESCE(v_metric, '') ||
    ' of ' || v_material_name ||
    ' (variant "' || v_variant_name || '")' ||
    ' | alloc#=' || v_allocation_id ||
    ' | total value = Rs.' || v_total_cost::TEXT ||
    ' | at=' || NOW()::TEXT;

  INSERT INTO public.material_movement_logs (
    material_id, movement_type, project_id, quantity,
    reference_type, reference_id, notes, created_by
  ) VALUES (
    v_material_id, 'Store Out', p_project_id, p_required_qty,
    'Material Request', v_allocation_id, v_notes_store, auth.uid()
  );

  RETURN QUERY SELECT v_allocation_id, p_required_qty, v_total_cost, v_breakdown;
END;
$$;

GRANT EXECUTE ON FUNCTION public.allocate_material_fifo_by_variant(BIGINT, BIGINT, NUMERIC) TO authenticated;

NOTIFY pgrst, 'reload schema';
