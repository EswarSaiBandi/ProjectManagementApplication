-- ============================================================================
-- FIFO/LIFO Phase 3: Detailed movement-log notes + aggregated inventory view.
--
-- Run AFTER 20260502000001_fifo_cutover_zero_legacy_stock.sql.
--
-- Changes:
--   1. Replace all 5 FIFO RPCs with versions that write human-readable detail
--      breakdown into material_movement_logs.notes (project name, variant
--      names, per-variant qty / unit price / cost, total, timestamp).
--   2. Add store_stock_by_material view — per-material aggregate for the
--      Store Inventory tab.
--   3. Add project_allocation_breakdown view — per-project, per-material
--      breakdown rolled up with variant detail, for ProjectInventoryTab.
-- ============================================================================

-- Replace RPCs via DROP + CREATE. SECURITY DEFINER + search_path are preserved.

DROP FUNCTION IF EXISTS public.add_stock_to_store(BIGINT, NUMERIC, TEXT, TEXT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.allocate_material_fifo(BIGINT, BIGINT, NUMERIC) CASCADE;
DROP FUNCTION IF EXISTS public.record_material_usage(BIGINT, NUMERIC) CASCADE;
DROP FUNCTION IF EXISTS public.record_material_return(BIGINT, NUMERIC) CASCADE;
DROP FUNCTION IF EXISTS public.reduce_store_stock_lifo(BIGINT, NUMERIC, TEXT) CASCADE;

-- ============================================================================
-- add_stock_to_store
-- ============================================================================

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
  v_notes         TEXT;
BEGIN
  PERFORM public._assert_admin();

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'quantity must be > 0';
  END IF;

  SELECT mpv.material_id, mpv.variant_name, mpv.unit_price, mpv.is_active,
         m.material_name, m.metric
    INTO v_material_id, v_name, v_price, v_active, v_material_name, v_metric
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
    ' (variant="' || v_name || '")' ||
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
  SELECT p_variant_id, v_name, p_quantity, v_price, (p_quantity * v_price)::NUMERIC(14,2), p_bill_path;
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_stock_to_store(BIGINT, NUMERIC, TEXT, TEXT, TEXT) TO authenticated;

-- ============================================================================
-- allocate_material_fifo
-- ============================================================================

CREATE OR REPLACE FUNCTION public.allocate_material_fifo(
  p_material_id  BIGINT,
  p_project_id   BIGINT,
  p_required_qty NUMERIC(12,3)
)
RETURNS TABLE (
  allocation_id   BIGINT,
  total_allocated NUMERIC(12,3),
  total_cost      NUMERIC(14,2),
  breakdown       JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_allocation_id BIGINT;
  v_remaining     NUMERIC(12,3) := p_required_qty;
  v_total_cost    NUMERIC(14,2) := 0;
  v_breakdown     JSONB         := '[]'::JSONB;
  v_lines         TEXT[]        := ARRAY[]::TEXT[];
  v_qty_to_alloc  NUMERIC(12,3);
  v_material_name TEXT;
  v_metric        TEXT;
  v_project_name  TEXT;
  v_notes         TEXT;
  r RECORD;
BEGIN
  IF p_required_qty IS NULL OR p_required_qty <= 0 THEN
    RAISE EXCEPTION 'required_qty must be > 0';
  END IF;

  SELECT material_name, metric INTO v_material_name, v_metric
  FROM public.materials_master WHERE material_id = p_material_id;
  IF v_material_name IS NULL THEN
    RAISE EXCEPTION 'Material % does not exist', p_material_id;
  END IF;

  SELECT project_name INTO v_project_name
  FROM public.projects WHERE project_id = p_project_id;
  IF v_project_name IS NULL THEN
    RAISE EXCEPTION 'Project % does not exist', p_project_id;
  END IF;

  IF (SELECT COALESCE(SUM(quantity_available), 0)
        FROM public.material_price_variants
        WHERE material_id = p_material_id) < p_required_qty THEN
    RAISE EXCEPTION 'Insufficient stock for material "%": need %, have %',
      v_material_name, p_required_qty,
      (SELECT COALESCE(SUM(quantity_available), 0)
         FROM public.material_price_variants WHERE material_id = p_material_id);
  END IF;

  INSERT INTO public.material_allocations (
    material_id, project_id, allocated_quantity, status, allocated_by
  ) VALUES (
    p_material_id, p_project_id, p_required_qty, 'Reserved', auth.uid()
  )
  RETURNING material_allocations.allocation_id INTO v_allocation_id;

  FOR r IN
    SELECT mpv.variant_id, mpv.variant_name, mpv.unit_price, mpv.quantity_available, mpv.purchase_date
    FROM public.material_price_variants mpv
    WHERE mpv.material_id = p_material_id
      AND mpv.quantity_available > 0
    ORDER BY mpv.purchase_date ASC, mpv.variant_id ASC   -- FIFO
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;

    v_qty_to_alloc := LEAST(r.quantity_available, v_remaining);

    INSERT INTO public.allocation_variant_breakdown (
      allocation_id, variant_id, qty_allocated, unit_price
    ) VALUES (
      v_allocation_id, r.variant_id, v_qty_to_alloc, r.unit_price
    );

    UPDATE public.material_price_variants
    SET quantity_available = quantity_available - v_qty_to_alloc
    WHERE material_price_variants.variant_id = r.variant_id;

    v_breakdown := v_breakdown || jsonb_build_array(jsonb_build_object(
      'variant_id',    r.variant_id,
      'variant_name',  r.variant_name,
      'purchase_date', r.purchase_date,
      'qty',           v_qty_to_alloc,
      'unit_price',    r.unit_price,
      'cost',          v_qty_to_alloc * r.unit_price
    ));
    v_lines := v_lines || (
      v_qty_to_alloc::TEXT || ' @ Rs.' || r.unit_price::TEXT ||
      ' (variant="' || r.variant_name || '", dt=' || r.purchase_date::TEXT || ')' ||
      ' = Rs.' || (v_qty_to_alloc * r.unit_price)::TEXT
    );

    v_total_cost := v_total_cost + (v_qty_to_alloc * r.unit_price);
    v_remaining  := v_remaining  - v_qty_to_alloc;
  END LOOP;

  v_notes :=
    'FIFO ALLOCATE: ' || p_required_qty::TEXT || ' ' || COALESCE(v_metric, '') ||
    ' of ' || v_material_name ||
    ' to project "' || v_project_name || '" (#' || p_project_id || ')' ||
    ' | breakdown: [' || array_to_string(v_lines, '; ') || ']' ||
    ' | total cost = Rs.' || v_total_cost::TEXT ||
    ' | alloc#=' || v_allocation_id ||
    ' | at=' || NOW()::TEXT;

  INSERT INTO public.material_movement_logs (
    material_id, movement_type, project_id, quantity,
    reference_type, reference_id, notes, created_by
  ) VALUES (
    p_material_id, 'Project In', p_project_id, p_required_qty,
    'Material Request', v_allocation_id,
    v_notes,
    auth.uid()
  );

  RETURN QUERY SELECT v_allocation_id, p_required_qty, v_total_cost, v_breakdown;
END;
$$;

GRANT EXECUTE ON FUNCTION public.allocate_material_fifo(BIGINT, BIGINT, NUMERIC) TO authenticated;

-- ============================================================================
-- record_material_usage
-- ============================================================================

CREATE OR REPLACE FUNCTION public.record_material_usage(
  p_allocation_id BIGINT,
  p_qty_used      NUMERIC(12,3)
)
RETURNS TABLE (
  allocation_id BIGINT,
  total_used    NUMERIC(12,3),
  cost_of_usage NUMERIC(14,2),
  breakdown     JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_material_id   BIGINT;
  v_project_id    BIGINT;
  v_material_name TEXT;
  v_metric        TEXT;
  v_project_name  TEXT;
  v_remaining     NUMERIC(12,3) := p_qty_used;
  v_total_cost    NUMERIC(14,2) := 0;
  v_breakdown     JSONB         := '[]'::JSONB;
  v_lines         TEXT[]        := ARRAY[]::TEXT[];
  v_use_qty       NUMERIC(12,3);
  v_notes         TEXT;
  r RECORD;
BEGIN
  IF p_qty_used IS NULL OR p_qty_used <= 0 THEN
    RAISE EXCEPTION 'qty_used must be > 0';
  END IF;

  SELECT ma.material_id, ma.project_id, m.material_name, m.metric, p.project_name
    INTO v_material_id, v_project_id, v_material_name, v_metric, v_project_name
  FROM public.material_allocations ma
  JOIN public.materials_master m ON m.material_id = ma.material_id
  JOIN public.projects p ON p.project_id = ma.project_id
  WHERE ma.allocation_id = p_allocation_id;

  IF v_material_id IS NULL THEN
    RAISE EXCEPTION 'Allocation % not found', p_allocation_id;
  END IF;

  FOR r IN
    SELECT avb.breakdown_id,
           avb.variant_id,
           mpv.variant_name,
           avb.unit_price,
           avb.qty_allocated - avb.qty_used - avb.qty_returned AS available
    FROM public.allocation_variant_breakdown avb
    JOIN public.material_price_variants mpv ON mpv.variant_id = avb.variant_id
    WHERE avb.allocation_id = p_allocation_id
    ORDER BY avb.breakdown_id ASC   -- FIFO within allocation
    FOR UPDATE OF avb
  LOOP
    EXIT WHEN v_remaining <= 0;
    CONTINUE WHEN r.available <= 0;

    v_use_qty := LEAST(r.available, v_remaining);

    UPDATE public.allocation_variant_breakdown
    SET qty_used = qty_used + v_use_qty
    WHERE allocation_variant_breakdown.breakdown_id = r.breakdown_id;

    v_breakdown := v_breakdown || jsonb_build_array(jsonb_build_object(
      'variant_id',   r.variant_id,
      'variant_name', r.variant_name,
      'qty',          v_use_qty,
      'unit_price',   r.unit_price,
      'cost',         v_use_qty * r.unit_price
    ));
    v_lines := v_lines || (
      v_use_qty::TEXT || ' @ Rs.' || r.unit_price::TEXT ||
      ' (variant="' || r.variant_name || '")' ||
      ' = Rs.' || (v_use_qty * r.unit_price)::TEXT
    );

    v_total_cost := v_total_cost + (v_use_qty * r.unit_price);
    v_remaining  := v_remaining  - v_use_qty;
  END LOOP;

  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'Cannot record usage of %: only % available on this allocation',
      p_qty_used, p_qty_used - v_remaining;
  END IF;

  v_notes :=
    'FIFO USAGE: ' || p_qty_used::TEXT || ' ' || COALESCE(v_metric, '') ||
    ' of ' || v_material_name ||
    ' consumed on-site in project "' || v_project_name || '" (#' || v_project_id || ')' ||
    ' | breakdown: [' || array_to_string(v_lines, '; ') || ']' ||
    ' | total cost = Rs.' || v_total_cost::TEXT ||
    ' | alloc#=' || p_allocation_id ||
    ' | at=' || NOW()::TEXT;

  INSERT INTO public.material_movement_logs (
    material_id, movement_type, project_id, quantity,
    reference_type, reference_id, notes, created_by
  ) VALUES (
    v_material_id, 'Project Out', v_project_id, p_qty_used,
    'Material Request', p_allocation_id,
    v_notes,
    auth.uid()
  );

  RETURN QUERY SELECT p_allocation_id, p_qty_used, v_total_cost, v_breakdown;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_material_usage(BIGINT, NUMERIC) TO authenticated;

-- ============================================================================
-- record_material_return  (LIFO)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.record_material_return(
  p_allocation_id BIGINT,
  p_qty_returned  NUMERIC(12,3)
)
RETURNS TABLE (
  allocation_id BIGINT,
  qty_returned  NUMERIC(12,3),
  total_value   NUMERIC(14,2),
  breakdown     JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_material_id   BIGINT;
  v_project_id    BIGINT;
  v_material_name TEXT;
  v_metric        TEXT;
  v_project_name  TEXT;
  v_remaining     NUMERIC(12,3) := p_qty_returned;
  v_total_value   NUMERIC(14,2) := 0;
  v_breakdown     JSONB         := '[]'::JSONB;
  v_lines         TEXT[]        := ARRAY[]::TEXT[];
  v_return_qty    NUMERIC(12,3);
  v_notes         TEXT;
  r RECORD;
BEGIN
  IF p_qty_returned IS NULL OR p_qty_returned <= 0 THEN
    RAISE EXCEPTION 'qty_returned must be > 0';
  END IF;

  SELECT ma.material_id, ma.project_id, m.material_name, m.metric, p.project_name
    INTO v_material_id, v_project_id, v_material_name, v_metric, v_project_name
  FROM public.material_allocations ma
  JOIN public.materials_master m ON m.material_id = ma.material_id
  JOIN public.projects p ON p.project_id = ma.project_id
  WHERE ma.allocation_id = p_allocation_id;

  IF v_material_id IS NULL THEN
    RAISE EXCEPTION 'Allocation % not found', p_allocation_id;
  END IF;

  FOR r IN
    SELECT avb.breakdown_id,
           avb.variant_id,
           mpv.variant_name,
           avb.unit_price,
           avb.qty_allocated - avb.qty_used - avb.qty_returned AS available
    FROM public.allocation_variant_breakdown avb
    JOIN public.material_price_variants mpv ON mpv.variant_id = avb.variant_id
    WHERE avb.allocation_id = p_allocation_id
    ORDER BY avb.breakdown_id DESC   -- LIFO
    FOR UPDATE OF avb
  LOOP
    EXIT WHEN v_remaining <= 0;
    CONTINUE WHEN r.available <= 0;

    v_return_qty := LEAST(r.available, v_remaining);

    UPDATE public.allocation_variant_breakdown
    SET qty_returned = qty_returned + v_return_qty
    WHERE allocation_variant_breakdown.breakdown_id = r.breakdown_id;

    UPDATE public.material_price_variants
    SET quantity_available = quantity_available + v_return_qty
    WHERE material_price_variants.variant_id = r.variant_id;

    v_breakdown := v_breakdown || jsonb_build_array(jsonb_build_object(
      'variant_id',   r.variant_id,
      'variant_name', r.variant_name,
      'qty',          v_return_qty,
      'unit_price',   r.unit_price,
      'value',        v_return_qty * r.unit_price
    ));
    v_lines := v_lines || (
      v_return_qty::TEXT || ' @ Rs.' || r.unit_price::TEXT ||
      ' (variant="' || r.variant_name || '")' ||
      ' = Rs.' || (v_return_qty * r.unit_price)::TEXT
    );

    v_total_value := v_total_value + (v_return_qty * r.unit_price);
    v_remaining   := v_remaining   - v_return_qty;
  END LOOP;

  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'Cannot return %: only % returnable on this allocation',
      p_qty_returned, p_qty_returned - v_remaining;
  END IF;

  v_notes :=
    'LIFO RETURN: ' || p_qty_returned::TEXT || ' ' || COALESCE(v_metric, '') ||
    ' of ' || v_material_name ||
    ' returned from project "' || v_project_name || '" (#' || v_project_id || ')' ||
    ' to store' ||
    ' | breakdown: [' || array_to_string(v_lines, '; ') || ']' ||
    ' | total value = Rs.' || v_total_value::TEXT ||
    ' | alloc#=' || p_allocation_id ||
    ' | at=' || NOW()::TEXT;

  INSERT INTO public.material_movement_logs (
    material_id, movement_type, project_id, quantity,
    reference_type, reference_id, notes, created_by
  ) VALUES (
    v_material_id, 'Return to Store', v_project_id, p_qty_returned,
    'Material Return', p_allocation_id,
    v_notes,
    auth.uid()
  );

  RETURN QUERY SELECT p_allocation_id, p_qty_returned, v_total_value, v_breakdown;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_material_return(BIGINT, NUMERIC) TO authenticated;

-- ============================================================================
-- reduce_store_stock_lifo
-- ============================================================================

CREATE OR REPLACE FUNCTION public.reduce_store_stock_lifo(
  p_material_id BIGINT,
  p_quantity    NUMERIC(12,3),
  p_reason      TEXT
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
DECLARE
  v_material_name TEXT;
  v_metric        TEXT;
  v_remaining     NUMERIC(12,3) := p_quantity;
  v_total_value   NUMERIC(14,2) := 0;
  v_breakdown     JSONB         := '[]'::JSONB;
  v_lines         TEXT[]        := ARRAY[]::TEXT[];
  v_reduce_qty    NUMERIC(12,3);
  v_notes         TEXT;
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

  IF (SELECT COALESCE(SUM(quantity_available), 0)
        FROM public.material_price_variants
        WHERE material_id = p_material_id) < p_quantity THEN
    RAISE EXCEPTION 'Insufficient stock for "%": need %, have %',
      v_material_name, p_quantity,
      (SELECT COALESCE(SUM(quantity_available), 0)
         FROM public.material_price_variants WHERE material_id = p_material_id);
  END IF;

  FOR r IN
    SELECT mpv.variant_id, mpv.variant_name, mpv.unit_price, mpv.quantity_available, mpv.purchase_date
    FROM public.material_price_variants mpv
    WHERE mpv.material_id = p_material_id
      AND mpv.quantity_available > 0
    ORDER BY mpv.purchase_date DESC, mpv.variant_id DESC   -- LIFO
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;

    v_reduce_qty := LEAST(r.quantity_available, v_remaining);

    UPDATE public.material_price_variants
    SET quantity_available = quantity_available - v_reduce_qty
    WHERE material_price_variants.variant_id = r.variant_id;

    v_breakdown := v_breakdown || jsonb_build_array(jsonb_build_object(
      'variant_id',    r.variant_id,
      'variant_name',  r.variant_name,
      'purchase_date', r.purchase_date,
      'qty',           v_reduce_qty,
      'unit_price',    r.unit_price,
      'value',         v_reduce_qty * r.unit_price
    ));
    v_lines := v_lines || (
      v_reduce_qty::TEXT || ' @ Rs.' || r.unit_price::TEXT ||
      ' (variant="' || r.variant_name || '", dt=' || r.purchase_date::TEXT || ')' ||
      ' = Rs.' || (v_reduce_qty * r.unit_price)::TEXT
    );

    v_total_value := v_total_value + (v_reduce_qty * r.unit_price);
    v_remaining   := v_remaining   - v_reduce_qty;
  END LOOP;

  v_notes :=
    'LIFO STORE REDUCTION: ' || p_quantity::TEXT || ' ' || COALESCE(v_metric, '') ||
    ' of ' || v_material_name ||
    ' written off from store' ||
    ' | reason="' || p_reason || '"' ||
    ' | breakdown: [' || array_to_string(v_lines, '; ') || ']' ||
    ' | total value = Rs.' || v_total_value::TEXT ||
    ' | at=' || NOW()::TEXT;

  INSERT INTO public.material_movement_logs (
    material_id, movement_type, project_id, quantity,
    reference_type, reference_id, notes, created_by
  ) VALUES (
    p_material_id, 'Store Out', NULL, p_quantity,
    'Manual Adjustment', NULL,
    v_notes,
    auth.uid()
  );

  RETURN QUERY SELECT p_quantity, v_total_value, v_breakdown;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reduce_store_stock_lifo(BIGINT, NUMERIC, TEXT) TO authenticated;

-- ============================================================================
-- View: store_stock_by_material
-- Per-material aggregate for the Store Inventory tab. Sum of qty_available
-- across all variants (active or paused), plus total value and variant count.
-- ============================================================================

CREATE OR REPLACE VIEW public.store_stock_by_material AS
SELECT
  m.material_id,
  m.material_name,
  m.metric,
  m.is_active                               AS material_is_active,
  COUNT(v.variant_id)                       AS total_variants,
  COUNT(v.variant_id) FILTER (WHERE v.is_active) AS active_variants,
  COALESCE(SUM(v.quantity_available), 0)    AS total_available,
  COALESCE(SUM(v.quantity_received), 0)     AS total_received,
  COALESCE(SUM(v.quantity_available * v.unit_price), 0)::NUMERIC(14,2) AS total_stock_value,
  MIN(v.unit_price) FILTER (WHERE v.quantity_available > 0) AS min_price_in_stock,
  MAX(v.unit_price) FILTER (WHERE v.quantity_available > 0) AS max_price_in_stock
FROM public.materials_master m
LEFT JOIN public.material_price_variants v ON v.material_id = m.material_id
GROUP BY m.material_id, m.material_name, m.metric, m.is_active
ORDER BY m.material_name;

GRANT SELECT ON public.store_stock_by_material TO authenticated;

-- ============================================================================
-- View: project_allocation_breakdown
-- Per-project, per-material roll-up of allocation/usage/return with variant
-- pricing. One row per allocation × variant so the UI can show the full FIFO
-- breakdown per project.
-- ============================================================================

CREATE OR REPLACE VIEW public.project_allocation_breakdown AS
SELECT
  ma.project_id,
  p.project_name,
  ma.allocation_id,
  ma.allocation_date,
  ma.status            AS allocation_status,
  ma.material_id,
  m.material_name,
  m.metric,
  avb.breakdown_id,
  avb.variant_id,
  v.variant_name,
  v.purchase_date      AS variant_purchase_date,
  avb.unit_price,
  avb.qty_allocated,
  avb.qty_used,
  avb.qty_returned,
  (avb.qty_allocated - avb.qty_used - avb.qty_returned) AS qty_remaining,
  avb.cost_allocated,
  (avb.qty_used     * avb.unit_price)::NUMERIC(14,2)    AS cost_used,
  (avb.qty_returned * avb.unit_price)::NUMERIC(14,2)    AS value_returned,
  ((avb.qty_allocated - avb.qty_used - avb.qty_returned) * avb.unit_price)::NUMERIC(14,2) AS value_remaining
FROM public.material_allocations ma
JOIN public.allocation_variant_breakdown avb ON avb.allocation_id = ma.allocation_id
JOIN public.material_price_variants v        ON v.variant_id      = avb.variant_id
JOIN public.materials_master m                ON m.material_id     = ma.material_id
JOIN public.projects p                        ON p.project_id      = ma.project_id
ORDER BY ma.project_id, m.material_name, ma.allocation_date, avb.breakdown_id;

GRANT SELECT ON public.project_allocation_breakdown TO authenticated;

-- ============================================================================
-- Reload PostgREST
-- ============================================================================

NOTIFY pgrst, 'reload schema';
