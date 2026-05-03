-- ============================================================================
-- Drop p_purchase_date from create_price_variant.
--
-- Rationale: variant_id is monotonic and already breaks ties for FIFO. Taking
-- purchase_date as user input added UX without adding real ordering signal —
-- so auto-set it to CURRENT_DATE and stop asking. Admins no longer see the
-- field in the Create Variant dialog.
--
-- The purchase_date column stays on material_price_variants (used by views
-- for display, and as the primary FIFO key alongside variant_id tiebreaker).
-- Existing variants keep whatever purchase_date they already have.
--
-- Run AFTER 20260502000005_revert_purchase_date_on_add_stock.sql.
-- ============================================================================

DROP FUNCTION IF EXISTS public.create_price_variant(BIGINT, TEXT, NUMERIC, DATE, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.create_price_variant(BIGINT, TEXT, NUMERIC, TEXT) CASCADE;

CREATE OR REPLACE FUNCTION public.create_price_variant(
  p_material_id  BIGINT,
  p_variant_name TEXT,
  p_unit_price   NUMERIC(12,2),
  p_notes        TEXT DEFAULT NULL
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

  IF EXISTS (
    SELECT 1 FROM public.material_price_variants
    WHERE material_id = p_material_id
      AND unit_price  = p_unit_price
      AND is_active   = TRUE
  ) THEN
    RAISE EXCEPTION 'An active variant already exists for material % at price %. Top up that variant via add_stock_to_store instead.',
      p_material_id, p_unit_price;
  END IF;

  INSERT INTO public.material_price_variants (
    material_id, variant_name, unit_price, purchase_date, notes, created_by
  ) VALUES (
    p_material_id,
    p_variant_name,
    p_unit_price,
    CURRENT_DATE,     -- auto-set; FIFO tiebreaker is variant_id anyway
    p_notes,
    auth.uid()
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_price_variant(BIGINT, TEXT, NUMERIC, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
