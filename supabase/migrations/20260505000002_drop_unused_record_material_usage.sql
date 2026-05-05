-- ============================================================================
-- Drop the obsolete single-allocation record_material_usage(allocation_id, qty)
-- function.
--
-- Superseded by record_material_usage_by_material(project, material, qty,
-- qty_variant_id) from 20260502000011 / 20260504000007, which is the only
-- function the UI ([StockUsedFifoTab.tsx](apps/web/components/project-tabs/StockUsedFifoTab.tsx))
-- calls. The old single-allocation RPC skipped the project-wide returnable-
-- quantity check and had no MV-scope support — leaving it callable was a
-- correctness risk.
-- ============================================================================

DROP FUNCTION IF EXISTS public.record_material_usage(BIGINT, NUMERIC) CASCADE;

NOTIFY pgrst, 'reload schema';
