-- ============================================================================
-- Return-to-Store request flow (parallel to the Material Request flow).
--
-- New model:
--   1. Project team submits a Return-to-Store REQUEST via UI (material + qty +
--      condition + reason). Creates a material_returns row with status='Pending'.
--      No stock movement yet. Only validation: qty must not exceed
--      allocated - used - returned - pending_return for that project+material.
--   2. Store admin reviews in Material Returns tab on /store.
--      - On Approve: LIFO-walks this project's allocation breakdown rows for
--        that material, newest-used-or-allocated first, increments qty_returned,
--        and returns stock to the corresponding batch.quantity_available.
--      - On Reject: no stock movement.
--
-- Everything lands in material_movement_logs:
--   * 'Return Submitted'   — on request creation (with request_number)
--   * 'Return Accepted'    — on approval (with LIFO breakdown + total value)
--   * 'Return to Store'    — on approval, physical stock movement entry (alt
--                             view shows batch re-credits). Skipped here to
--                             avoid double-logging — Return Accepted already
--                             has the full breakdown.
--   * 'Return Rejected'    — on rejection
--
-- Run AFTER 20260502000013_recreate_project_costing_summary.sql.
-- ============================================================================

-- ============================================================================
-- submit_material_return_request
-- Validates returnable quantity then creates a Pending material_returns row.
-- ============================================================================

DROP FUNCTION IF EXISTS public.submit_material_return_request(BIGINT, BIGINT, NUMERIC, TEXT, TEXT) CASCADE;

