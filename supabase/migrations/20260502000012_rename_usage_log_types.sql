-- ============================================================================
-- Rename log labels so the Project Material Movements tab reads naturally:
--   'Project Out'              → 'Stock Used'
--   'Project Usage Reverted'   → 'Stock Used Reverted'
--
-- Other movement types are unchanged:
--   Store In / Store Out / Project In / Return to Store / Local Procurement
--   Request Raised / Request Cancelled / Request Rejected
--   Return Submitted / Return Accepted / Return Rejected
--
-- Material cost flow (unchanged, just clearer labels):
--   Record usage → qty_used increases → Stock Used log entry.
--   Revert usage → qty_used decreases → Stock Used Reverted log entry.
--   project_costing_summary.material_cost_actual = SUM(qty_used * unit_price)
--   So net material cost = (total used) − (total reverted), automatically.
--
-- Run AFTER 20260502000011_material_level_usage_and_revert.sql.
-- ============================================================================

-- Step 1: widen CHECK so both old and new values are allowed (transitional).
ALTER TABLE public.material_movement_logs
  DROP CONSTRAINT IF EXISTS material_movement_logs_movement_type_check;

ALTER TABLE public.material_movement_logs
  ADD CONSTRAINT material_movement_logs_movement_type_check
  CHECK (movement_type IN (
    -- Physical stock movements
    'Store In', 'Store Out', 'Project In',
    'Return to Store', 'Local Procurement',
    -- New labels
    'Stock Used', 'Stock Used Reverted',
    -- Workflow lifecycle events
    'Request Raised', 'Request Cancelled', 'Request Rejected',
    'Return Submitted', 'Return Accepted', 'Return Rejected',
    -- Old labels (kept valid until data update below; removed after)
    'Project Out', 'Project Usage Reverted'
  ));

-- Step 2: migrate existing rows.
UPDATE public.material_movement_logs
   SET movement_type = 'Stock Used'
 WHERE movement_type = 'Project Out';

UPDATE public.material_movement_logs
   SET movement_type = 'Stock Used Reverted'
 WHERE movement_type = 'Project Usage Reverted';

-- Step 3: tighten CHECK to drop the old labels.
ALTER TABLE public.material_movement_logs
  DROP CONSTRAINT material_movement_logs_movement_type_check;

ALTER TABLE public.material_movement_logs
  ADD CONSTRAINT material_movement_logs_movement_type_check
  CHECK (movement_type IN (
    'Store In', 'Store Out', 'Project In',
    'Return to Store', 'Local Procurement',
    'Stock Used', 'Stock Used Reverted',
    'Request Raised', 'Request Cancelled', 'Request Rejected',
    'Return Submitted', 'Return Accepted', 'Return Rejected'
  ));

-- Step 4: update RPCs that still emit the old labels.

-- record_material_usage (legacy per-allocation variant) — keep it for
-- programmatic callers; just switch the label.
DROP FUNCTION IF EXISTS public.record_material_usage(BIGINT, NUMERIC) CASCADE;

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
    SELECT avb.breakdown_id, avb.batch_id, avb.variant_id,
           mpv.variant_name, avb.unit_price,
           avb.qty_allocated - avb.qty_used - avb.qty_returned AS available
    FROM public.allocation_variant_breakdown avb
    JOIN public.material_price_variants mpv ON mpv.variant_id = avb.variant_id
    WHERE avb.allocation_id = p_allocation_id
    ORDER BY avb.breakdown_id ASC
    FOR UPDATE OF avb
  LOOP
    EXIT WHEN v_remaining <= 0;
    CONTINUE WHEN r.available <= 0;

    v_use_qty := LEAST(r.available, v_remaining);

    UPDATE public.allocation_variant_breakdown
    SET qty_used = qty_used + v_use_qty
    WHERE allocation_variant_breakdown.breakdown_id = r.breakdown_id;

    v_breakdown := v_breakdown || jsonb_build_array(jsonb_build_object(
      'batch_id', r.batch_id, 'variant_id', r.variant_id,
      'variant_name', r.variant_name, 'qty', v_use_qty,
      'unit_price', r.unit_price, 'cost', v_use_qty * r.unit_price
    ));
    v_lines := v_lines || (
      v_use_qty::TEXT || ' @ Rs.' || r.unit_price::TEXT ||
      ' (variant="' || r.variant_name || '", batch#=' || r.batch_id || ')' ||
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
    'STOCK USED: ' || p_qty_used::TEXT || ' ' || COALESCE(v_metric, '') ||
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
    v_material_id, 'Stock Used', v_project_id, p_qty_used,
    'Material Request', p_allocation_id, v_notes, auth.uid()
  );

  RETURN QUERY SELECT p_allocation_id, p_qty_used, v_total_cost, v_breakdown;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_material_usage(BIGINT, NUMERIC) TO authenticated;

