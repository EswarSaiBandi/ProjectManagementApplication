-- ============================================================================
-- Make quantity_variant_id NOT NULL on material_price_variants.
--
-- Steps:
--   1. Delete ALL existing stock data (in FK-safe order).
--   2. ALTER COLUMN quantity_variant_id SET NOT NULL.
--   3. Drop legacy unique index (was for NULL qty_variant rows).
--   4. Replace create_price_variant — p_quantity_variant_id now required.
--   5. Replace add_stock_to_store   — remove COALESCE fallback.
-- ============================================================================

-- ============================================================================
-- 1. Delete all existing stock data (FK-safe order)
-- ============================================================================

-- Breakdown rows reference allocations, batches, and price variants.
DELETE FROM public.allocation_variant_breakdown;

-- Allocations reference materials and projects.
DELETE FROM public.material_allocations;

-- Returns reference projects and materials (no FK to allocations).
DELETE FROM public.material_returns;

-- Material requests (all statuses — fulfilled ones are now orphaned).
DELETE FROM public.material_requests;

-- Movement logs for all store / stock events.
DELETE FROM public.material_movement_logs
WHERE movement_type IN (
  'Store In', 'Store Out',
  'Project In', 'Project Out',
  'Return to Store',
  'Request Raised', 'Request Cancelled', 'Request Rejected',
  'Return Submitted', 'Return Accepted', 'Return Rejected',
  'Stock Used', 'Project Usage Reverted',
  'Project Out (Return Approved)',
  'Local Procurement'
);

-- Batches reference price variants.
DELETE FROM public.material_stock_batches;

-- Price variants (now safe to delete).
DELETE FROM public.material_price_variants;

-- ============================================================================
-- 2. Make quantity_variant_id NOT NULL
-- ============================================================================

ALTER TABLE public.material_price_variants
  ALTER COLUMN quantity_variant_id SET NOT NULL;

-- ============================================================================
-- 3. Replace unique indexes
--    Old: two partial indexes — one for NULL, one for NOT NULL qty_variant.
--    New: one simple unique index (qty_variant_id always NOT NULL now).
-- ============================================================================

DROP INDEX IF EXISTS unique_active_price_with_qty_variant;
DROP INDEX IF EXISTS unique_active_price_no_qty_variant;

CREATE UNIQUE INDEX unique_active_price_variant
  ON public.material_price_variants (material_id, quantity_variant_id, unit_price)
  WHERE is_active = TRUE;

-- ============================================================================
-- 4. create_price_variant — p_quantity_variant_id is now REQUIRED
-- ============================================================================

