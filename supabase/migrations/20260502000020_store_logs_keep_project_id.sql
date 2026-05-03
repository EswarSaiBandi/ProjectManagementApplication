-- ============================================================================
-- Store Out / Store In companion rows (for MR approval + Return approval)
-- SHOULD keep project_id set so the audit linkage is preserved. The
-- project-level UI now filters Store In/Out by movement_type, not by
-- project_id.
--
-- Supersedes 20260502000019's decision to null out project_id on those rows.
--
-- Changes:
--   1. Redefine allocate_material_fifo — Store Out row now uses project_id.
--   2. Redefine approve_material_return_request — Store In row now uses project_id.
--   3. Backfill: set project_id on existing Store Out / Store In rows created
--      by the above RPCs (reference_type in Material Request / Material Return,
--      project_id currently NULL) by looking up the allocation / return row.
--
-- Run AFTER 20260502000019_dual_log_for_mr_and_return_approvals.sql.
-- ============================================================================

-- =========================================================================
-- 1. allocate_material_fifo — Store Out row uses project_id now
-- =========================================================================

DROP FUNCTION IF EXISTS public.allocate_material_fifo(BIGINT, BIGINT, NUMERIC) CASCADE;

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
#variable_conflict use_column
DECLARE
  v_allocation_id BIGINT;
  v_remaining     NUMERIC(12,3) := p_required_qty;
  v_total_cost    NUMERIC(14,2) := 0;
  v_breakdown     JSONB         := '[]'::JSONB;
  v_lines         TEXT[]        := ARRAY[]::TEXT[];
  v_qty_to_alloc  NUMERIC(12,3);
  v_floor_batch   NUMERIC(12,3);
  v_total_whole   NUMERIC(12,3);
  v_material_name TEXT;
  v_metric        TEXT;
  v_project_name  TEXT;
  v_notes_proj    TEXT;
  v_notes_store   TEXT;
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

  SELECT COALESCE(SUM(FLOOR(b.quantity_available)), 0)
    INTO v_total_whole
  FROM public.material_stock_batches b
  JOIN public.material_price_variants v ON v.variant_id = b.variant_id
  WHERE v.material_id = p_material_id;

  IF v_total_whole < p_required_qty THEN
    RAISE EXCEPTION
      'Insufficient whole-unit stock for material "%": need %, whole-unit available = %',
      v_material_name, p_required_qty, v_total_whole;
  END IF;

  INSERT INTO public.material_allocations (
    material_id, project_id, allocated_quantity, status, allocated_by
  ) VALUES (
    p_material_id, p_project_id, p_required_qty, 'Reserved', auth.uid()
  )
  RETURNING material_allocations.allocation_id INTO v_allocation_id;

  FOR r IN
    SELECT b.batch_id, b.variant_id, b.batch_date,
           v.variant_name, v.unit_price, b.quantity_available
      FROM public.material_stock_batches b
      JOIN public.material_price_variants v ON v.variant_id = b.variant_id
     WHERE v.material_id = p_material_id
       AND b.quantity_available >= 1
     ORDER BY b.batch_date ASC, b.batch_id ASC
     FOR UPDATE OF b
  LOOP
    EXIT WHEN v_remaining <= 0;

    v_floor_batch  := FLOOR(r.quantity_available);
    CONTINUE WHEN v_floor_batch <= 0;

    v_qty_to_alloc := LEAST(v_floor_batch, v_remaining);

    INSERT INTO public.allocation_variant_breakdown (
      allocation_id, batch_id, variant_id, qty_allocated, unit_price
    ) VALUES (
      v_allocation_id, r.batch_id, r.variant_id, v_qty_to_alloc, r.unit_price
    );

    UPDATE public.material_stock_batches AS b
       SET quantity_available = b.quantity_available - v_qty_to_alloc
     WHERE b.batch_id = r.batch_id;

    v_breakdown := v_breakdown || jsonb_build_array(jsonb_build_object(
      'batch_id',     r.batch_id,
      'variant_id',   r.variant_id,
      'variant_name', r.variant_name,
      'batch_date',   r.batch_date,
      'qty',          v_qty_to_alloc,
      'unit_price',   r.unit_price,
      'cost',         v_qty_to_alloc * r.unit_price
    ));
    v_lines := v_lines || (
      v_qty_to_alloc::TEXT || ' @ Rs.' || r.unit_price::TEXT ||
      ' (variant="' || r.variant_name || '", batch#=' || r.batch_id ||
      ', batch_date=' || r.batch_date::TEXT || ')' ||
      ' = Rs.' || (v_qty_to_alloc * r.unit_price)::TEXT
    );

    v_total_cost := v_total_cost + (v_qty_to_alloc * r.unit_price);
    v_remaining  := v_remaining  - v_qty_to_alloc;
  END LOOP;

  IF v_remaining > 0 THEN
    RAISE EXCEPTION
      'Whole-unit FIFO: only % of requested % could be allocated.',
      p_required_qty - v_remaining, p_required_qty;
  END IF;

  v_notes_proj :=
    'PROJECT IN: ' || p_required_qty::TEXT || ' ' || COALESCE(v_metric, '') ||
    ' of ' || v_material_name ||
    ' allocated to project "' || v_project_name || '" (#' || p_project_id || ')' ||
    ' | breakdown: [' || array_to_string(v_lines, '; ') || ']' ||
    ' | total cost = Rs.' || v_total_cost::TEXT ||
    ' | alloc#=' || v_allocation_id ||
    ' | at=' || NOW()::TEXT;

  INSERT INTO public.material_movement_logs (
    material_id, movement_type, project_id, quantity,
    reference_type, reference_id, notes, created_by
  ) VALUES (
    p_material_id, 'Project In', p_project_id, p_required_qty,
    'Material Request', v_allocation_id, v_notes_proj, auth.uid()
  );

  v_notes_store :=
    'STORE OUT (to project "' || v_project_name || '" #' || p_project_id || '): ' ||
    p_required_qty::TEXT || ' ' || COALESCE(v_metric, '') ||
    ' of ' || v_material_name ||
    ' | alloc#=' || v_allocation_id ||
    ' | total value = Rs.' || v_total_cost::TEXT ||
    ' | breakdown: [' || array_to_string(v_lines, '; ') || ']' ||
    ' | at=' || NOW()::TEXT;

  INSERT INTO public.material_movement_logs (
    material_id, movement_type, project_id, quantity,
    reference_type, reference_id, notes, created_by
  ) VALUES (
    p_material_id, 'Store Out', p_project_id, p_required_qty,      -- project_id set
    'Material Request', v_allocation_id, v_notes_store, auth.uid()
  );

  RETURN QUERY SELECT v_allocation_id, p_required_qty, v_total_cost, v_breakdown;
