-- ============================================================================
-- Fix: create_price_variant still referenced purchase_date / notes columns
-- that 20260502000007 dropped from material_price_variants.
--
-- New INSERT uses only the columns that still exist:
--   variant_id (auto), material_id, variant_name, unit_price, is_active,
--   created_at (auto), created_by
--
-- Signature kept as (p_material_id, p_variant_name, p_unit_price, p_notes)
-- so the existing UI call still resolves. p_notes is silently discarded —
-- notes live on batches now, not variants.
-- ============================================================================

DROP FUNCTION IF EXISTS public.create_price_variant(BIGINT, TEXT, NUMERIC, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.create_price_variant(BIGINT, TEXT, NUMERIC, DATE, TEXT) CASCADE;

CREATE OR REPLACE FUNCTION public.create_price_variant(
  p_material_id  BIGINT,
  p_variant_name TEXT,
  p_unit_price   NUMERIC(12,2),
  p_notes        TEXT DEFAULT NULL   -- accepted for UI compat; not stored on variant
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
    material_id, variant_name, unit_price, created_by
  ) VALUES (
    p_material_id,
    btrim(p_variant_name),
    p_unit_price,
    auth.uid()
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_price_variant(BIGINT, TEXT, NUMERIC, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
