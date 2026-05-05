-- ============================================================================
-- MV-scoped usage recording, revert, and return request.
--
-- All three RPCs gain an optional p_qty_variant_id parameter.
-- When provided, FIFO/LIFO is scoped to breakdown rows whose price variant
-- belongs to that packaging type (material_price_variants.quantity_variant_id).
-- Existing callers that omit the param keep working unchanged (NULL = all).
--
-- material_returns also gains quantity_variant_id + number_of_units columns.
-- ============================================================================

ALTER TABLE public.material_returns
  ADD COLUMN IF NOT EXISTS quantity_variant_id BIGINT
    REFERENCES public.material_variants(variant_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS number_of_units NUMERIC(12,3);

COMMENT ON COLUMN public.material_returns.quantity_variant_id IS
  'Packaging type being returned (e.g. 50 kg Bag). NULL = unspecified.';
COMMENT ON COLUMN public.material_returns.number_of_units IS
  'Physical units returned (bags, cans, …) when quantity_variant_id is set.';

-- ---------------------------------------------------------------------------
-- 1.  record_material_usage_by_material  (FIFO, optionally scoped to one MV)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_material_usage_by_material(
  p_project_id     BIGINT,
  p_material_id    BIGINT,
  p_qty_used       NUMERIC(12,3),
  p_qty_variant_id BIGINT DEFAULT NULL   -- NULL = all packaging variants
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
#variable_conflict use_column
DECLARE
  v_material_name   TEXT;
  v_metric          TEXT;
  v_project_name    TEXT;
  v_remaining       NUMERIC(12,3) := p_qty_used;
  v_total_cost      NUMERIC(14,2) := 0;
  v_breakdown       JSONB         := '[]'::JSONB;
  v_total_available NUMERIC(12,3);
  -- per-batch log
  v_batch_units     NUMERIC(12,3);
  v_price_per_pkg   NUMERIC(14,2);
  v_qty_variant_nm  TEXT;
  v_qty_per_unit    NUMERIC(12,3);
  v_body            TEXT          := '';
  v_use_qty         NUMERIC(12,3);
  r                 RECORD;
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

  -- Resolve packaging variant name for logging
  IF p_qty_variant_id IS NOT NULL THEN
    SELECT mv.variant_name, mv.quantity_per_unit
    INTO v_qty_variant_nm, v_qty_per_unit
    FROM public.material_variants mv WHERE mv.variant_id = p_qty_variant_id;
  END IF;

  -- Available to consume (scoped to MV if given)
  SELECT COALESCE(SUM(avb.qty_allocated - avb.qty_used - avb.qty_returned), 0)
    INTO v_total_available
  FROM public.allocation_variant_breakdown avb
  JOIN public.material_allocations        ma  ON ma.allocation_id  = avb.allocation_id
  JOIN public.material_price_variants     mpv ON mpv.variant_id    = avb.variant_id
  WHERE ma.project_id  = p_project_id
    AND ma.material_id = p_material_id
    AND ma.status IN ('Reserved', 'Issued', 'Partially Issued')
    AND (p_qty_variant_id IS NULL OR mpv.quantity_variant_id = p_qty_variant_id);

  IF v_total_available < p_qty_used THEN
    RAISE EXCEPTION
      'Project % has only % % of "%"% available to use (requested %)',
      p_project_id, v_total_available, COALESCE(v_metric,''), v_material_name,
      CASE WHEN v_qty_variant_nm IS NOT NULL THEN ' [' || v_qty_variant_nm || ']' ELSE '' END,
      p_qty_used;
  END IF;

  -- FIFO across breakdown rows of (optionally) this packaging variant
  FOR r IN
    SELECT avb.breakdown_id,
           avb.allocation_id,
           avb.variant_id,
           avb.batch_id,
           mpv.variant_name,
           mpv.quantity_variant_id,
           mv.variant_name    AS qty_variant_name,
           mv.quantity_per_unit,
           avb.unit_price,
           (avb.qty_allocated - avb.qty_used - avb.qty_returned) AS available
    FROM public.allocation_variant_breakdown avb
    JOIN public.material_allocations        ma  ON ma.allocation_id  = avb.allocation_id
    JOIN public.material_price_variants     mpv ON mpv.variant_id    = avb.variant_id
    LEFT JOIN public.material_variants      mv  ON mv.variant_id     = mpv.quantity_variant_id
    WHERE ma.project_id  = p_project_id
      AND ma.material_id = p_material_id
      AND ma.status IN ('Reserved', 'Issued', 'Partially Issued')
      AND (avb.qty_allocated - avb.qty_used - avb.qty_returned) > 0
      AND (p_qty_variant_id IS NULL OR mpv.quantity_variant_id = p_qty_variant_id)
    ORDER BY avb.breakdown_id ASC    -- FIFO: oldest allocation row first
    FOR UPDATE OF avb
  LOOP
    EXIT WHEN v_remaining <= 0;

    v_use_qty       := LEAST(r.available, v_remaining);
    v_batch_units   := ROUND(v_use_qty / COALESCE(NULLIF(r.quantity_per_unit, 0), 1), 3);
    v_price_per_pkg := ROUND(r.unit_price * COALESCE(r.quantity_per_unit, 1), 2);

    UPDATE public.allocation_variant_breakdown
       SET qty_used = qty_used + v_use_qty
     WHERE allocation_variant_breakdown.breakdown_id = r.breakdown_id;

    v_breakdown := v_breakdown || jsonb_build_array(jsonb_build_object(
      'allocation_id',   r.allocation_id,
      'breakdown_id',    r.breakdown_id,
      'batch_id',        r.batch_id,
      'variant_id',      r.variant_id,
      'qty_variant_name', COALESCE(r.qty_variant_name, r.variant_name),
      'units',           v_batch_units,
      'qty',             v_use_qty,
      'unit_price',      r.unit_price,
      'price_per_pkg',   v_price_per_pkg,
      'cost',            v_use_qty * r.unit_price
    ));

    v_body := v_body
      || '  Breakdown#' || r.breakdown_id
      || ' | ' || COALESCE(r.qty_variant_name, r.variant_name)
      || ' | ' || v_batch_units::TEXT || ' units'
      || ' (' || v_use_qty::TEXT || ' ' || COALESCE(v_metric,'') || ')'
      || ' | Rs.' || v_price_per_pkg::TEXT || '/unit'
      || ' (Rs.' || r.unit_price::TEXT || '/' || COALESCE(v_metric,'unit') || ')'
      || ' = Rs.' || ROUND(v_use_qty * r.unit_price, 2)::TEXT
      || E'\n';

    v_total_cost := v_total_cost + (v_use_qty * r.unit_price);
    v_remaining  := v_remaining  - v_use_qty;
  END LOOP;

  INSERT INTO public.material_movement_logs (
    material_id, movement_type, project_id, quantity,
    reference_type, reference_id, notes, created_by
  ) VALUES (
    p_material_id, 'Project Out', p_project_id, p_qty_used,
    'Material Request', NULL,
    'USAGE (FIFO) | ' || NOW()::TEXT
    || E'\nMaterial : ' || v_material_name
    || E'\nProject  : "' || v_project_name || '" (#' || p_project_id || ')'
    || CASE WHEN v_qty_variant_nm IS NOT NULL
       THEN E'\nPackaging: ' || v_qty_variant_nm
            || ' (' || v_qty_per_unit::TEXT || ' ' || COALESCE(v_metric,'') || '/unit)'
       ELSE '' END
    || E'\nQty used : ' || p_qty_used::TEXT || ' ' || COALESCE(v_metric,'')
    || CASE WHEN v_qty_per_unit IS NOT NULL AND v_qty_per_unit > 0
       THEN ' = ' || ROUND(p_qty_used / v_qty_per_unit, 3)::TEXT || ' units'
       ELSE '' END
    || E'\nCost     : Rs.' || ROUND(v_total_cost, 2)::TEXT
    || E'\nBreakdown:'
    || E'\n' || v_body,
    auth.uid()
  );

  RETURN QUERY SELECT p_qty_used, v_total_cost, v_breakdown;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_material_usage_by_material(BIGINT, BIGINT, NUMERIC, BIGINT) TO authenticated;


-- ---------------------------------------------------------------------------
-- 2.  revert_material_usage_by_material  (LIFO, optionally scoped to one MV)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.revert_material_usage_by_material(
  p_project_id     BIGINT,
  p_material_id    BIGINT,
  p_qty_to_revert  NUMERIC(12,3),
  p_qty_variant_id BIGINT DEFAULT NULL
)
RETURNS TABLE (
  total_reverted NUMERIC(12,3),
  value_reverted NUMERIC(14,2),
  breakdown      JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_material_name  TEXT;
  v_metric         TEXT;
  v_project_name   TEXT;
  v_remaining      NUMERIC(12,3) := p_qty_to_revert;
  v_total_value    NUMERIC(14,2) := 0;
  v_breakdown      JSONB         := '[]'::JSONB;
  v_total_used     NUMERIC(12,3);
  v_qty_variant_nm TEXT;
  v_qty_per_unit   NUMERIC(12,3);
  v_batch_units    NUMERIC(12,3);
  v_price_per_pkg  NUMERIC(14,2);
  v_body           TEXT          := '';
  v_revert_qty     NUMERIC(12,3);
  r                RECORD;
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

  IF p_qty_variant_id IS NOT NULL THEN
    SELECT mv.variant_name, mv.quantity_per_unit
    INTO v_qty_variant_nm, v_qty_per_unit
    FROM public.material_variants mv WHERE mv.variant_id = p_qty_variant_id;
  END IF;

  -- Total recorded usage available to revert (scoped)
  SELECT COALESCE(SUM(avb.qty_used), 0) INTO v_total_used
  FROM public.allocation_variant_breakdown avb
  JOIN public.material_allocations        ma  ON ma.allocation_id = avb.allocation_id
  JOIN public.material_price_variants     mpv ON mpv.variant_id   = avb.variant_id
  WHERE ma.project_id  = p_project_id
    AND ma.material_id = p_material_id
    AND (p_qty_variant_id IS NULL OR mpv.quantity_variant_id = p_qty_variant_id);

  IF v_total_used < p_qty_to_revert THEN
    RAISE EXCEPTION
      'Project % has only % % of "%"% recorded as used (revert requested %)',
      p_project_id, v_total_used, COALESCE(v_metric,''), v_material_name,
      CASE WHEN v_qty_variant_nm IS NOT NULL THEN ' [' || v_qty_variant_nm || ']' ELSE '' END,
      p_qty_to_revert;
  END IF;

  -- LIFO: newest used breakdown first (scoped)
  FOR r IN
    SELECT avb.breakdown_id,
           avb.allocation_id,
           avb.variant_id,
           avb.batch_id,
           mpv.variant_name,
           mv.variant_name    AS qty_variant_name,
           mv.quantity_per_unit,
           avb.unit_price,
           avb.qty_used
    FROM public.allocation_variant_breakdown avb
    JOIN public.material_allocations        ma  ON ma.allocation_id = avb.allocation_id
    JOIN public.material_price_variants     mpv ON mpv.variant_id   = avb.variant_id
    LEFT JOIN public.material_variants      mv  ON mv.variant_id    = mpv.quantity_variant_id
    WHERE ma.project_id  = p_project_id
      AND ma.material_id = p_material_id
      AND avb.qty_used   > 0
      AND (p_qty_variant_id IS NULL OR mpv.quantity_variant_id = p_qty_variant_id)
    ORDER BY avb.breakdown_id DESC   -- LIFO: newest first
    FOR UPDATE OF avb
  LOOP
    EXIT WHEN v_remaining <= 0;

    v_revert_qty    := LEAST(r.qty_used, v_remaining);
    v_batch_units   := ROUND(v_revert_qty / COALESCE(NULLIF(r.quantity_per_unit, 0), 1), 3);
    v_price_per_pkg := ROUND(r.unit_price * COALESCE(r.quantity_per_unit, 1), 2);

    UPDATE public.allocation_variant_breakdown
       SET qty_used = qty_used - v_revert_qty
     WHERE allocation_variant_breakdown.breakdown_id = r.breakdown_id;

    v_breakdown := v_breakdown || jsonb_build_array(jsonb_build_object(
      'allocation_id',   r.allocation_id,
      'breakdown_id',    r.breakdown_id,
      'batch_id',        r.batch_id,
      'variant_id',      r.variant_id,
      'qty_variant_name', COALESCE(r.qty_variant_name, r.variant_name),
      'units',           v_batch_units,
      'qty',             v_revert_qty,
      'unit_price',      r.unit_price,
      'price_per_pkg',   v_price_per_pkg,
      'value',           v_revert_qty * r.unit_price
    ));

    v_body := v_body
      || '  Breakdown#' || r.breakdown_id
      || ' | ' || COALESCE(r.qty_variant_name, r.variant_name)
      || ' | ' || v_batch_units::TEXT || ' units'
      || ' (' || v_revert_qty::TEXT || ' ' || COALESCE(v_metric,'') || ')'
      || ' | Rs.' || v_price_per_pkg::TEXT || '/unit'
      || ' = Rs.' || ROUND(v_revert_qty * r.unit_price, 2)::TEXT
      || E'\n';

    v_total_value := v_total_value + (v_revert_qty * r.unit_price);
    v_remaining   := v_remaining   - v_revert_qty;
  END LOOP;

  INSERT INTO public.material_movement_logs (
    material_id, movement_type, project_id, quantity,
    reference_type, reference_id, notes, created_by
  ) VALUES (
    p_material_id, 'Project Usage Reverted', p_project_id, p_qty_to_revert,
    'Material Request', NULL,
    'USAGE REVERT (LIFO) | ' || NOW()::TEXT
    || E'\nMaterial : ' || v_material_name
    || E'\nProject  : "' || v_project_name || '" (#' || p_project_id || ')'
    || CASE WHEN v_qty_variant_nm IS NOT NULL
       THEN E'\nPackaging: ' || v_qty_variant_nm
            || ' (' || v_qty_per_unit::TEXT || ' ' || COALESCE(v_metric,'') || '/unit)'
       ELSE '' END
    || E'\nReverted : ' || p_qty_to_revert::TEXT || ' ' || COALESCE(v_metric,'')
    || CASE WHEN v_qty_per_unit IS NOT NULL AND v_qty_per_unit > 0
       THEN ' = ' || ROUND(p_qty_to_revert / v_qty_per_unit, 3)::TEXT || ' units'
       ELSE '' END
    || E'\nValue    : Rs.' || ROUND(v_total_value, 2)::TEXT
    || E'\n(stock stays at project as allocated-but-unused)'
    || E'\nBreakdown:'
    || E'\n' || v_body,
    auth.uid()
  );

  RETURN QUERY SELECT p_qty_to_revert, v_total_value, v_breakdown;
END;
$$;

GRANT EXECUTE ON FUNCTION public.revert_material_usage_by_material(BIGINT, BIGINT, NUMERIC, BIGINT) TO authenticated;


-- ---------------------------------------------------------------------------
-- 3.  submit_material_return_request  (scoped to one MV)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_material_return_request(
  p_project_id     BIGINT,
  p_material_id    BIGINT,
  p_quantity       NUMERIC(12,3),
  p_condition      TEXT,
  p_reason         TEXT    DEFAULT NULL,
  p_qty_variant_id BIGINT  DEFAULT NULL,
  p_number_of_units NUMERIC(12,3) DEFAULT NULL
)
RETURNS TABLE (
  return_id        BIGINT,
  return_number    TEXT,
  returnable_after NUMERIC(12,3)
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_material_name  TEXT;
  v_metric         TEXT;
  v_project_name   TEXT;
  v_allocated      NUMERIC(12,3);
  v_used           NUMERIC(12,3);
  v_returned       NUMERIC(12,3);
  v_pending_return NUMERIC(12,3);
  v_returnable     NUMERIC(12,3);
  v_return_id      BIGINT;
  v_return_number  TEXT;
  v_qty_variant_nm TEXT;
  v_qty_per_unit   NUMERIC(12,3);
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'quantity must be > 0';
  END IF;
  IF p_condition IS NULL OR btrim(p_condition) = '' THEN
    RAISE EXCEPTION 'condition is required';
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

  IF p_qty_variant_id IS NOT NULL THEN
    SELECT mv.variant_name, mv.quantity_per_unit
    INTO v_qty_variant_nm, v_qty_per_unit
    FROM public.material_variants mv WHERE mv.variant_id = p_qty_variant_id;
  END IF;

  -- Returnable = allocated − used − already-returned (scoped to MV if given)
  SELECT
    COALESCE(SUM(avb.qty_allocated), 0),
    COALESCE(SUM(avb.qty_used),      0),
    COALESCE(SUM(avb.qty_returned),  0)
  INTO v_allocated, v_used, v_returned
  FROM public.allocation_variant_breakdown avb
  JOIN public.material_allocations        ma  ON ma.allocation_id = avb.allocation_id
  JOIN public.material_price_variants     mpv ON mpv.variant_id   = avb.variant_id
  WHERE ma.project_id  = p_project_id
    AND ma.material_id = p_material_id
    AND (p_qty_variant_id IS NULL OR mpv.quantity_variant_id = p_qty_variant_id);

  -- Pending returns (scoped)
  SELECT COALESCE(SUM(mr.returned_quantity), 0) INTO v_pending_return
  FROM public.material_returns mr
  WHERE mr.project_id  = p_project_id
    AND mr.material_id = p_material_id
    AND mr.status      = 'Pending'
    AND (p_qty_variant_id IS NULL OR mr.quantity_variant_id = p_qty_variant_id);

  v_returnable := v_allocated - v_used - v_returned - v_pending_return;

  IF p_quantity > v_returnable THEN
    RAISE EXCEPTION
      'Cannot return % % of "%"%: only % returnable (allocated=%, used=%, returned=%, pending=%)',
      p_quantity, COALESCE(v_metric,''), v_material_name,
      CASE WHEN v_qty_variant_nm IS NOT NULL THEN ' [' || v_qty_variant_nm || ']' ELSE '' END,
      v_returnable, v_allocated, v_used, v_returned, v_pending_return;
  END IF;

  v_return_number := 'RR-' || EXTRACT(EPOCH FROM NOW())::BIGINT::TEXT;

  INSERT INTO public.material_returns (
    return_number, project_id, material_id, returned_quantity,
    quantity_variant_id, number_of_units,
    condition, reason, status, created_by
  ) VALUES (
    v_return_number, p_project_id, p_material_id, p_quantity,
    p_qty_variant_id, p_number_of_units,
    p_condition, p_reason, 'Pending', auth.uid()
  )
  RETURNING material_returns.return_id INTO v_return_id;

  INSERT INTO public.material_movement_logs (
    material_id, movement_type, project_id, quantity,
    reference_type, reference_id, notes, created_by
  ) VALUES (
    p_material_id, 'Return Submitted', p_project_id, p_quantity,
    'Material Return', v_return_id,
    'RETURN SUBMITTED | ' || NOW()::TEXT
    || E'\nMaterial : ' || v_material_name
    || E'\nProject  : "' || v_project_name || '" (#' || p_project_id || ')'
    || CASE WHEN v_qty_variant_nm IS NOT NULL
       THEN E'\nPackaging: ' || v_qty_variant_nm
            || ' (' || v_qty_per_unit::TEXT || ' ' || COALESCE(v_metric,'') || '/unit)'
       ELSE '' END
    || E'\nQty      : ' || p_quantity::TEXT || ' ' || COALESCE(v_metric,'')
    || CASE WHEN p_number_of_units IS NOT NULL
       THEN ' = ' || p_number_of_units::TEXT || ' units' ELSE '' END
    || E'\nCondition: ' || p_condition
    || CASE WHEN p_reason IS NOT NULL AND btrim(p_reason) <> ''
       THEN E'\nReason   : ' || p_reason ELSE '' END
    || E'\nReturn#  : ' || v_return_number
    || E'\nStatus   : Pending store approval',
    auth.uid()
  );

  RETURN QUERY SELECT v_return_id, v_return_number, (v_returnable - p_quantity)::NUMERIC(12,3);
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_material_return_request(BIGINT, BIGINT, NUMERIC, TEXT, TEXT, BIGINT, NUMERIC) TO authenticated;

NOTIFY pgrst, 'reload schema';