END;
$$;

GRANT EXECUTE ON FUNCTION public.allocate_material_fifo(BIGINT, BIGINT, NUMERIC) TO authenticated;

-- =========================================================================
-- 2. approve_material_return_request — Store In row uses project_id now
-- =========================================================================

DROP FUNCTION IF EXISTS public.approve_material_return_request(BIGINT, TEXT) CASCADE;

CREATE OR REPLACE FUNCTION public.approve_material_return_request(
  p_return_id     BIGINT,
  p_review_notes  TEXT DEFAULT NULL
)
RETURNS TABLE (
  return_id       BIGINT,
  qty_returned    NUMERIC(12,3),
  total_value     NUMERIC(14,2),
  breakdown       JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_project_id      BIGINT;
  v_material_id     BIGINT;
  v_qty             NUMERIC(12,3);
  v_status          TEXT;
  v_return_number   TEXT;
  v_condition       TEXT;
  v_material_name   TEXT;
  v_metric          TEXT;
  v_project_name    TEXT;
  v_remaining       NUMERIC(12,3);
  v_total_value     NUMERIC(14,2) := 0;
  v_breakdown       JSONB         := '[]'::JSONB;
  v_lines           TEXT[]        := ARRAY[]::TEXT[];
  v_return_qty      NUMERIC(12,3);
  v_notes_proj      TEXT;
  v_notes_store     TEXT;
  r RECORD;
BEGIN
  PERFORM public._assert_admin();

  SELECT mr.project_id, mr.material_id, mr.returned_quantity, mr.status,
         mr.return_number, mr.condition,
         m.material_name, m.metric, p.project_name
    INTO v_project_id, v_material_id, v_qty, v_status,
         v_return_number, v_condition,
         v_material_name, v_metric, v_project_name
  FROM public.material_returns mr
  JOIN public.materials_master m ON m.material_id = mr.material_id
  JOIN public.projects p         ON p.project_id  = mr.project_id
  WHERE mr.return_id = p_return_id
  FOR UPDATE OF mr;

  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'Return request % not found', p_return_id;
  END IF;

  IF v_status <> 'Pending' THEN
    RAISE EXCEPTION 'Return request % is already % — cannot approve', p_return_id, v_status;
  END IF;

  v_remaining := v_qty;

  FOR r IN
    SELECT avb.breakdown_id, avb.allocation_id, avb.variant_id, avb.batch_id,
           mpv.variant_name, avb.unit_price,
           avb.qty_allocated - avb.qty_used - avb.qty_returned AS available
    FROM public.allocation_variant_breakdown avb
    JOIN public.material_allocations        ma  ON ma.allocation_id = avb.allocation_id
    JOIN public.material_price_variants     mpv ON mpv.variant_id   = avb.variant_id
    WHERE ma.project_id  = v_project_id
      AND ma.material_id = v_material_id
      AND (avb.qty_allocated - avb.qty_used - avb.qty_returned) > 0
    ORDER BY avb.breakdown_id DESC
    FOR UPDATE OF avb
  LOOP
    EXIT WHEN v_remaining <= 0;

    v_return_qty := LEAST(r.available, v_remaining);

    UPDATE public.allocation_variant_breakdown AS avb
       SET qty_returned = avb.qty_returned + v_return_qty
     WHERE avb.breakdown_id = r.breakdown_id;

    UPDATE public.material_stock_batches AS b
       SET quantity_available = b.quantity_available + v_return_qty
     WHERE b.batch_id = r.batch_id;

    v_breakdown := v_breakdown || jsonb_build_array(jsonb_build_object(
      'allocation_id', r.allocation_id, 'breakdown_id',  r.breakdown_id,
      'batch_id',      r.batch_id,      'variant_id',    r.variant_id,
      'variant_name',  r.variant_name,  'qty',           v_return_qty,
      'unit_price',    r.unit_price,    'value',         v_return_qty * r.unit_price
    ));
    v_lines := v_lines || (
      v_return_qty::TEXT || ' @ Rs.' || r.unit_price::TEXT ||
      ' (alloc#=' || r.allocation_id ||
      ', variant="' || r.variant_name ||
      '", batch#=' || r.batch_id || ')' ||
      ' = Rs.' || (v_return_qty * r.unit_price)::TEXT
    );

    v_total_value := v_total_value + (v_return_qty * r.unit_price);
    v_remaining   := v_remaining   - v_return_qty;
  END LOOP;

  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'Return request %: only % could be returned out of %',
      p_return_id, v_qty - v_remaining, v_qty;
  END IF;

  UPDATE public.material_returns AS mr
     SET status       = 'Accepted',
         reviewed_at  = NOW(),
         review_notes = COALESCE(p_review_notes, 'Accepted by store'),
         reviewed_by  = auth.uid()
   WHERE mr.return_id = p_return_id;

  v_notes_proj :=
    'PROJECT OUT (Return Approved): ' || v_qty::TEXT || ' ' || COALESCE(v_metric, '') ||
    ' of ' || v_material_name ||
    ' returned from project "' || v_project_name || '" (#' || v_project_id || ') to store' ||
    ' | return#=' || v_return_number ||
    ' | LIFO breakdown: [' || array_to_string(v_lines, '; ') || ']' ||
    ' | total value = Rs.' || v_total_value::TEXT ||
    ' | condition=' || COALESCE(v_condition, 'N/A') ||
    CASE WHEN p_review_notes IS NOT NULL AND btrim(p_review_notes) <> ''
         THEN ' | review_note="' || p_review_notes || '"' ELSE '' END ||
    ' | at=' || NOW()::TEXT;

  INSERT INTO public.material_movement_logs (
    material_id, movement_type, project_id, quantity,
    reference_type, reference_id, notes, created_by
  ) VALUES (
    v_material_id, 'Project Out (Return Approved)', v_project_id, v_qty,
    'Material Return', p_return_id, v_notes_proj, auth.uid()
  );

  v_notes_store :=
    'STORE IN (from project "' || v_project_name || '" #' || v_project_id || ' return ' || v_return_number || '): ' ||
    v_qty::TEXT || ' ' || COALESCE(v_metric, '') ||
    ' of ' || v_material_name ||
    ' | total value = Rs.' || v_total_value::TEXT ||
    ' | condition=' || COALESCE(v_condition, 'N/A') ||
    ' | stock re-credited to original batches (LIFO)' ||
    ' | at=' || NOW()::TEXT;

  INSERT INTO public.material_movement_logs (
    material_id, movement_type, project_id, quantity,
    reference_type, reference_id, notes, created_by
  ) VALUES (
    v_material_id, 'Store In', v_project_id, v_qty,              -- project_id set
    'Material Return', p_return_id, v_notes_store, auth.uid()
  );

  RETURN QUERY SELECT p_return_id, v_qty, v_total_value, v_breakdown;
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_material_return_request(BIGINT, TEXT) TO authenticated;

-- =========================================================================
-- 3. Backfill existing Store Out / Store In companion rows that 20260502000019
--    inserted with project_id = NULL.
-- =========================================================================

-- Store Out rows for MR approval — recover project_id from the allocation row.
UPDATE public.material_movement_logs AS m
   SET project_id = ma.project_id
  FROM public.material_allocations ma
 WHERE m.movement_type  = 'Store Out'
   AND m.reference_type = 'Material Request'
   AND m.reference_id   = ma.allocation_id
   AND m.project_id IS NULL;

-- Store In rows for Return approval — recover project_id from the return row.
UPDATE public.material_movement_logs AS m
   SET project_id = mr.project_id
  FROM public.material_returns mr
 WHERE m.movement_type  = 'Store In'
   AND m.reference_type = 'Material Return'
   AND m.reference_id   = mr.return_id
   AND m.project_id IS NULL;

NOTIFY pgrst, 'reload schema';
