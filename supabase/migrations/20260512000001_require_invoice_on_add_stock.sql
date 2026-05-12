-- ---------------------------------------------------------------------------
-- Require invoice_number on new stock entries going forward.
--
-- Existing batches / movement logs keep their NULL invoice_number — the
-- material_stock_batches.invoice_number column stays nullable so grandfathered
-- rows remain valid. The enforcement happens at the RPC boundary, which is
-- the only supported path to insert new batches.
--
-- This builds on 20260512000000_vendors_system.sql, which already requires
-- a vendor_id for every new stock entry.
--
-- IMPORTANT: This migration intentionally keeps the same parameter signature
-- as 20260512000000 so CREATE OR REPLACE works without a DROP. Postgres
-- forbids renaming / reordering positional parameters via CREATE OR REPLACE,
-- so changing p_invoice_number from "optional default NULL" to "required" is
-- done purely by an explicit null/blank check inside the function body, not
-- by changing its position or default.
-- ---------------------------------------------------------------------------

-- Defensive DROPs: remove ANY existing variant of this function so CREATE
-- below is unconstrained by prior positional parameter names. Postgres'
-- CREATE OR REPLACE does not allow renaming positional params; whichever
-- variant got applied earlier (legacy 5-arg, pre-vendor 6-arg, vendor-added
-- 6-arg with different param order), we nuke it here and rebuild fresh.
--
-- Nothing in the DB depends on this function — it's only called from the
-- frontend "Add Stock" dialog — so CASCADE is safe.
DROP FUNCTION IF EXISTS public.add_stock_to_store(BIGINT, NUMERIC, TEXT, TEXT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.add_stock_to_store(BIGINT, NUMERIC, TEXT, TEXT, TEXT, BIGINT) CASCADE;
DROP FUNCTION IF EXISTS public.add_stock_to_store(BIGINT, NUMERIC, BIGINT, TEXT, TEXT, TEXT) CASCADE;

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
  v_invoice          TEXT;
BEGIN
  PERFORM public._assert_admin();

  IF p_number_of_units IS NULL OR p_number_of_units <= 0 THEN
    RAISE EXCEPTION 'number_of_units must be > 0';
  END IF;

  IF p_vendor_id IS NULL THEN
    RAISE EXCEPTION 'vendor_id is required';
  END IF;

  -- Invoice is now required for every new stock batch.
  v_invoice := NULLIF(BTRIM(COALESCE(p_invoice_number, '')), '');
  IF v_invoice IS NULL THEN
    RAISE EXCEPTION 'invoice_number is required';
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
    v_invoice, p_bill_path, p_notes, auth.uid(),
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
    || ' | invoice=' || v_invoice
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

NOTIFY pgrst, 'reload schema';