DROP FUNCTION IF EXISTS public.create_price_variant(BIGINT, TEXT, NUMERIC, BIGINT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.create_price_variant(BIGINT, TEXT, NUMERIC, TEXT)          CASCADE;
DROP FUNCTION IF EXISTS public.create_price_variant(BIGINT, TEXT, NUMERIC, DATE, TEXT)    CASCADE;

CREATE OR REPLACE FUNCTION public.create_price_variant(
  p_material_id         BIGINT,
  p_variant_name        TEXT,
  p_unit_price          NUMERIC(12,2),
  p_quantity_variant_id BIGINT,           -- required; no default
  p_notes               TEXT DEFAULT NULL -- accepted for UI compat; not stored on variant
)
RETURNS public.material_price_variants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.material_price_variants;
BEGIN
  PERFORM public._assert_admin();

  IF NOT EXISTS (SELECT 1 FROM public.materials_master WHERE material_id = p_material_id) THEN
    RAISE EXCEPTION 'Material % does not exist', p_material_id;
  END IF;

  IF p_unit_price IS NULL OR p_unit_price <= 0 THEN
    RAISE EXCEPTION 'unit_price must be > 0';
  END IF;

  IF p_variant_name IS NULL OR btrim(p_variant_name) = '' THEN
    RAISE EXCEPTION 'variant_name is required';
  END IF;

  IF p_quantity_variant_id IS NULL THEN
    RAISE EXCEPTION 'quantity_variant_id is required — pick a packaging size (e.g. 50 kg Bag)';
  END IF;

  -- Quantity variant must belong to the same material.
  IF NOT EXISTS (
    SELECT 1 FROM public.material_variants
    WHERE variant_id  = p_quantity_variant_id
      AND material_id = p_material_id
  ) THEN
    RAISE EXCEPTION
      'Quantity variant % does not belong to material %',
      p_quantity_variant_id, p_material_id;
  END IF;

  -- Prevent duplicate active price for the same material + packaging + price.
  IF EXISTS (
    SELECT 1 FROM public.material_price_variants
    WHERE material_id         = p_material_id
      AND quantity_variant_id = p_quantity_variant_id
      AND unit_price          = p_unit_price
      AND is_active           = TRUE
  ) THEN
    RAISE EXCEPTION
      'An active price variant already exists for this material + packaging + price. Top up via Add Stock instead.';
  END IF;

  INSERT INTO public.material_price_variants (
    material_id, variant_name, unit_price, quantity_variant_id, created_by
  ) VALUES (
    p_material_id,
    btrim(p_variant_name),
    p_unit_price,
    p_quantity_variant_id,
    auth.uid()
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_price_variant(BIGINT, TEXT, NUMERIC, BIGINT, TEXT) TO authenticated;

-- ============================================================================
-- 5. add_stock_to_store — remove COALESCE fallback; qty_per_unit always present
-- ============================================================================

DROP FUNCTION IF EXISTS public.add_stock_to_store(BIGINT, NUMERIC, TEXT, TEXT, TEXT) CASCADE;

CREATE OR REPLACE FUNCTION public.add_stock_to_store(
  p_variant_id      BIGINT,
  p_number_of_units NUMERIC(12,3),
  p_bill_path       TEXT DEFAULT NULL,
  p_invoice_number  TEXT DEFAULT NULL,
  p_notes           TEXT DEFAULT NULL
)
RETURNS TABLE (
  batch_id         BIGINT,
  variant_id       BIGINT,
  variant_name     TEXT,
  number_of_units  NUMERIC(12,3),
  quantity_added   NUMERIC(12,3),
  unit_price       NUMERIC(12,2),
  total_value      NUMERIC(14,2),
  batch_date       DATE,
  bill_path        TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_material_id      BIGINT;
  v_material_name    TEXT;
  v_metric           TEXT;
  v_name             TEXT;
  v_price            NUMERIC(12,2);
  v_active           BOOLEAN;
  v_qty_per_unit     NUMERIC(12,3);
  v_qty_variant_name TEXT;
  v_total_quantity   NUMERIC(12,3);
  v_batch_id         BIGINT;
  v_batch_date       DATE := CURRENT_DATE;
  v_log_notes        TEXT;
BEGIN
  PERFORM public._assert_admin();

  IF p_number_of_units IS NULL OR p_number_of_units <= 0 THEN
    RAISE EXCEPTION 'number_of_units must be > 0';
  END IF;

  -- Fetch variant + qty-variant details (qty_variant always present now).
  SELECT
    mpv.material_id, mpv.variant_name, mpv.unit_price, mpv.is_active,
    m.material_name, m.metric,
    mv.quantity_per_unit, mv.variant_name
  INTO
    v_material_id, v_name, v_price, v_active,
    v_material_name, v_metric,
    v_qty_per_unit, v_qty_variant_name
  FROM public.material_price_variants mpv
  JOIN public.materials_master m ON m.material_id = mpv.material_id
  JOIN public.material_variants mv ON mv.variant_id = mpv.quantity_variant_id
  WHERE mpv.variant_id = p_variant_id;

  IF v_material_id IS NULL THEN
    RAISE EXCEPTION 'Variant % not found', p_variant_id;
  END IF;

  IF NOT v_active THEN
    RAISE EXCEPTION
      'Variant % is deactivated. Cannot add new stock. Reactivate it first.',
      p_variant_id;
  END IF;

  -- Total base-metric quantity: units × qty_per_unit.
  v_total_quantity := p_number_of_units * v_qty_per_unit;

  -- Insert batch.
  INSERT INTO public.material_stock_batches (
    variant_id, batch_date,
    quantity_received, quantity_available,
    number_of_units,
    invoice_number, bill_path, notes, created_by
  ) VALUES (
    p_variant_id, v_batch_date,
    v_total_quantity, v_total_quantity,
    p_number_of_units,
    p_invoice_number, p_bill_path, p_notes, auth.uid()
  )
  RETURNING material_stock_batches.batch_id INTO v_batch_id;

  -- Movement log.
  v_log_notes :=
    'STORE IN (new batch): '
    || p_number_of_units::TEXT
    || ' × ' || v_qty_variant_name
    || ' (' || v_total_quantity::TEXT || ' ' || COALESCE(v_metric, '') || ')'
    || ' of ' || v_material_name
    || ' @ Rs.' || v_price::TEXT || '/' || COALESCE(v_metric, 'unit')
    || ' (variant="' || v_name || '", batch#=' || v_batch_id
    || ', batch_date=' || v_batch_date::TEXT || ')'
    || ' total_value=Rs.' || (v_total_quantity * v_price)::TEXT
    || ' | invoice=' || COALESCE(p_invoice_number, 'N/A')
    || ' | bill=' || COALESCE(p_bill_path, 'N/A')
    || CASE WHEN p_notes IS NOT NULL THEN ' | remark="' || p_notes || '"' ELSE '' END
    || ' | at=' || NOW()::TEXT;

  INSERT INTO public.material_movement_logs (
    material_id, movement_type, project_id, quantity,
    reference_type, reference_id, notes, created_by
  ) VALUES (
    v_material_id, 'Store In', NULL, v_total_quantity,
    'Manual Adjustment', v_batch_id,
    v_log_notes,
    auth.uid()
  );

  RETURN QUERY
  SELECT
    v_batch_id, p_variant_id, v_name,
    p_number_of_units, v_total_quantity,
    v_price, (v_total_quantity * v_price)::NUMERIC(14,2),
    v_batch_date, p_bill_path;
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_stock_to_store(BIGINT, NUMERIC, TEXT, TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