CREATE OR REPLACE FUNCTION public.submit_material_return_request(
  p_project_id   BIGINT,
  p_material_id  BIGINT,
  p_quantity     NUMERIC(12,3),
  p_condition    TEXT,
  p_reason       TEXT DEFAULT NULL
)
RETURNS TABLE (
  return_id       BIGINT,
  return_number   TEXT,
  returnable_after NUMERIC(12,3)
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_material_name   TEXT;
  v_metric          TEXT;
  v_project_name    TEXT;
  v_allocated       NUMERIC(12,3);
  v_used            NUMERIC(12,3);
  v_returned        NUMERIC(12,3);
  v_pending_return  NUMERIC(12,3);
  v_returnable      NUMERIC(12,3);
  v_return_id       BIGINT;
  v_return_number   TEXT;
  v_notes           TEXT;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'quantity must be > 0';
  END IF;

  IF p_condition IS NULL OR btrim(p_condition) = '' THEN
    RAISE EXCEPTION 'condition is required';
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

  -- Compute returnable (LIFO) = allocated − used − already-returned − pending-return
  SELECT
    COALESCE(SUM(avb.qty_allocated), 0),
    COALESCE(SUM(avb.qty_used),      0),
    COALESCE(SUM(avb.qty_returned),  0)
    INTO v_allocated, v_used, v_returned
  FROM public.allocation_variant_breakdown avb
  JOIN public.material_allocations ma ON ma.allocation_id = avb.allocation_id
  WHERE ma.project_id  = p_project_id
    AND ma.material_id = p_material_id;

  SELECT COALESCE(SUM(returned_quantity), 0) INTO v_pending_return
  FROM public.material_returns
  WHERE project_id  = p_project_id
    AND material_id = p_material_id
    AND status      = 'Pending';

  v_returnable := v_allocated - v_used - v_returned - v_pending_return;

  IF p_quantity > v_returnable THEN
    RAISE EXCEPTION
      'Cannot request return of % %: only % returnable for "%" in project "%" (allocated=%, used=%, already-returned=%, pending-return=%)',
      p_quantity, COALESCE(v_metric, ''), v_returnable, v_material_name, v_project_name,
      v_allocated, v_used, v_returned, v_pending_return;
  END IF;

  -- Generate a simple return_number (RR-<epoch>).
  v_return_number := 'RR-' || EXTRACT(EPOCH FROM NOW())::BIGINT::TEXT;

  INSERT INTO public.material_returns (
    return_number, project_id, material_id, returned_quantity,
    condition, reason, status, created_by
  ) VALUES (
    v_return_number, p_project_id, p_material_id, p_quantity,
    p_condition, p_reason, 'Pending', auth.uid()
  )
  RETURNING material_returns.return_id INTO v_return_id;

  v_notes :=
    'RETURN SUBMITTED: ' || p_quantity::TEXT || ' ' || COALESCE(v_metric, '') ||
    ' of ' || v_material_name ||
    ' (project "' || v_project_name || '" #' || p_project_id || ')' ||
    ' | return#=' || v_return_number ||
    ' | condition=' || p_condition ||
    CASE WHEN p_reason IS NOT NULL AND btrim(p_reason) <> ''
         THEN ' | reason="' || p_reason || '"' ELSE '' END ||
    ' | awaiting store approval' ||
    ' | at=' || NOW()::TEXT;

  INSERT INTO public.material_movement_logs (
    material_id, movement_type, project_id, quantity,
    reference_type, reference_id, notes, created_by
  ) VALUES (
    p_material_id, 'Return Submitted', p_project_id, p_quantity,
    'Material Return', v_return_id, v_notes, auth.uid()
  );

  RETURN QUERY SELECT v_return_id, v_return_number, (v_returnable - p_quantity)::NUMERIC(12,3);
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_material_return_request(BIGINT, BIGINT, NUMERIC, TEXT, TEXT) TO authenticated;

-- ============================================================================
-- approve_material_return_request  (Admin only)
-- Performs the actual LIFO stock movement and marks the request Accepted.
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

  -- LIFO: newest breakdown row first.
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
    ORDER BY avb.breakdown_id DESC        -- LIFO
    FOR UPDATE OF avb
  LOOP
    EXIT WHEN v_remaining <= 0;

    v_return_qty := LEAST(r.available, v_remaining);

    UPDATE public.allocation_variant_breakdown
    SET qty_returned = qty_returned + v_return_qty
    WHERE allocation_variant_breakdown.breakdown_id = r.breakdown_id;

    -- Physical stock returns to the specific batch.
    UPDATE public.material_stock_batches
    SET quantity_available = quantity_available + v_return_qty
    WHERE material_stock_batches.batch_id = r.batch_id;

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

  -- Mark the request Accepted.
  UPDATE public.material_returns
  SET status       = 'Accepted',
      reviewed_at  = NOW(),
      review_notes = COALESCE(p_review_notes, 'Accepted by store'),
      reviewed_by  = auth.uid()
  WHERE material_returns.return_id = p_return_id;

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
-- reject_material_return_request  (Admin only)
-- ============================================================================

DROP FUNCTION IF EXISTS public.reject_material_return_request(BIGINT, TEXT) CASCADE;

CREATE OR REPLACE FUNCTION public.reject_material_return_request(
  p_return_id     BIGINT,
  p_review_notes  TEXT DEFAULT NULL
)
RETURNS TABLE (
  return_id    BIGINT,
  qty_rejected NUMERIC(12,3)
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project_id    BIGINT;
  v_material_id   BIGINT;
  v_qty           NUMERIC(12,3);
  v_status        TEXT;
  v_return_number TEXT;
  v_material_name TEXT;
  v_metric        TEXT;
  v_project_name  TEXT;
  v_notes         TEXT;
BEGIN
  PERFORM public._assert_admin();

  SELECT mr.project_id, mr.material_id, mr.returned_quantity, mr.status,
         mr.return_number, m.material_name, m.metric, p.project_name
    INTO v_project_id, v_material_id, v_qty, v_status,
         v_return_number, v_material_name, v_metric, v_project_name
  FROM public.material_returns mr
  JOIN public.materials_master m ON m.material_id = mr.material_id
  JOIN public.projects p         ON p.project_id  = mr.project_id
  WHERE mr.return_id = p_return_id;

  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'Return request % not found', p_return_id;
  END IF;

  IF v_status <> 'Pending' THEN
    RAISE EXCEPTION 'Return request % is already % — cannot reject', p_return_id, v_status;
  END IF;

  UPDATE public.material_returns
  SET status       = 'Rejected',
      reviewed_at  = NOW(),
      review_notes = COALESCE(p_review_notes, 'Rejected by store'),
      reviewed_by  = auth.uid()
  WHERE material_returns.return_id = p_return_id;

  v_notes :=
    'RETURN REJECTED: ' || v_qty::TEXT || ' ' || COALESCE(v_metric, '') ||
    ' of ' || v_material_name ||
    ' (project "' || v_project_name || '" #' || v_project_id || ')' ||
    ' | return#=' || v_return_number ||
    CASE WHEN p_review_notes IS NOT NULL AND btrim(p_review_notes) <> ''
         THEN ' | reason="' || p_review_notes || '"' ELSE '' END ||
    ' | no stock movement' ||
    ' | at=' || NOW()::TEXT;

  INSERT INTO public.material_movement_logs (
    material_id, movement_type, project_id, quantity,
    reference_type, reference_id, notes, created_by
  ) VALUES (
    v_material_id, 'Return Rejected', v_project_id, v_qty,
    'Material Return', p_return_id, v_notes, auth.uid()
  );

  RETURN QUERY SELECT p_return_id, v_qty;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reject_material_return_request(BIGINT, TEXT) TO authenticated;

-- Add reviewed_by column to material_returns if missing (for audit).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='material_returns' AND column_name='reviewed_by'
  ) THEN
    ALTER TABLE public.material_returns ADD COLUMN reviewed_by UUID REFERENCES auth.users(id);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
