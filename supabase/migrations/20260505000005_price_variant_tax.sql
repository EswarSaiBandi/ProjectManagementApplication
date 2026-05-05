-- ============================================================================
-- Price Variant Tax: CGST+SGST or IGST at 0/5/12/18%
--
-- Changes:
--   1. TRUNCATE material_price_variants CASCADE (wipes batches + breakdown).
--   2. Add tax columns on material_price_variants:
--        - base_unit_price (pre-tax rate per base metric unit, NOT NULL)
--        - tax_type ('CGST_SGST' | 'IGST', NOT NULL)
--        - tax_rate (0, 5, 12, 18; NOT NULL)
--        - cgst_rate, sgst_rate, igst_rate (derived split; NOT NULL)
--      unit_price is kept tax-INCLUSIVE so existing FIFO/LIFO RPCs and views
--      continue to cost consumption at the final paid rate without changes.
--   3. Replace create_price_variant to take (p_base_unit_price, p_tax_type,
--      p_tax_rate); it computes tax-inclusive unit_price and splits components.
--   4. Extend admin + dropdown views to surface tax columns.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Wipe existing variants and dependents
-- ---------------------------------------------------------------------------

TRUNCATE TABLE
  public.allocation_variant_breakdown,
  public.material_price_variants
  RESTART IDENTITY CASCADE;

-- ---------------------------------------------------------------------------
-- 2. Schema: tax columns
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'price_variant_tax_type') THEN
    CREATE TYPE public.price_variant_tax_type AS ENUM ('CGST_SGST', 'IGST');
  END IF;
END$$;

