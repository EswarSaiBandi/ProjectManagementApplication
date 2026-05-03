-- ============================================================================
-- Whole-unit FIFO allocation.
--
-- Rule: each batch can contribute only its INTEGER FLOOR to any allocation.
-- Fractional remainders (< 1) in a batch are skipped for this request and
-- stay in the batch.
--
-- Example:
--   var1 = 1.5 available, var2 = 2 available, request 2
--     → var1 contributes FLOOR(1.5) = 1; remaining = 1
--     → var2 contributes FLOOR(2) = 2, but only 1 needed
--     → final: 1 from var1, 1 from var2. var1 is left with 0.5.
--
--   var1 = 0.5, var2 = 2, request 1
--     → var1 contributes FLOOR(0.5) = 0; remaining = 1
--     → var2 contributes 1
--     → final: 0 from var1, 1 from var2. var1 keeps its 0.5.
--
-- Sufficient-stock check now uses SUM(FLOOR(quantity_available)) rather than
-- SUM(quantity_available), so requests that would need fractional batch
-- contributions correctly fail up-front.
--
-- No change to return/usage/revert RPCs — those operate on already-allocated
-- breakdown rows, which are already integer-qty by virtue of allocation.
--
-- Run AFTER 20260502000016_fix_qty_returned_ambiguity.sql.
-- ============================================================================

DROP FUNCTION IF EXISTS public.allocate_material_fifo(BIGINT, BIGINT, NUMERIC) CASCADE;

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
  v_allocation_id BIGINT;
  v_remaining     NUMERIC(12,3) := p_required_qty;
  v_total_cost    NUMERIC(14,2) := 0;
  v_breakdown     JSONB         := '[]'::JSONB;
  v_lines         TEXT[]        := ARRAY[]::TEXT[];
  v_qty_to_alloc  NUMERIC(12,3);
  v_floor_batch   NUMERIC(12,3);
  v_total_whole   NUMERIC(12,3);
  v_material_name TEXT;
  v_metric        TEXT;
  v_project_name  TEXT;
  v_notes         TEXT;
  r RECORD;
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

  -- Whole-unit availability: sum FLOOR(qty_available) per batch.
  SELECT COALESCE(SUM(FLOOR(b.quantity_available)), 0)
    INTO v_total_whole
  FROM public.material_stock_batches b
  JOIN public.material_price_variants v ON v.variant_id = b.variant_id
  WHERE v.material_id = p_material_id;

  IF v_total_whole < p_required_qty THEN
    RAISE EXCEPTION
      'Insufficient whole-unit stock for material "%": need %, whole-unit available = % (fractional remainders in individual batches are skipped by the whole-unit FIFO rule)',
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
           b.quantity_available
      FROM public.material_stock_batches b
      JOIN public.material_price_variants v ON v.variant_id = b.variant_id
     WHERE v.material_id = p_material_id
       AND b.quantity_available >= 1      -- skip batches with <1 fractional only
     ORDER BY b.batch_date ASC, b.batch_id ASC   -- FIFO across batches
     FOR UPDATE OF b
  LOOP
    EXIT WHEN v_remaining <= 0;

    v_floor_batch  := FLOOR(r.quantity_available);
    CONTINUE WHEN v_floor_batch <= 0;

    v_qty_to_alloc := LEAST(v_floor_batch, v_remaining);

    INSERT INTO public.allocation_variant_breakdown (
      allocation_id, batch_id, variant_id, qty_allocated, unit_price
    ) VALUES (
      v_allocation_id, r.batch_id, r.variant_id, v_qty_to_alloc, r.unit_price
    );

    UPDATE public.material_stock_batches AS b
       SET quantity_available = b.quantity_available - v_qty_to_alloc
     WHERE b.batch_id = r.batch_id;

    v_breakdown := v_breakdown || jsonb_build_array(jsonb_build_object(
      'batch_id',     r.batch_id,
      'variant_id',   r.variant_id,
      'variant_name', r.variant_name,
      'batch_date',   r.batch_date,
      'qty',          v_qty_to_alloc,
      'unit_price',   r.unit_price,
      'cost',         v_qty_to_alloc * r.unit_price
    ));
    v_lines := v_lines || (
      v_qty_to_alloc::TEXT || ' @ Rs.' || r.unit_price::TEXT ||
      ' (variant="' || r.variant_name || '", batch#=' || r.batch_id ||
      ', batch_date=' || r.batch_date::TEXT || ')' ||
      ' = Rs.' || (v_qty_to_alloc * r.unit_price)::TEXT
    );

    v_total_cost := v_total_cost + (v_qty_to_alloc * r.unit_price);
    v_remaining  := v_remaining  - v_qty_to_alloc;
  END LOOP;

  IF v_remaining > 0 THEN
    RAISE EXCEPTION
      'Whole-unit FIFO: only % of requested % could be allocated (fractional remainders skipped). Consider whole-unit request instead.',
      p_required_qty - v_remaining, p_required_qty;
  END IF;

  v_notes :=
    'FIFO ALLOCATE (whole-unit): ' || p_required_qty::TEXT || ' ' || COALESCE(v_metric, '') ||
    ' of ' || v_material_name ||
    ' to project "' || v_project_name || '" (#' || p_project_id || ')' ||
    ' | breakdown: [' || array_to_string(v_lines, '; ') || ']' ||
    ' | total cost = Rs.' || v_total_cost::TEXT ||
    ' | alloc#=' || v_allocation_id ||
    ' | at=' || NOW()::TEXT;

  INSERT INTO public.material_movement_logs (
    material_id, movement_type, project_id, quantity,
    reference_type, reference_id, notes, created_by
  ) VALUES (
    p_material_id, 'Project In', p_project_id, p_required_qty,
    'Material Request', v_allocation_id,
    v_notes,
    auth.uid()
  );

  RETURN QUERY SELECT v_allocation_id, p_required_qty, v_total_cost, v_breakdown;
END;
$$;

GRANT EXECUTE ON FUNCTION public.allocate_material_fifo(BIGINT, BIGINT, NUMERIC) TO authenticated;

NOTIFY pgrst, 'reload schema';
