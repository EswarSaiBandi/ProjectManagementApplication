-- ============================================================================
-- Damage / Write-off: dedicated movement_type.
--
-- Previously, reduce_store_stock_lifo logged movement_type='Store Out' with
-- reference_type='Manual Adjustment', and the UI relabelled that combo to
-- "Stock Reduction" client-side. Replace with a first-class label.
--
-- Changes:
--   1. Extend material_movement_logs.movement_type CHECK with 'Damage / Write-off'.
--   2. Back-fill: any existing (Store Out + Manual Adjustment) row becomes
--      Damage / Write-off (that combo was uniquely emitted by this RPC).
--   3. Rewrite reduce_store_stock_lifo to emit the new movement_type and a
--      clearer note prefix.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Widen CHECK to accept new label
-- ---------------------------------------------------------------------------

ALTER TABLE public.material_movement_logs
  DROP CONSTRAINT IF EXISTS material_movement_logs_movement_type_check;

ALTER TABLE public.material_movement_logs
  ADD CONSTRAINT material_movement_logs_movement_type_check
  CHECK (movement_type IN (
    'Store In', 'Store Out', 'Project In',
    'Return to Store', 'Local Procurement',
    'Stock Used', 'Stock Used Reverted',
    'Damage / Write-off',
    'Request Raised', 'Request Cancelled', 'Request Rejected',
    'Return Submitted', 'Project Out (Return Approved)',
    'Return Rejected', 'Return Cancelled'
  ));

-- ---------------------------------------------------------------------------
-- 2. Back-fill historical damage/write-off rows
-- ---------------------------------------------------------------------------

UPDATE public.material_movement_logs
   SET movement_type = 'Damage / Write-off'
 WHERE movement_type = 'Store Out'
   AND reference_type = 'Manual Adjustment';

-- ---------------------------------------------------------------------------
-- 3. Rewrite reduce_store_stock_lifo
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.reduce_store_stock_lifo(BIGINT, NUMERIC, TEXT, BIGINT) CASCADE;