ALTER TABLE public.material_price_variants
  ADD COLUMN IF NOT EXISTS base_unit_price NUMERIC(12,4),
  ADD COLUMN IF NOT EXISTS tax_type        public.price_variant_tax_type,
  ADD COLUMN IF NOT EXISTS tax_rate        NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS cgst_rate       NUMERIC(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sgst_rate       NUMERIC(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS igst_rate       NUMERIC(5,2) NOT NULL DEFAULT 0;

-- After truncate the table is empty, so we can set NOT NULL safely.
ALTER TABLE public.material_price_variants
  ALTER COLUMN base_unit_price SET NOT NULL,
  ALTER COLUMN tax_type        SET NOT NULL,
  ALTER COLUMN tax_rate        SET NOT NULL;

ALTER TABLE public.material_price_variants
  DROP CONSTRAINT IF EXISTS mpv_tax_rate_allowed,
  DROP CONSTRAINT IF EXISTS mpv_tax_split_valid,
  DROP CONSTRAINT IF EXISTS mpv_base_price_positive;

ALTER TABLE public.material_price_variants
  ADD CONSTRAINT mpv_base_price_positive CHECK (base_unit_price > 0),
  ADD CONSTRAINT mpv_tax_rate_allowed    CHECK (tax_rate IN (0, 5, 12, 18)),
  ADD CONSTRAINT mpv_tax_split_valid CHECK (
    (tax_type = 'CGST_SGST'
      AND cgst_rate = tax_rate / 2
      AND sgst_rate = tax_rate / 2
      AND igst_rate = 0)
    OR
    (tax_type = 'IGST'
      AND igst_rate = tax_rate
      AND cgst_rate = 0
      AND sgst_rate = 0)
  );

-- ---------------------------------------------------------------------------
-- 3. create_price_variant: accept tax inputs
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.create_price_variant(BIGINT, TEXT, NUMERIC, BIGINT, TEXT) CASCADE;

CREATE OR REPLACE FUNCTION public.create_price_variant(
  p_material_id          BIGINT,
  p_variant_name         TEXT,
  p_base_unit_price      NUMERIC(12,4),                        -- pre-tax, per base metric unit
  p_quantity_variant_id  BIGINT,
  p_tax_type             public.price_variant_tax_type,
  p_tax_rate             NUMERIC(5,2),
  p_notes                TEXT DEFAULT NULL                      -- accepted for UI compat
)
RETURNS public.material_price_variants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row             public.material_price_variants;
  v_unit_price_inc  NUMERIC(12,4);
  v_cgst            NUMERIC(5,2);
  v_sgst            NUMERIC(5,2);
  v_igst            NUMERIC(5,2);
BEGIN
  PERFORM public._assert_admin();

  IF NOT EXISTS (SELECT 1 FROM public.materials_master WHERE material_id = p_material_id) THEN
    RAISE EXCEPTION 'Material % does not exist', p_material_id;
  END IF;

  IF p_base_unit_price IS NULL OR p_base_unit_price <= 0 THEN
    RAISE EXCEPTION 'base_unit_price must be > 0';
  END IF;

  IF p_variant_name IS NULL OR btrim(p_variant_name) = '' THEN
    RAISE EXCEPTION 'variant_name is required';
  END IF;

  IF p_quantity_variant_id IS NULL THEN
    RAISE EXCEPTION 'quantity_variant_id is required';
  END IF;

  IF p_tax_type IS NULL THEN
    RAISE EXCEPTION 'tax_type is required (CGST_SGST or IGST)';
  END IF;

  IF p_tax_rate IS NULL OR p_tax_rate NOT IN (0, 5, 12, 18) THEN
    RAISE EXCEPTION 'tax_rate must be one of 0, 5, 12, 18';
  END IF;

  -- Validate qty variant belongs to the same material
  IF NOT EXISTS (
    SELECT 1 FROM public.material_variants
    WHERE variant_id = p_quantity_variant_id
      AND material_id = p_material_id
  ) THEN
    RAISE EXCEPTION
      'Quantity variant % does not belong to material %',
      p_quantity_variant_id, p_material_id;
  END IF;

  -- Tax-inclusive unit price (what FIFO consumes at)
  v_unit_price_inc := ROUND(p_base_unit_price * (1 + p_tax_rate / 100.0), 4);

  IF p_tax_type = 'CGST_SGST' THEN
    v_cgst := p_tax_rate / 2;
    v_sgst := p_tax_rate / 2;
    v_igst := 0;
  ELSE
    v_cgst := 0;
    v_sgst := 0;
    v_igst := p_tax_rate;
  END IF;

  -- Uniqueness: same material + same packaging + same inclusive price → duplicate
  IF EXISTS (
    SELECT 1 FROM public.material_price_variants
    WHERE material_id         = p_material_id
      AND quantity_variant_id = p_quantity_variant_id
      AND unit_price          = v_unit_price_inc
      AND is_active           = TRUE
  ) THEN
    RAISE EXCEPTION
      'An active price variant already exists for this material + packaging + inclusive price. Top up via Add Stock instead.';
  END IF;

  INSERT INTO public.material_price_variants (
    material_id, variant_name,
    unit_price, base_unit_price,
    quantity_variant_id,
    tax_type, tax_rate, cgst_rate, sgst_rate, igst_rate,
    created_by
  ) VALUES (
    p_material_id,
    btrim(p_variant_name),
    v_unit_price_inc,
    p_base_unit_price,
    p_quantity_variant_id,
    p_tax_type, p_tax_rate, v_cgst, v_sgst, v_igst,
    auth.uid()
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_price_variant(
  BIGINT, TEXT, NUMERIC, BIGINT, public.price_variant_tax_type, NUMERIC, TEXT
) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Refresh views to expose tax columns
-- ---------------------------------------------------------------------------

DROP VIEW IF EXISTS public.active_price_variants_dropdown CASCADE;
CREATE VIEW public.active_price_variants_dropdown AS
SELECT
  v.variant_id,
  v.material_id,
  m.material_name,
  v.variant_name,
  v.unit_price,
  v.base_unit_price,
  v.tax_type,
  v.tax_rate,
  v.cgst_rate,
  v.sgst_rate,
  v.igst_rate,
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
  v.base_unit_price, v.tax_type, v.tax_rate, v.cgst_rate, v.sgst_rate, v.igst_rate,
  v.quantity_variant_id, mv.variant_name, mv.quantity_per_unit, m.metric
ORDER BY v.material_id, v.variant_id;

DROP VIEW IF EXISTS public.material_stock_variants_admin CASCADE;
CREATE VIEW public.material_stock_variants_admin AS
SELECT
  m.material_id,
  m.material_name,
  m.metric,
  v.variant_id,
  v.variant_name,
  v.unit_price,
  v.base_unit_price,
  v.tax_type,
  v.tax_rate,
  v.cgst_rate,
  v.sgst_rate,
  v.igst_rate,
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
  v.variant_id, v.variant_name, v.unit_price, v.base_unit_price,
  v.tax_type, v.tax_rate, v.cgst_rate, v.sgst_rate, v.igst_rate,
  v.is_active, v.quantity_variant_id, mv.variant_name, mv.quantity_per_unit,
  v.created_at, v.created_by;

DROP VIEW IF EXISTS public.material_stock_batches_admin CASCADE;
CREATE VIEW public.material_stock_batches_admin AS
SELECT
  m.material_id,
  m.material_name,
  m.metric,
  v.variant_id,
  v.variant_name,
  v.unit_price,
  v.base_unit_price,
  v.tax_type,
  v.tax_rate,
  v.cgst_rate,
  v.sgst_rate,
  v.igst_rate,
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

GRANT SELECT ON public.active_price_variants_dropdown   TO authenticated;
GRANT SELECT ON public.material_stock_variants_admin    TO authenticated;
GRANT SELECT ON public.material_stock_batches_admin     TO authenticated;

-- ---------------------------------------------------------------------------
-- Reload PostgREST schema cache
-- ---------------------------------------------------------------------------

NOTIFY pgrst, 'reload schema';
