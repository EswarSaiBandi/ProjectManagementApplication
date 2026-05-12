-- ---------------------------------------------------------------------------
-- Bulk "Add Invoice" flow: one invoice number, one vendor, one bill, many
-- line items. Enforces "one invoice = one vendor": if the invoice already
-- exists with a different vendor, the entire transaction is rejected.
--
-- Works alongside the existing single-line add_stock_to_store RPC — both
-- remain available. This RPC is atomic: either every line item is inserted
-- (with the same invoice_number, vendor_id, bill_path), or none are.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.add_stock_bulk(
  p_invoice_number  TEXT,
  p_vendor_id       BIGINT,
  p_bill_path       TEXT,
  p_items           JSONB,
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
  batch_date       DATE
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice        TEXT;
  v_vendor_name    TEXT;
  v_vendor_active  BOOLEAN;
  v_existing_vendor BIGINT;
  v_item           JSONB;
  v_item_variant_id BIGINT;
  v_item_units     NUMERIC(12,3);
  v_item_count     INT;
  v_material_id    BIGINT;
  v_material_name  TEXT;
  v_metric         TEXT;
  v_name           TEXT;
  v_price          NUMERIC(12,2);
  v_active         BOOLEAN;
  v_qty_per_unit   NUMERIC(12,3);
  v_qty_variant_name TEXT;
  v_total_quantity NUMERIC(12,3);
  v_batch_id       BIGINT;
  v_batch_date     DATE := CURRENT_DATE;
  v_log_notes      TEXT;
BEGIN
  PERFORM public._assert_admin();

  -- ── Validate top-level invoice / vendor / bill ─────────────────────────
  v_invoice := NULLIF(BTRIM(COALESCE(p_invoice_number, '')), '');
  IF v_invoice IS NULL THEN
    RAISE EXCEPTION 'invoice_number is required';
  END IF;

  IF p_vendor_id IS NULL THEN
    RAISE EXCEPTION 'vendor_id is required';
  END IF;

  IF NULLIF(BTRIM(COALESCE(p_bill_path, '')), '') IS NULL THEN
    RAISE EXCEPTION 'bill_path is required';
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

  -- ── One-invoice-one-vendor enforcement ─────────────────────────────────
  -- If the invoice already has batches, they must all share a vendor, and
  -- the submitted vendor_id must match.
  SELECT DISTINCT b.vendor_id
    INTO v_existing_vendor
    FROM public.material_stock_batches b
   WHERE b.invoice_number = v_invoice
     AND b.vendor_id IS NOT NULL
   LIMIT 1;

  IF v_existing_vendor IS NOT NULL AND v_existing_vendor <> p_vendor_id THEN
    RAISE EXCEPTION
      'Invoice "%" already exists under a different vendor (vendor_id=%). '
      'An invoice can only have one vendor.',
      v_invoice, v_existing_vendor;
  END IF;

  -- ── Validate items array ───────────────────────────────────────────────
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'items must be a JSON array';
  END IF;

  v_item_count := jsonb_array_length(p_items);
  IF v_item_count = 0 THEN
    RAISE EXCEPTION 'At least one line item is required';
  END IF;

  -- ── Loop: insert one batch + log per item ──────────────────────────────
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_item_variant_id := NULLIF((v_item ->> 'variant_id'), '')::BIGINT;
    v_item_units      := NULLIF((v_item ->> 'number_of_units'), '')::NUMERIC(12,3);

    IF v_item_variant_id IS NULL THEN
      RAISE EXCEPTION 'Each item must include variant_id';
    END IF;
    IF v_item_units IS NULL OR v_item_units <= 0 THEN
      RAISE EXCEPTION 'Each item number_of_units must be > 0 (got %)', v_item_units;
    END IF;

    SELECT
      mpv.material_id, mpv.variant_name, mpv.unit_price, mpv.is_active,
      m.material_name, m.metric,
      mv.quantity_per_unit, mv.variant_name
    INTO
      v_material_id, v_name, v_price, v_active,
      v_material_name, v_metric,
      v_qty_per_unit, v_qty_variant_name
    FROM public.material_price_variants mpv
    JOIN public.materials_master m  ON m.material_id  = mpv.material_id
    JOIN public.material_variants mv ON mv.variant_id = mpv.quantity_variant_id
    WHERE mpv.variant_id = v_item_variant_id;

    IF v_material_id IS NULL THEN
      RAISE EXCEPTION 'Variant % not found', v_item_variant_id;
    END IF;
    IF NOT v_active THEN
      RAISE EXCEPTION
        'Variant % ("%") is deactivated. Reactivate it first.',
        v_item_variant_id, v_name;
    END IF;

    v_total_quantity := v_item_units * v_qty_per_unit;

    INSERT INTO public.material_stock_batches (
      variant_id, batch_date,
      quantity_received, quantity_available,
      number_of_units,
      invoice_number, bill_path, notes, created_by,
      vendor_id
    ) VALUES (
      v_item_variant_id, v_batch_date,
      v_total_quantity, v_total_quantity,
      v_item_units,
      v_invoice, p_bill_path, p_notes, auth.uid(),
      p_vendor_id
    )
    RETURNING material_stock_batches.batch_id INTO v_batch_id;

    v_log_notes :=
      'STORE IN (bulk invoice): '
      || v_item_units::TEXT
      || ' × ' || v_qty_variant_name
      || ' (' || v_total_quantity::TEXT || ' ' || COALESCE(v_metric, '') || ')'
      || ' of ' || v_material_name
      || ' @ Rs.' || v_price::TEXT || '/' || COALESCE(v_metric, 'unit')
      || ' (variant="' || v_name || '", batch#=' || v_batch_id
      || ', batch_date=' || v_batch_date::TEXT || ')'
      || ' total_value=Rs.' || (v_total_quantity * v_price)::TEXT
      || ' | vendor=' || v_vendor_name
      || ' | invoice=' || v_invoice
      || ' | bill=' || p_bill_path
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

    batch_id        := v_batch_id;
    variant_id      := v_item_variant_id;
    variant_name    := v_name;
    number_of_units := v_item_units;
    quantity_added  := v_total_quantity;
    unit_price      := v_price;
    total_value     := (v_total_quantity * v_price)::NUMERIC(14,2);
    batch_date      := v_batch_date;
    RETURN NEXT;
  END LOOP;

  RETURN;
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_stock_bulk(TEXT, BIGINT, TEXT, JSONB, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