CREATE OR REPLACE FUNCTION public.reduce_store_stock_lifo(
  p_material_id    BIGINT,
  p_quantity       NUMERIC(12,3),
  p_reason         TEXT,
  p_qty_variant_id BIGINT DEFAULT NULL
)
RETURNS TABLE (
  total_reduced NUMERIC(12,3),
  total_value   NUMERIC(14,2),
  breakdown     JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_material_name    TEXT;
  v_metric           TEXT;
  v_qty_variant_name TEXT;
  v_qty_per_unit     NUMERIC(12,3);
  v_pkg_tag          TEXT          := '';
  v_remaining        NUMERIC(12,3) := p_quantity;
  v_total_value      NUMERIC(14,2) := 0;
  v_breakdown        JSONB         := '[]'::JSONB;
  v_lines            TEXT[]        := ARRAY[]::TEXT[];
  v_reduce_qty       NUMERIC(12,3);
  v_units            NUMERIC(12,3);
  v_available_total  NUMERIC(12,3);
  v_notes            TEXT;
  r RECORD;
BEGIN
  PERFORM public._assert_admin();

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'quantity must be > 0';
  END IF;

  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'reason is required for store-level reduction';
  END IF;

  SELECT material_name, metric INTO v_material_name, v_metric
  FROM public.materials_master WHERE material_id = p_material_id;
  IF v_material_name IS NULL THEN
    RAISE EXCEPTION 'Material % does not exist', p_material_id;
  END IF;

  IF p_qty_variant_id IS NOT NULL THEN
    SELECT mv.variant_name, mv.quantity_per_unit
      INTO v_qty_variant_name, v_qty_per_unit
    FROM public.material_variants mv
    WHERE mv.variant_id  = p_qty_variant_id
      AND mv.material_id = p_material_id;

    IF v_qty_variant_name IS NULL THEN
      RAISE EXCEPTION
        'Quantity variant % does not belong to material "%"',
        p_qty_variant_id, v_material_name;
    END IF;

    v_pkg_tag := ' [' || v_qty_variant_name || ']';
  END IF;

  SELECT COALESCE(SUM(b.quantity_available), 0)
    INTO v_available_total
  FROM public.material_stock_batches b
  JOIN public.material_price_variants v ON v.variant_id = b.variant_id
  WHERE v.material_id = p_material_id
    AND (p_qty_variant_id IS NULL OR v.quantity_variant_id = p_qty_variant_id);

  IF v_available_total < p_quantity THEN
    RAISE EXCEPTION
      'Insufficient stock for "%"%: need %, have %',
      v_material_name, v_pkg_tag, p_quantity, v_available_total;
  END IF;

  FOR r IN
    SELECT b.batch_id, b.variant_id, b.batch_date,
           v.variant_name, v.unit_price, b.quantity_available,
           v.quantity_variant_id,
           mv.variant_name      AS qty_variant_name,
           mv.quantity_per_unit AS qpu
      FROM public.material_stock_batches b
      JOIN public.material_price_variants v  ON v.variant_id  = b.variant_id
      LEFT JOIN public.material_variants  mv ON mv.variant_id = v.quantity_variant_id
     WHERE v.material_id = p_material_id
       AND b.quantity_available > 0
       AND (p_qty_variant_id IS NULL OR v.quantity_variant_id = p_qty_variant_id)
     ORDER BY b.batch_date DESC, b.batch_id DESC     -- LIFO
     FOR UPDATE OF b
  LOOP
    EXIT WHEN v_remaining <= 0;

    v_reduce_qty := LEAST(r.quantity_available, v_remaining);
    v_units      := ROUND(v_reduce_qty / COALESCE(NULLIF(r.qpu, 0), 1), 3);

    UPDATE public.material_stock_batches
    SET quantity_available = quantity_available - v_reduce_qty
    WHERE material_stock_batches.batch_id = r.batch_id;

    v_breakdown := v_breakdown || jsonb_build_array(jsonb_build_object(
      'batch_id',         r.batch_id,
      'variant_id',       r.variant_id,
      'variant_name',     r.variant_name,
      'qty_variant_name', r.qty_variant_name,
      'batch_date',       r.batch_date,
      'units',            v_units,
      'qty',              v_reduce_qty,
      'unit_price',       r.unit_price,
      'value',            v_reduce_qty * r.unit_price
    ));
    v_lines := v_lines || (
      v_reduce_qty::TEXT || ' ' || COALESCE(v_metric, '') ||
      CASE WHEN r.qty_variant_name IS NOT NULL
           THEN ' (' || v_units::TEXT || ' × ' || r.qty_variant_name || ')'
           ELSE '' END ||
      ' @ Rs.' || r.unit_price::TEXT ||
      ' (variant="' || r.variant_name || '", batch#=' || r.batch_id ||
      ', batch_date=' || r.batch_date::TEXT || ')' ||
      ' = Rs.' || (v_reduce_qty * r.unit_price)::TEXT
    );

    v_total_value := v_total_value + (v_reduce_qty * r.unit_price);
    v_remaining   := v_remaining   - v_reduce_qty;
  END LOOP;

  IF v_remaining > 0 THEN
    RAISE EXCEPTION
      'Could not reduce full quantity for "%"%: short by %',
      v_material_name, v_pkg_tag, v_remaining;
  END IF;

  v_notes :=
    'DAMAGE / WRITE-OFF: ' || p_quantity::TEXT || ' ' || COALESCE(v_metric, '') ||
    ' of ' || v_material_name || v_pkg_tag ||
    ' written off from store (LIFO)' ||
    ' | reason="' || p_reason || '"' ||
    ' | breakdown: [' || array_to_string(v_lines, '; ') || ']' ||
    ' | total value = Rs.' || v_total_value::TEXT ||
    ' | at=' || NOW()::TEXT;

  INSERT INTO public.material_movement_logs (
    material_id, movement_type, project_id, quantity,
    reference_type, reference_id, notes, created_by
  ) VALUES (
    p_material_id, 'Damage / Write-off', NULL, p_quantity,
    'Manual Adjustment', NULL,
    v_notes,
    auth.uid()
  );

  RETURN QUERY SELECT p_quantity, v_total_value, v_breakdown;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reduce_store_stock_lifo(BIGINT, NUMERIC, TEXT, BIGINT) TO authenticated;

NOTIFY pgrst, 'reload schema';
