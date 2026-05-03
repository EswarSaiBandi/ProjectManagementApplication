-- ============================================================================
-- Project-side cancellation for a pending return request (mirrors the Material
-- Request cancellation flow).
--
-- Adds:
--   * material_returns.status can be 'Cancelled' (in addition to Pending,
--     Accepted, Rejected)
--   * movement_type 'Return Cancelled' in material_movement_logs
--   * cancel_material_return_request(return_id, reason?) RPC
--
-- Only Pending returns can be cancelled. No stock movement (submit had none
-- either — stock only moves on Accept).
--
-- Run AFTER 20260502000014_return_to_store_request_flow.sql.
-- ============================================================================

-- Widen material_returns.status CHECK to allow 'Cancelled'.
ALTER TABLE public.material_returns
  DROP CONSTRAINT IF EXISTS material_returns_status_check;

ALTER TABLE public.material_returns
  ADD CONSTRAINT material_returns_status_check
  CHECK (status IN ('Pending', 'Accepted', 'Rejected', 'Cancelled'));

-- Widen movement_type CHECK to include 'Return Cancelled'.
ALTER TABLE public.material_movement_logs
  DROP CONSTRAINT IF EXISTS material_movement_logs_movement_type_check;

ALTER TABLE public.material_movement_logs
  ADD CONSTRAINT material_movement_logs_movement_type_check
  CHECK (movement_type IN (
    'Store In', 'Store Out', 'Project In',
    'Return to Store', 'Local Procurement',
    'Stock Used', 'Stock Used Reverted',
    'Request Raised', 'Request Cancelled', 'Request Rejected',
    'Return Submitted', 'Return Accepted', 'Return Rejected', 'Return Cancelled'
  ));

-- ============================================================================
-- cancel_material_return_request
-- Project-side cancellation. Caller's role isn't restricted — any authenticated
-- user can cancel their own/submitted pending returns. Tighten in app layer
-- if needed.
-- ============================================================================

DROP FUNCTION IF EXISTS public.cancel_material_return_request(BIGINT, TEXT) CASCADE;

CREATE OR REPLACE FUNCTION public.cancel_material_return_request(
  p_return_id BIGINT,
  p_reason    TEXT DEFAULT NULL
)
RETURNS TABLE (
  return_id     BIGINT,
  qty_cancelled NUMERIC(12,3)
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
    RAISE EXCEPTION 'Return request % is % — only Pending requests can be cancelled',
      p_return_id, v_status;
  END IF;

  UPDATE public.material_returns
  SET status       = 'Cancelled',
      reviewed_at  = NOW(),
      review_notes = COALESCE(p_reason, 'Cancelled by requester')
  WHERE material_returns.return_id = p_return_id;

  v_notes :=
    'RETURN CANCELLED: ' || v_qty::TEXT || ' ' || COALESCE(v_metric, '') ||
    ' of ' || v_material_name ||
    ' (project "' || v_project_name || '" #' || v_project_id || ')' ||
    ' | return#=' || v_return_number ||
    CASE WHEN p_reason IS NOT NULL AND btrim(p_reason) <> ''
         THEN ' | reason="' || p_reason || '"' ELSE '' END ||
    ' | cancelled by project, no stock movement' ||
    ' | at=' || NOW()::TEXT;

  INSERT INTO public.material_movement_logs (
    material_id, movement_type, project_id, quantity,
    reference_type, reference_id, notes, created_by
  ) VALUES (
    v_material_id, 'Return Cancelled', v_project_id, v_qty,
    'Material Return', p_return_id, v_notes, auth.uid()
  );

  RETURN QUERY SELECT p_return_id, v_qty;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_material_return_request(BIGINT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
