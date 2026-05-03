-- ============================================================================
-- FIFO/LIFO Cutover  —  ZERO LEGACY INVENTORY  &  CANCEL PENDING STATE
--
-- Run AFTER 20260502000000_fifo_lifo_pricing_variants_v2.sql.
--
-- WHAT THIS DOES (destructive-ish, but reversible via backup tables):
--   * Snapshots pre-cutover state into _fifo_cutover_backup_* tables.
--   * Cancels every open material_allocation (Reserved / Issued / Partially Issued).
--   * Cancels every open material_request     (Pending / Approved).
--   * Rejects every pending material_return   (Pending).
--   * Scraps every live excess_material       (Available / Reserved).
--   * Zeros store_inventory (rows removed; no FKs point at it).
--
-- NOTE: materials_master has no `quantity` column (it was dropped with the
-- old `material_master` singular table). Stock has been tracked in
-- store_inventory only since Feb 2026.
--
-- After this migration, the only source of truth for on-hand stock is:
--   material_price_variants.quantity_available
-- and Admins must re-enter current physical stock by creating variants and
-- calling add_stock_to_store().
--
-- Backup tables keep the pre-cutover state for audit / rollback forensics.
-- They are intentionally not dropped. Rename or drop them manually once you
-- are confident the cutover is final.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Snapshot everything we are about to mutate.
-- ---------------------------------------------------------------------------

DROP TABLE IF EXISTS public._fifo_cutover_backup_store_inventory;
CREATE TABLE public._fifo_cutover_backup_store_inventory AS
SELECT *, NOW() AS backed_up_at
FROM public.store_inventory;

DROP TABLE IF EXISTS public._fifo_cutover_backup_material_allocations;
CREATE TABLE public._fifo_cutover_backup_material_allocations AS
SELECT *, NOW() AS backed_up_at
FROM public.material_allocations
WHERE status IN ('Reserved', 'Issued', 'Partially Issued');

DROP TABLE IF EXISTS public._fifo_cutover_backup_material_requests;
CREATE TABLE public._fifo_cutover_backup_material_requests AS
SELECT *, NOW() AS backed_up_at
FROM public.material_requests
WHERE status IN ('Pending', 'Approved');

DROP TABLE IF EXISTS public._fifo_cutover_backup_excess_materials;
CREATE TABLE public._fifo_cutover_backup_excess_materials AS
SELECT *, NOW() AS backed_up_at
FROM public.excess_materials
WHERE status IN ('Available', 'Reserved');

DROP TABLE IF EXISTS public._fifo_cutover_backup_material_returns;
CREATE TABLE public._fifo_cutover_backup_material_returns AS
SELECT *, NOW() AS backed_up_at
FROM public.material_returns
WHERE status = 'Pending';

-- ---------------------------------------------------------------------------
-- 2. Cancel all open material_allocations.
--    Leave Returned/Cancelled rows alone — they are historical.
-- ---------------------------------------------------------------------------

UPDATE public.material_allocations
SET status     = 'Cancelled',
    notes      = COALESCE(notes || ' | ', '') || 'Auto-cancelled on FIFO cutover ' || NOW()::TEXT,
    updated_at = NOW()
WHERE status IN ('Reserved', 'Issued', 'Partially Issued');

-- ---------------------------------------------------------------------------
-- 3. Cancel all open material_requests.  (No updated_at column on this table.)
-- ---------------------------------------------------------------------------

UPDATE public.material_requests
SET status            = 'Cancelled',
    fulfillment_notes = COALESCE(fulfillment_notes || ' | ', '')
                        || 'Auto-cancelled on FIFO cutover ' || NOW()::TEXT
WHERE status IN ('Pending', 'Approved');

-- ---------------------------------------------------------------------------
-- 4. Reject all pending material_returns.  (No updated_at column.)
-- ---------------------------------------------------------------------------

UPDATE public.material_returns
SET status       = 'Rejected',
    review_notes = COALESCE(review_notes || ' | ', '')
                   || 'Auto-rejected on FIFO cutover ' || NOW()::TEXT,
    reviewed_at  = NOW()
WHERE status = 'Pending';

-- ---------------------------------------------------------------------------
-- 5. Scrap all live excess_materials.
--    Reason: underlying stock is being zeroed; these return-to-store rows
--    can no longer be reused.
-- ---------------------------------------------------------------------------

UPDATE public.excess_materials
SET status     = 'Scrapped',
    notes      = COALESCE(notes || ' | ', '') || 'Auto-scrapped on FIFO cutover ' || NOW()::TEXT,
    updated_at = NOW()
WHERE status IN ('Available', 'Reserved');

-- ---------------------------------------------------------------------------
-- 6. Zero store_inventory. No FKs reference it (verified).
-- ---------------------------------------------------------------------------

DELETE FROM public.store_inventory;

-- ---------------------------------------------------------------------------
-- 7. Reload PostgREST schema cache.
-- ---------------------------------------------------------------------------

NOTIFY pgrst, 'reload schema';