-- record_material_usage_by_material — the UI's canonical flow.
DROP FUNCTION IF EXISTS public.record_material_usage_by_material(BIGINT, BIGINT, NUMERIC) CASCADE;

CREATE OR REPLACE FUNCTION public.record_material_usage_by_material(
  p_project_id  BIGINT,
  p_material_id BIGINT,
  p_qty_used    NUMERIC(12,3)
)
RETURNS TABLE (
  total_used    NUMERIC(12,3),
  cost_of_usage NUMERIC(14,2),
  breakdown     JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_material_name TEXT;
  v_metric        TEXT;
  v_project_name  TEXT;
  v_remaining     NUMERIC(12,3) := p_qty_used;
  v_total_cost    NUMERIC(14,2) := 0;
  v_breakdown     JSONB         := '[]'::JSONB;
  v_lines         TEXT[]        := ARRAY[]::TEXT[];
  v_use_qty       NUMERIC(12,3);
  v_total_available NUMERIC(12,3);
  v_notes         TEXT;
  r RECORD;
BEGIN
  IF p_qty_used IS NULL OR p_qty_used <= 0 THEN
    RAISE EXCEPTION 'qty_used must be > 0';
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

  SELECT COALESCE(SUM(avb.qty_allocated - avb.qty_used - avb.qty_returned), 0)
    INTO v_total_available
  FROM public.allocation_variant_breakdown avb
  JOIN public.material_allocations ma ON ma.allocation_id = avb.allocation_id
  WHERE ma.project_id  = p_project_id
    AND ma.material_id = p_material_id
    AND ma.status IN ('Reserved', 'Issued', 'Partially Issued');

  IF v_total_available < p_qty_used THEN
    RAISE EXCEPTION 'Project % has only % % of "%" available to use (requested %)',
      p_project_id, v_total_available, COALESCE(v_metric, ''), v_material_name, p_qty_used;
  END IF;

  FOR r IN
    SELECT avb.breakdown_id, avb.allocation_id, avb.variant_id, avb.batch_id,
           mpv.variant_name, avb.unit_price,
           avb.qty_allocated - avb.qty_used - avb.qty_returned AS available
    FROM public.allocation_variant_breakdown avb
    JOIN public.material_allocations        ma  ON ma.allocation_id = avb.allocation_id
    JOIN public.material_price_variants     mpv ON mpv.variant_id   = avb.variant_id
    WHERE ma.project_id  = p_project_id
      AND ma.material_id = p_material_id
      AND ma.status IN ('Reserved', 'Issued', 'Partially Issued')
      AND (avb.qty_allocated - avb.qty_used - avb.qty_returned) > 0
    ORDER BY avb.breakdown_id ASC
    FOR UPDATE OF avb
  LOOP
    EXIT WHEN v_remaining <= 0;

    v_use_qty := LEAST(r.available, v_remaining);

    UPDATE public.allocation_variant_breakdown
    SET qty_used = qty_used + v_use_qty
    WHERE allocation_variant_breakdown.breakdown_id = r.breakdown_id;

    v_breakdown := v_breakdown || jsonb_build_array(jsonb_build_object(
      'allocation_id', r.allocation_id, 'breakdown_id', r.breakdown_id,
      'batch_id', r.batch_id, 'variant_id', r.variant_id,
      'variant_name', r.variant_name, 'qty', v_use_qty,
      'unit_price', r.unit_price, 'cost', v_use_qty * r.unit_price
    ));
    v_lines := v_lines || (
      v_use_qty::TEXT || ' @ Rs.' || r.unit_price::TEXT ||
      ' (alloc#=' || r.allocation_id || ', variant="' || r.variant_name ||
      '", batch#=' || r.batch_id || ') = Rs.' || (v_use_qty * r.unit_price)::TEXT
    );

    v_total_cost := v_total_cost + (v_use_qty * r.unit_price);
    v_remaining  := v_remaining  - v_use_qty;
  END LOOP;

  v_notes :=
    'STOCK USED: ' || p_qty_used::TEXT || ' ' || COALESCE(v_metric, '') ||
    ' of ' || v_material_name ||
    ' consumed on-site in project "' || v_project_name || '" (#' || p_project_id || ')' ||
    ' | breakdown: [' || array_to_string(v_lines, '; ') || ']' ||
    ' | total cost = Rs.' || v_total_cost::TEXT ||
    ' | at=' || NOW()::TEXT;

  INSERT INTO public.material_movement_logs (
    material_id, movement_type, project_id, quantity,
    reference_type, reference_id, notes, created_by
  ) VALUES (
    p_material_id, 'Stock Used', p_project_id, p_qty_used,
    'Material Request', NULL, v_notes, auth.uid()
  );

  RETURN QUERY SELECT p_qty_used, v_total_cost, v_breakdown;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_material_usage_by_material(BIGINT, BIGINT, NUMERIC) TO authenticated;

-- revert_material_usage_by_material — the UI's revert flow.
DROP FUNCTION IF EXISTS public.revert_material_usage_by_material(BIGINT, BIGINT, NUMERIC) CASCADE;

CREATE OR REPLACE FUNCTION public.revert_material_usage_by_material(
  p_project_id     BIGINT,
  p_material_id    BIGINT,
  p_qty_to_revert  NUMERIC(12,3)
)
RETURNS TABLE (
  total_reverted  NUMERIC(12,3),
  value_reverted  NUMERIC(14,2),
  breakdown       JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_material_name TEXT;
  v_metric        TEXT;
  v_project_name  TEXT;
  v_remaining     NUMERIC(12,3) := p_qty_to_revert;
  v_total_value   NUMERIC(14,2) := 0;
  v_breakdown     JSONB         := '[]'::JSONB;
  v_lines         TEXT[]        := ARRAY[]::TEXT[];
  v_revert_qty    NUMERIC(12,3);
  v_total_used    NUMERIC(12,3);
  v_notes         TEXT;
  r RECORD;
BEGIN
  IF p_qty_to_revert IS NULL OR p_qty_to_revert <= 0 THEN
    RAISE EXCEPTION 'qty_to_revert must be > 0';
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

  SELECT COALESCE(SUM(avb.qty_used), 0) INTO v_total_used
  FROM public.allocation_variant_breakdown avb
  JOIN public.material_allocations ma ON ma.allocation_id = avb.allocation_id
  WHERE ma.project_id  = p_project_id
    AND ma.material_id = p_material_id;

  IF v_total_used < p_qty_to_revert THEN
    RAISE EXCEPTION 'Project % has only % % of "%" recorded as used (revert requested %)',
      p_project_id, v_total_used, COALESCE(v_metric, ''), v_material_name, p_qty_to_revert;
  END IF;

  FOR r IN
    SELECT avb.breakdown_id, avb.allocation_id, avb.variant_id, avb.batch_id,
           mpv.variant_name, avb.unit_price, avb.qty_used
    FROM public.allocation_variant_breakdown avb
    JOIN public.material_allocations        ma  ON ma.allocation_id = avb.allocation_id
    JOIN public.material_price_variants     mpv ON mpv.variant_id   = avb.variant_id
    WHERE ma.project_id  = p_project_id
      AND ma.material_id = p_material_id
      AND avb.qty_used > 0
    ORDER BY avb.breakdown_id DESC
    FOR UPDATE OF avb
  LOOP
    EXIT WHEN v_remaining <= 0;

    v_revert_qty := LEAST(r.qty_used, v_remaining);

    UPDATE public.allocation_variant_breakdown
    SET qty_used = qty_used - v_revert_qty
    WHERE allocation_variant_breakdown.breakdown_id = r.breakdown_id;

    v_breakdown := v_breakdown || jsonb_build_array(jsonb_build_object(
      'allocation_id', r.allocation_id, 'breakdown_id', r.breakdown_id,
      'batch_id', r.batch_id, 'variant_id', r.variant_id,
      'variant_name', r.variant_name, 'qty', v_revert_qty,
      'unit_price', r.unit_price, 'value', v_revert_qty * r.unit_price
    ));
    v_lines := v_lines || (
      v_revert_qty::TEXT || ' @ Rs.' || r.unit_price::TEXT ||
      ' (alloc#=' || r.allocation_id || ', variant="' || r.variant_name ||
      '", batch#=' || r.batch_id || ') = Rs.' || (v_revert_qty * r.unit_price)::TEXT
    );

    v_total_value := v_total_value + (v_revert_qty * r.unit_price);
    v_remaining   := v_remaining   - v_revert_qty;
  END LOOP;

  v_notes :=
    'STOCK USED REVERTED: ' || p_qty_to_revert::TEXT || ' ' || COALESCE(v_metric, '') ||
    ' of ' || v_material_name ||
    ' unconsumed in project "' || v_project_name || '" (#' || p_project_id || ')' ||
    ' (stock stays at project as allocated-but-unused; does NOT return to store)' ||
    ' | breakdown: [' || array_to_string(v_lines, '; ') || ']' ||
    ' | total value = Rs.' || v_total_value::TEXT ||
    ' | at=' || NOW()::TEXT;

  INSERT INTO public.material_movement_logs (
    material_id, movement_type, project_id, quantity,
    reference_type, reference_id, notes, created_by
  ) VALUES (
    p_material_id, 'Stock Used Reverted', p_project_id, p_qty_to_revert,
    'Material Request', NULL, v_notes, auth.uid()
  );

  RETURN QUERY SELECT p_qty_to_revert, v_total_value, v_breakdown;
END;
$$;

GRANT EXECUTE ON FUNCTION public.revert_material_usage_by_material(BIGINT, BIGINT, NUMERIC) TO authenticated;

NOTIFY pgrst, 'reload schema';
