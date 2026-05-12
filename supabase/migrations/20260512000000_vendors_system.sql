-- ---------------------------------------------------------------------------
-- Vendors system
--
-- Adds a first-class vendors registry and wires vendor selection into the
-- Add Stock flow. A vendor is required for every new stock batch going
-- forward; existing batches keep their NULL vendor_id (grandfathered).
--
-- Also stamps vendor_id onto material_movement_logs for Store-In entries so
-- downstream views (Invoices, Stock Entry Logs) can show the vendor without
-- a secondary lookup.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Vendors table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.vendors (
  vendor_id        BIGSERIAL PRIMARY KEY,
  vendor_name      TEXT NOT NULL,
  proprietor_name  TEXT NOT NULL,
  phone_number     TEXT,
  address          TEXT NOT NULL,
  gst_number       TEXT,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT vendors_name_unique UNIQUE (vendor_name)
);

CREATE INDEX IF NOT EXISTS idx_vendors_active
  ON public.vendors (is_active)
  WHERE is_active;

CREATE INDEX IF NOT EXISTS idx_vendors_name_ci
  ON public.vendors (LOWER(vendor_name));

-- Keep updated_at fresh on UPDATE.
CREATE OR REPLACE FUNCTION public._vendors_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS vendors_touch_updated_at ON public.vendors;
CREATE TRIGGER vendors_touch_updated_at
BEFORE UPDATE ON public.vendors
FOR EACH ROW EXECUTE FUNCTION public._vendors_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Admin-only RLS for vendors (SELECT is open to all authenticated)
-- ---------------------------------------------------------------------------

-- Helper for RLS predicates. Mirrors _assert_admin() semantics.
CREATE OR REPLACE FUNCTION public._is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = auth.uid() AND role = 'Admin'
  );
$$;
GRANT EXECUTE ON FUNCTION public._is_admin() TO authenticated;

ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vendors_select_auth"   ON public.vendors;
DROP POLICY IF EXISTS "vendors_insert_admin"  ON public.vendors;
DROP POLICY IF EXISTS "vendors_update_admin"  ON public.vendors;
DROP POLICY IF EXISTS "vendors_delete_admin"  ON public.vendors;

CREATE POLICY "vendors_select_auth"
  ON public.vendors FOR SELECT TO authenticated USING (TRUE);

CREATE POLICY "vendors_insert_admin"
  ON public.vendors FOR INSERT TO authenticated
  WITH CHECK (public._is_admin());

CREATE POLICY "vendors_update_admin"
  ON public.vendors FOR UPDATE TO authenticated
  USING (public._is_admin())
  WITH CHECK (public._is_admin());

CREATE POLICY "vendors_delete_admin"
  ON public.vendors FOR DELETE TO authenticated
  USING (public._is_admin());

GRANT SELECT                         ON public.vendors TO authenticated;
GRANT INSERT, UPDATE, DELETE         ON public.vendors TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.vendors_vendor_id_seq TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Link vendor to stock batches + movement logs
-- ---------------------------------------------------------------------------

ALTER TABLE public.material_stock_batches
  ADD COLUMN IF NOT EXISTS vendor_id BIGINT
    REFERENCES public.vendors(vendor_id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_batches_vendor
  ON public.material_stock_batches (vendor_id);

ALTER TABLE public.material_movement_logs
  ADD COLUMN IF NOT EXISTS vendor_id BIGINT
    REFERENCES public.vendors(vendor_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_movement_logs_vendor
  ON public.material_movement_logs (vendor_id);

-- ---------------------------------------------------------------------------
-- 4. Admin view: include vendor fields for Invoices + batch listings
-- ---------------------------------------------------------------------------

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
  b.created_by,
  b.vendor_id,
  vnd.vendor_name,
  vnd.proprietor_name   AS vendor_proprietor,
  vnd.phone_number      AS vendor_phone,
  vnd.gst_number        AS vendor_gst,
  vnd.address           AS vendor_address
FROM public.materials_master m
JOIN public.material_price_variants v ON v.material_id = m.material_id
LEFT JOIN public.material_variants mv ON mv.variant_id = v.quantity_variant_id
JOIN public.material_stock_batches b  ON b.variant_id = v.variant_id
LEFT JOIN public.vendors vnd          ON vnd.vendor_id = b.vendor_id;

GRANT SELECT ON public.material_stock_batches_admin TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Add Stock RPC: vendor is now required
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.add_stock_to_store(BIGINT, NUMERIC, TEXT, TEXT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.add_stock_to_store(BIGINT, NUMERIC, TEXT, TEXT, TEXT, BIGINT) CASCADE;

CREATE OR REPLACE FUNCTION public.add_stock_to_store(
  p_variant_id      BIGINT,
  p_number_of_units NUMERIC(12,3),
  p_vendor_id       BIGINT,
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
  bill_path        TEXT,
  vendor_id        BIGINT,
  vendor_name      TEXT
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
  v_vendor_name      TEXT;
  v_vendor_active    BOOLEAN;
BEGIN
  PERFORM public._assert_admin();

  IF p_number_of_units IS NULL OR p_number_of_units <= 0 THEN
    RAISE EXCEPTION 'number_of_units must be > 0';
  END IF;

  IF p_vendor_id IS NULL THEN
    RAISE EXCEPTION 'vendor_id is required';
  END IF;

  SELECT vendor_name, is_active
    INTO v_vendor_name, v_vendor_active
    FROM public.vendors
   WHERE vendor_id = p_vendor_id;

  IF v_vendor_name IS NULL THEN
    RAISE EXCEPTION 'Vendor % not found', p_vendor_id;
  END IF;

  IF NOT v_vendor_active THEN
    RAISE EXCEPTION 'Vendor "%" is inactive. Reactivate before adding stock.', v_vendor_name;
  END IF;

  -- Fetch variant + qty-variant details.
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

  v_total_quantity := p_number_of_units * v_qty_per_unit;

  INSERT INTO public.material_stock_batches (
    variant_id, batch_date,
    quantity_received, quantity_available,
    number_of_units,
    invoice_number, bill_path, notes, created_by,
    vendor_id
  ) VALUES (
    p_variant_id, v_batch_date,
    v_total_quantity, v_total_quantity,
    p_number_of_units,
    p_invoice_number, p_bill_path, p_notes, auth.uid(),
    p_vendor_id
  )
  RETURNING material_stock_batches.batch_id INTO v_batch_id;

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
    || ' | vendor=' || v_vendor_name
    || ' | invoice=' || COALESCE(p_invoice_number, 'N/A')
    || ' | bill=' || COALESCE(p_bill_path, 'N/A')
    || CASE WHEN p_notes IS NOT NULL THEN ' | remark="' || p_notes || '"' ELSE '' END
    || ' | at=' || NOW()::TEXT;

  INSERT INTO public.material_movement_logs (
    material_id, movement_type, project_id, quantity,
    reference_type, reference_id, notes, created_by,
    vendor_id
  ) VALUES (
    v_material_id, 'Store In', NULL, v_total_quantity,
    'Manual Adjustment', v_batch_id,
    v_log_notes,
    auth.uid(),
    p_vendor_id
  );

  RETURN QUERY
  SELECT
    v_batch_id, p_variant_id, v_name,
    p_number_of_units, v_total_quantity,
    v_price, (v_total_quantity * v_price)::NUMERIC(14,2),
    v_batch_date, p_bill_path,
    p_vendor_id, v_vendor_name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_stock_to_store(BIGINT, NUMERIC, BIGINT, TEXT, TEXT, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- Reload PostgREST schema cache
-- ---------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';
