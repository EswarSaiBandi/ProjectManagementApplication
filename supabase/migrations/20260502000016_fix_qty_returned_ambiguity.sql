-- ============================================================================
-- Fix: "column reference qty_returned is ambiguous" on Approve Return.
--
-- Cause: RETURNS TABLE columns are implicitly declared as OUT parameters
-- inside the PL/pgSQL body. When RETURNS TABLE had `qty_returned NUMERIC`
-- and the function body did:
--   UPDATE allocation_variant_breakdown SET qty_returned = qty_returned + v;
-- the right-hand side `qty_returned` ambiguates with the OUT parameter.
--
-- Fix: add `#variable_conflict use_column` pragma to each affected function.
-- That tells PL/pgSQL to resolve bare identifiers to column names first. We
-- also fully re-define the two functions that had this ambiguity:
--   approve_material_return_request
--   record_material_return (legacy per-allocation LIFO, still callable)
--
-- Run AFTER 20260502000015_cancel_return_request.sql.
-- ============================================================================

-- ============================================================================
-- approve_material_return_request
-- ============================================================================

DROP FUNCTION IF EXISTS public.approve_material_return_request(BIGINT, TEXT) CASCADE;

CREATE OR REPLACE FUNCTION public.approve_material_return_request(
  p_return_id     BIGINT,
  p_review_notes  TEXT DEFAULT NULL
)
RETURNS TABLE (
  return_id       BIGINT,
  qty_returned    NUMERIC(12,3),
  total_value     NUMERIC(14,2),
  breakdown       JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_project_id      BIGINT;
  v_material_id     BIGINT;
  v_qty             NUMERIC(12,3);
  v_status          TEXT;
  v_return_number   TEXT;
  v_condition       TEXT;
  v_material_name   TEXT;
  v_metric          TEXT;
  v_project_name    TEXT;
  v_remaining       NUMERIC(12,3);
  v_total_value     NUMERIC(14,2) := 0;
  v_breakdown       JSONB         := '[]'::JSONB;
  v_lines           TEXT[]        := ARRAY[]::TEXT[];
  v_return_qty      NUMERIC(12,3);
  v_notes           TEXT;
  r RECORD;
BEGIN
  PERFORM public._assert_admin();

  SELECT mr.project_id, mr.material_id, mr.returned_quantity, mr.status,
         mr.return_number, mr.condition,
         m.material_name, m.metric, p.project_name
    INTO v_project_id, v_material_id, v_qty, v_status,
         v_return_number, v_condition,
         v_material_name, v_metric, v_project_name
  FROM public.material_returns mr
  JOIN public.materials_master m ON m.material_id = mr.material_id
  JOIN public.projects p         ON p.project_id  = mr.project_id
  WHERE mr.return_id = p_return_id
  FOR UPDATE OF mr;

  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'Return request % not found', p_return_id;
  END IF;

  IF v_status <> 'Pending' THEN
    RAISE EXCEPTION 'Return request % is already % — cannot approve', p_return_id, v_status;
  END IF;

  v_remaining := v_qty;

  FOR r IN
    SELECT avb.breakdown_id,
           avb.allocation_id,
           avb.variant_id,
           avb.batch_id,
           mpv.variant_name,
           avb.unit_price,
           avb.qty_allocated - avb.qty_used - avb.qty_returned AS available
    FROM public.allocation_variant_breakdown avb
    JOIN public.material_allocations        ma  ON ma.allocation_id = avb.allocation_id
    JOIN public.material_price_variants     mpv ON mpv.variant_id   = avb.variant_id
    WHERE ma.project_id  = v_project_id
      AND ma.material_id = v_material_id
      AND (avb.qty_allocated - avb.qty_used - avb.qty_returned) > 0
    ORDER BY avb.breakdown_id DESC
    FOR UPDATE OF avb
  LOOP
    EXIT WHEN v_remaining <= 0;

    v_return_qty := LEAST(r.available, v_remaining);

    UPDATE public.allocation_variant_breakdown AS avb
       SET qty_returned = avb.qty_returned + v_return_qty
     WHERE avb.breakdown_id = r.breakdown_id;

    UPDATE public.material_stock_batches AS b
       SET quantity_available = b.quantity_available + v_return_qty
     WHERE b.batch_id = r.batch_id;

    v_breakdown := v_breakdown || jsonb_build_array(jsonb_build_object(
      'allocation_id', r.allocation_id,
      'breakdown_id',  r.breakdown_id,
      'batch_id',      r.batch_id,
      'variant_id',    r.variant_id,
      'variant_name',  r.variant_name,
      'qty',           v_return_qty,
      'unit_price',    r.unit_price,
      'value',         v_return_qty * r.unit_price
    ));
    v_lines := v_lines || (
      v_return_qty::TEXT || ' @ Rs.' || r.unit_price::TEXT ||
      ' (alloc#=' || r.allocation_id ||
      ', variant="' || r.variant_name ||
      '", batch#=' || r.batch_id || ')' ||
      ' = Rs.' || (v_return_qty * r.unit_price)::TEXT
    );

    v_total_value := v_total_value + (v_return_qty * r.unit_price);
    v_remaining   := v_remaining   - v_return_qty;
  END LOOP;

  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'Return request %: only % could be returned out of % (insufficient returnable breakdown rows)',
      p_return_id, v_qty - v_remaining, v_qty;
  END IF;

  UPDATE public.material_returns AS mr
     SET status       = 'Accepted',
         reviewed_at  = NOW(),
         review_notes = COALESCE(p_review_notes, 'Accepted by store'),
         reviewed_by  = auth.uid()
   WHERE mr.return_id = p_return_id;

  v_notes :=
    'RETURN ACCEPTED: ' || v_qty::TEXT || ' ' || COALESCE(v_metric, '') ||
    ' of ' || v_material_name ||
    ' (project "' || v_project_name || '" #' || v_project_id || ')' ||
    ' | return#=' || v_return_number ||
    ' | LIFO breakdown: [' || array_to_string(v_lines, '; ') || ']' ||
    ' | total value = Rs.' || v_total_value::TEXT ||
    ' | condition=' || COALESCE(v_condition, 'N/A') ||
    CASE WHEN p_review_notes IS NOT NULL AND btrim(p_review_notes) <> ''
         THEN ' | review_note="' || p_review_notes || '"' ELSE '' END ||
    ' | stock re-credited to original batches' ||
    ' | at=' || NOW()::TEXT;

  INSERT INTO public.material_movement_logs (
    material_id, movement_type, project_id, quantity,
    reference_type, reference_id, notes, created_by
  ) VALUES (
    v_material_id, 'Return Accepted', v_project_id, v_qty,
    'Material Return', p_return_id, v_notes, auth.uid()
  );

  RETURN QUERY SELECT p_return_id, v_qty, v_total_value, v_breakdown;
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_material_return_request(BIGINT, TEXT) TO authenticated;

-- ============================================================================
-- record_material_return (legacy per-allocation LIFO) — same ambiguity fix.
-- ============================================================================

DROP FUNCTION IF EXISTS public.record_material_return(BIGINT, NUMERIC) CASCADE;

CREATE OR REPLACE FUNCTION public.record_material_return(
  p_allocation_id BIGINT,
  p_qty_returned  NUMERIC(12,3)
)
RETURNS TABLE (
  allocation_id BIGINT,
  qty_returned  NUMERIC(12,3),
  total_value   NUMERIC(14,2),
  breakdown     JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_material_id   BIGINT;
  v_project_id    BIGINT;
  v_material_name TEXT;
  v_metric        TEXT;
  v_project_name  TEXT;
  v_remaining     NUMERIC(12,3) := p_qty_returned;
  v_total_value   NUMERIC(14,2) := 0;
  v_breakdown     JSONB         := '[]'::JSONB;
  v_lines         TEXT[]        := ARRAY[]::TEXT[];
  v_return_qty    NUMERIC(12,3);
  v_notes         TEXT;
  r RECORD;
BEGIN
  IF p_qty_returned IS NULL OR p_qty_returned <= 0 THEN
    RAISE EXCEPTION 'qty_returned must be > 0';
  END IF;

  SELECT ma.material_id, ma.project_id, m.material_name, m.metric, p.project_name
    INTO v_material_id, v_project_id, v_material_name, v_metric, v_project_name
  FROM public.material_allocations ma
  JOIN public.materials_master m ON m.material_id = ma.material_id
  JOIN public.projects p ON p.project_id = ma.project_id
  WHERE ma.allocation_id = p_allocation_id;

  IF v_material_id IS NULL THEN
    RAISE EXCEPTION 'Allocation % not found', p_allocation_id;
  END IF;

  FOR r IN
    SELECT avb.breakdown_id,
           avb.batch_id,
           avb.variant_id,
           mpv.variant_name,
           avb.unit_price,
           avb.qty_allocated - avb.qty_used - avb.qty_returned AS available
    FROM public.allocation_variant_breakdown avb
    JOIN public.material_price_variants mpv ON mpv.variant_id = avb.variant_id
    WHERE avb.allocation_id = p_allocation_id
    ORDER BY avb.breakdown_id DESC
    FOR UPDATE OF avb
  LOOP
    EXIT WHEN v_remaining <= 0;
    CONTINUE WHEN r.available <= 0;

    v_return_qty := LEAST(r.available, v_remaining);

    UPDATE public.allocation_variant_breakdown AS avb
       SET qty_returned = avb.qty_returned + v_return_qty
     WHERE avb.breakdown_id = r.breakdown_id;

    UPDATE public.material_stock_batches AS b
       SET quantity_available = b.quantity_available + v_return_qty
     WHERE b.batch_id = r.batch_id;

    v_breakdown := v_breakdown || jsonb_build_array(jsonb_build_object(
      'batch_id', r.batch_id, 'variant_id', r.variant_id,
      'variant_name', r.variant_name, 'qty', v_return_qty,
      'unit_price', r.unit_price, 'value', v_return_qty * r.unit_price
    ));
    v_lines := v_lines || (
      v_return_qty::TEXT || ' @ Rs.' || r.unit_price::TEXT ||
      ' (variant="' || r.variant_name || '", batch#=' || r.batch_id || ')' ||
      ' = Rs.' || (v_return_qty * r.unit_price)::TEXT
    );

    v_total_value := v_total_value + (v_return_qty * r.unit_price);
    v_remaining   := v_remaining   - v_return_qty;
  END LOOP;

  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'Cannot return %: only % returnable on this allocation',
      p_qty_returned, p_qty_returned - v_remaining;
  END IF;

  v_notes :=
    'LIFO RETURN (direct): ' || p_qty_returned::TEXT || ' ' || COALESCE(v_metric, '') ||
    ' of ' || v_material_name ||
    ' returned from project "' || v_project_name || '" (#' || v_project_id || ')' ||
    ' to store' ||
    ' | breakdown: [' || array_to_string(v_lines, '; ') || ']' ||
    ' | total value = Rs.' || v_total_value::TEXT ||
    ' | alloc#=' || p_allocation_id ||
    ' | at=' || NOW()::TEXT;

  INSERT INTO public.material_movement_logs (
    material_id, movement_type, project_id, quantity,
    reference_type, reference_id, notes, created_by
  ) VALUES (
    v_material_id, 'Return to Store', v_project_id, p_qty_returned,
    'Material Return', p_allocation_id, v_notes, auth.uid()
  );

  RETURN QUERY SELECT p_allocation_id, p_qty_returned, v_total_value, v_breakdown;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_material_return(BIGINT, NUMERIC) TO authenticated;

NOTIFY pgrst, 'reload schema';
