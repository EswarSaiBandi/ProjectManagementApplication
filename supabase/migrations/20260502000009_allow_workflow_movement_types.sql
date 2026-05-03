-- ============================================================================
-- Extend material_movement_logs.movement_type to allow workflow lifecycle
-- events alongside the existing physical stock movements.
--
-- Reason: request/return lifecycle (raised, cancelled, rejected, accepted)
-- was not captured anywhere. Adding these as additional movement_type values
-- so Project Material Movements tab reflects the full audit trail.
--
-- Physical stock movement types (unchanged):
--   'Store In', 'Store Out', 'Project In', 'Project Out',
--   'Return to Store', 'Local Procurement'
--
-- New workflow event types:
--   'Request Raised'     — user submitted a new Material Request
--   'Request Cancelled'  — user cancelled their own pending request
--   'Request Rejected'   — admin rejected the request (no stock moved)
--   'Return Submitted'   — user submitted a Material Return (before review)
--   'Return Accepted'    — admin accepted the returned stock
--   'Return Rejected'    — admin rejected the return
--
-- Run AFTER 20260502000008_fix_create_price_variant_for_batch_model.sql.
-- ============================================================================

ALTER TABLE public.material_movement_logs
  DROP CONSTRAINT IF EXISTS material_movement_logs_movement_type_check;

ALTER TABLE public.material_movement_logs
  ADD CONSTRAINT material_movement_logs_movement_type_check
  CHECK (movement_type IN (
    -- Physical stock movements
    'Store In', 'Store Out', 'Project In', 'Project Out',
    'Return to Store', 'Local Procurement',
    -- Workflow lifecycle events
    'Request Raised', 'Request Cancelled', 'Request Rejected',
    'Return Submitted', 'Return Accepted', 'Return Rejected'
  ));

NOTIFY pgrst, 'reload schema';
