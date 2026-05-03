-- ============================================================================
-- Revert 20260502000004: put purchase_date capture BACK on variant creation.
--
-- Reason: user preference — purchase_date belongs with the price tier itself,
-- not with each stock-entry batch. add_stock_to_store returns to its
-- pre-20260502000004 signature (no p_purchase_date).
--
-- This is idempotent: drops add_stock_to_store in any previous signature and
-- recreates it without the date parameter. Safe whether or not 20260502000004
-- was applied.
--
-- Run AFTER 20260502000003_costing_from_fifo_breakdown.sql.
-- (File 20260502000004 has been deleted from the migrations folder.)
-- ============================================================================

DROP FUNCTION IF EXISTS public.add_stock_to_store(BIGINT, NUMERIC, DATE, TEXT, TEXT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.add_stock_to_store(BIGINT, NUMERIC, TEXT, TEXT, TEXT) CASCADE;

CREATE OR REPLACE FUNCTION public.add_stock_to_store(
  p_variant_id     BIGINT,
  p_quantity       NUMERIC(12,3),
  p_bill_path      TEXT DEFAULT NULL,
  p_invoice_number TEXT DEFAULT NULL,
  p_notes          TEXT DEFAULT NULL
)
RETURNS TABLE (
  variant_id      BIGINT,
  variant_name    TEXT,
  quantity_added  NUMERIC(12,3),
  unit_price      NUMERIC(12,2),
  total_value     NUMERIC(14,2),
  bill_path       TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_material_id   BIGINT;
  v_material_name TEXT;
  v_metric        TEXT;
  v_name          TEXT;
  v_price         NUMERIC(12,2);
  v_active        BOOLEAN;
  v_purchase_date DATE;
  v_notes         TEXT;
BEGIN
  PERFORM public._assert_admin();

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'quantity must be > 0';
  END IF;

  SELECT mpv.material_id, mpv.variant_name, mpv.unit_price, mpv.is_active,
         mpv.purchase_date, m.material_name, m.metric
    INTO v_material_id, v_name, v_price, v_active,
         v_purchase_date, v_material_name, v_metric
  FROM public.material_price_variants mpv
  JOIN public.materials_master m ON m.material_id = mpv.material_id
  WHERE mpv.variant_id = p_variant_id;

  IF v_material_id IS NULL THEN
    RAISE EXCEPTION 'Variant % not found', p_variant_id;
  END IF;

  IF NOT v_active THEN
    RAISE EXCEPTION 'Variant % is deactivated. Cannot add new stock. Reactivate it first.', p_variant_id;
  END IF;

  UPDATE public.material_price_variants
  SET quantity_received  = quantity_received  + p_quantity,
      quantity_available = quantity_available + p_quantity,
      invoice_number     = COALESCE(p_invoice_number, invoice_number),
      bill_path          = COALESCE(p_bill_path, bill_path),
      notes              = CASE
                             WHEN p_notes IS NOT NULL
                             THEN COALESCE(notes || ' | ', '') || p_notes
                             ELSE notes
                           END
  WHERE material_price_variants.variant_id = p_variant_id;

  v_notes :=
    'STORE IN: ' || p_quantity::TEXT || ' ' || COALESCE(v_metric, '') ||
    ' of ' || v_material_name ||
    ' @ Rs.' || v_price::TEXT || '/unit' ||
    ' (variant="' || v_name || '", FIFO date=' || v_purchase_date::TEXT || ')' ||
    ' = Rs.' || (p_quantity * v_price)::TEXT ||
    ' | invoice=' || COALESCE(p_invoice_number, 'N/A') ||
    ' | bill=' || COALESCE(p_bill_path, 'N/A') ||
    CASE WHEN p_notes IS NOT NULL THEN ' | remark="' || p_notes || '"' ELSE '' END ||
    ' | at=' || NOW()::TEXT;

  INSERT INTO public.material_movement_logs (
    material_id, movement_type, project_id, quantity,
    reference_type, reference_id, notes, created_by
  ) VALUES (
    v_material_id, 'Store In', NULL, p_quantity,
    'Manual Adjustment', p_variant_id,
    v_notes,
    auth.uid()
  );

  RETURN QUERY
  SELECT p_variant_id,
         v_name,
         p_quantity,
         v_price,
         (p_quantity * v_price)::NUMERIC(14,2),
         p_bill_path;
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_stock_to_store(BIGINT, NUMERIC, TEXT, TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
