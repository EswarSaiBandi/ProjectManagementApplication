-- ============================================================================
-- Link Quantity Variants to Price Variants
--
-- Adds:
--   1. material_price_variants.quantity_variant_id  → FK to material_variants
--   2. material_stock_batches.number_of_units       → bags/units received per batch
--   3. Replaces create_price_variant to accept p_quantity_variant_id
--   4. Replaces add_stock_to_store to accept p_number_of_units;
--      total quantity in base metric auto-computed as
--      number_of_units × quantity_per_unit (or 1 when no qty variant linked).
--   5. Refreshes all downstream views to expose qty-variant columns.
--
-- Backward compatible:
--   * quantity_variant_id is nullable — existing price variants keep working.
--   * When no qty variant is linked, number_of_units == raw base-metric quantity
--     (qty_per_unit treated as 1). All existing FIFO/LIFO allocation RPCs are
--     untouched — they operate on base-metric quantities in material_stock_batches.
-- ============================================================================

-- ============================================================================
-- 1. Schema changes
-- ============================================================================

-- Link price variants to a packaging size (quantity variant)
ALTER TABLE public.material_price_variants
  ADD COLUMN IF NOT EXISTS quantity_variant_id BIGINT
    REFERENCES public.material_variants(variant_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_mpv_qty_variant
  ON public.material_price_variants(quantity_variant_id)
  WHERE quantity_variant_id IS NOT NULL;

-- Drop the old active-price uniqueness index so we can replace it.
-- New logic: unique per (material, qty_variant, price) when qty_variant IS set;
--            unique per (material, price) for legacy rows with no qty_variant.
DROP INDEX IF EXISTS unique_active_price_per_material;

CREATE UNIQUE INDEX unique_active_price_with_qty_variant
  ON public.material_price_variants(material_id, quantity_variant_id, unit_price)
  WHERE is_active = TRUE AND quantity_variant_id IS NOT NULL;

CREATE UNIQUE INDEX unique_active_price_no_qty_variant
  ON public.material_price_variants(material_id, unit_price)
  WHERE is_active = TRUE AND quantity_variant_id IS NULL;

-- Track packaging units per stock batch
ALTER TABLE public.material_stock_batches
  ADD COLUMN IF NOT EXISTS number_of_units NUMERIC(12,3);

-- ============================================================================
-- 2. create_price_variant  (Admin only)
-- Now accepts an optional p_quantity_variant_id that links the price tier to
-- a specific packaging size (e.g., 50 kg bag, 20 kg bag).
-- ============================================================================

DROP FUNCTION IF EXISTS public.create_price_variant(BIGINT, TEXT, NUMERIC, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.create_price_variant(BIGINT, TEXT, NUMERIC, DATE, TEXT) CASCADE;

CREATE OR REPLACE FUNCTION public.create_price_variant(
  p_material_id           BIGINT,
  p_variant_name          TEXT,
  p_unit_price            NUMERIC(12,2),
  p_quantity_variant_id   BIGINT DEFAULT NULL,
  p_notes                 TEXT DEFAULT NULL      -- accepted for UI compat; stored on batches, not variant
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

  -- Validate qty variant belongs to the same material
  IF p_quantity_variant_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.material_variants
      WHERE variant_id = p_quantity_variant_id
        AND material_id = p_material_id
    ) THEN
      RAISE EXCEPTION
        'Quantity variant % does not belong to material %',
        p_quantity_variant_id, p_material_id;
    END IF;

    -- Uniqueness: same material + same qty variant + same price → duplicate
    IF EXISTS (
      SELECT 1 FROM public.material_price_variants
      WHERE material_id         = p_material_id
        AND quantity_variant_id = p_quantity_variant_id
        AND unit_price          = p_unit_price
        AND is_active           = TRUE
    ) THEN
      RAISE EXCEPTION
        'An active price variant already exists for this material + packaging size + price. Top up via Add Stock instead.';
    END IF;
  ELSE
    -- Legacy path: no qty variant
    IF EXISTS (
      SELECT 1 FROM public.material_price_variants
      WHERE material_id         = p_material_id
        AND quantity_variant_id IS NULL
        AND unit_price          = p_unit_price
        AND is_active           = TRUE
    ) THEN
      RAISE EXCEPTION
        'An active variant already exists for material % at price %. Top up that variant via Add Stock instead.',
        p_material_id, p_unit_price;
    END IF;
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
-- 3. add_stock_to_store  (Admin only)
-- p_number_of_units replaces the old p_quantity parameter.
-- When the price variant is linked to a quantity variant, total base-metric
-- quantity is computed automatically: number_of_units × quantity_per_unit.
-- When not linked (legacy), quantity_per_unit defaults to 1, so
-- number_of_units == base-metric quantity (identical to old behaviour).
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

  -- Fetch variant + optional qty-variant details
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
  LEFT JOIN public.material_variants mv ON mv.variant_id = mpv.quantity_variant_id
  WHERE mpv.variant_id = p_variant_id;

  IF v_material_id IS NULL THEN
    RAISE EXCEPTION 'Variant % not found', p_variant_id;
  END IF;

  IF NOT v_active THEN
    RAISE EXCEPTION
      'Variant % is deactivated. Cannot add new stock. Reactivate it first.',
      p_variant_id;
  END IF;

  -- Compute base-metric quantity
  v_total_quantity := p_number_of_units * COALESCE(v_qty_per_unit, 1);

  -- Insert batch (quantity_available starts == quantity_received)
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

  -- Movement log
  v_log_notes :=
    'STORE IN (new batch): '
    || p_number_of_units::TEXT
    || CASE
         WHEN v_qty_variant_name IS NOT NULL
           THEN ' × ' || v_qty_variant_name || ' (' || v_total_quantity::TEXT || ' ' || COALESCE(v_metric, '') || ')'
         ELSE ' ' || COALESCE(v_metric, 'units') || ' (raw)'
       END
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

-- ============================================================================
-- 4. Recreate views to expose quantity-variant columns
-- ============================================================================

-- Active variants dropdown (for Add Stock UI)
DROP VIEW IF EXISTS public.active_price_variants_dropdown CASCADE;
CREATE VIEW public.active_price_variants_dropdown AS
SELECT
  v.variant_id,
  v.material_id,
  m.material_name,
  v.variant_name,
  v.unit_price,
  v.quantity_variant_id,
  mv.variant_name     AS quantity_variant_name,
  mv.quantity_per_unit,
  CASE
    WHEN mv.variant_name IS NOT NULL
      THEN mv.variant_name || ' @ Rs. ' || v.unit_price::TEXT || '/' || m.metric
    ELSE v.variant_name || ' (Rs. ' || v.unit_price::TEXT || ')'
  END AS display_label,
  COALESCE(SUM(b.quantity_available), 0) AS quantity_available
FROM public.material_price_variants v
JOIN public.materials_master m ON m.material_id = v.material_id
LEFT JOIN public.material_variants mv ON mv.variant_id = v.quantity_variant_id
LEFT JOIN public.material_stock_batches b ON b.variant_id = v.variant_id
WHERE v.is_active = TRUE
GROUP BY
  v.variant_id, v.material_id, m.material_name, v.variant_name, v.unit_price,
  v.quantity_variant_id, mv.variant_name, mv.quantity_per_unit, m.metric
ORDER BY v.material_id, v.variant_id;

-- Per-variant summary for admin page
DROP VIEW IF EXISTS public.material_stock_variants_admin CASCADE;
CREATE VIEW public.material_stock_variants_admin AS
SELECT
  m.material_id,
  m.material_name,
  m.metric,
  v.variant_id,
  v.variant_name,
  v.unit_price,
  v.is_active,
  v.quantity_variant_id,
  mv.variant_name                            AS quantity_variant_name,
  mv.quantity_per_unit,
  COUNT(b.batch_id)                          AS batch_count,
  MIN(b.batch_date)                          AS earliest_batch_date,
  MAX(b.batch_date)                          AS latest_batch_date,
  COALESCE(SUM(b.quantity_received),  0)     AS quantity_received,
  COALESCE(SUM(b.quantity_available), 0)     AS quantity_available,
  COALESCE(SUM(b.number_of_units),    0)     AS total_units,
  (COALESCE(SUM(b.quantity_available), 0) * v.unit_price)::NUMERIC(14,2) AS stock_value,
  v.created_at,
  v.created_by
FROM public.materials_master m
JOIN public.material_price_variants v ON v.material_id = m.material_id
LEFT JOIN public.material_variants mv ON mv.variant_id = v.quantity_variant_id
LEFT JOIN public.material_stock_batches b ON b.variant_id = v.variant_id
GROUP BY
  m.material_id, m.material_name, m.metric,
  v.variant_id, v.variant_name, v.unit_price, v.is_active,
  v.quantity_variant_id, mv.variant_name, mv.quantity_per_unit,
  v.created_at, v.created_by;

-- Per-batch detail (expandable under each variant)
DROP VIEW IF EXISTS public.material_stock_batches_admin CASCADE;
CREATE VIEW public.material_stock_batches_admin AS
SELECT
  m.material_id,
  m.material_name,
  m.metric,
  v.variant_id,
  v.variant_name,
  v.unit_price,
  v.is_active                                      AS variant_is_active,
  v.quantity_variant_id,
  mv.variant_name                                  AS quantity_variant_name,
  mv.quantity_per_unit,
  b.batch_id,
  b.batch_date,
  b.quantity_received,
  b.quantity_available,
  b.number_of_units,
  (b.quantity_received - b.quantity_available)     AS quantity_outflow,
  (b.quantity_available * v.unit_price)::NUMERIC(14,2) AS stock_value,
  b.invoice_number,
  b.bill_path,
  b.notes,
  b.created_at,
  b.created_by
FROM public.materials_master m
JOIN public.material_price_variants v ON v.material_id = m.material_id
LEFT JOIN public.material_variants mv ON mv.variant_id = v.quantity_variant_id
JOIN public.material_stock_batches b ON b.variant_id = v.variant_id;

-- Per-material aggregate (Inventory tab)
DROP VIEW IF EXISTS public.store_stock_by_material CASCADE;
CREATE VIEW public.store_stock_by_material AS
SELECT
  m.material_id,
  m.material_name,
  m.metric,
  m.is_active                                        AS material_is_active,
  COUNT(DISTINCT v.variant_id)                       AS total_variants,
  COUNT(DISTINCT v.variant_id) FILTER (WHERE v.is_active) AS active_variants,
  COUNT(b.batch_id)                                  AS total_batches,
  COALESCE(SUM(b.quantity_received),  0)             AS total_received,
  COALESCE(SUM(b.quantity_available), 0)             AS total_available,
  COALESCE(SUM(b.quantity_available * v.unit_price), 0)::NUMERIC(14,2) AS total_stock_value,
  MIN(v.unit_price) FILTER (WHERE b.quantity_available > 0) AS min_price_in_stock,
  MAX(v.unit_price) FILTER (WHERE b.quantity_available > 0) AS max_price_in_stock
FROM public.materials_master m
LEFT JOIN public.material_price_variants v  ON v.material_id = m.material_id
LEFT JOIN public.material_stock_batches  b  ON b.variant_id  = v.variant_id
GROUP BY m.material_id, m.material_name, m.metric, m.is_active;

-- ============================================================================
-- 5. Re-grant view permissions
-- ============================================================================

GRANT SELECT ON public.active_price_variants_dropdown   TO authenticated;
GRANT SELECT ON public.material_stock_variants_admin    TO authenticated;
GRANT SELECT ON public.material_stock_batches_admin     TO authenticated;
GRANT SELECT ON public.store_stock_by_material          TO authenticated;

-- ============================================================================
-- Reload PostgREST schema cache
-- ============================================================================

NOTIFY pgrst, 'reload schema';
