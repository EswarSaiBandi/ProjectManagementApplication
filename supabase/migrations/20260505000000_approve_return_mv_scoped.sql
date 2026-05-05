-- ============================================================================
-- approve_material_return_request — scope LIFO to the submitted packaging MV.
--
-- Before (20260502000020): LIFO walked every breakdown row of (project,
-- material) regardless of the packaging variant the PM submitted. A return of
-- "100 kg of 50 kg Bag" could end up crediting 25 kg Bag batches.
--
-- After: when material_returns.quantity_variant_id IS NOT NULL, the LIFO walk
-- filters to breakdown rows whose price variant belongs to that packaging.
-- Legacy returns without a packaging (quantity_variant_id IS NULL) keep the
-- previous "walk all breakdowns" behaviour.
--
-- Everything else is preserved verbatim from 20260502000020:
--   * dual movement logs: 'Project Out (Return Approved)' + 'Store In'
--   * batch quantity_available credit
--   * status='Accepted' update
--   * #variable_conflict use_column
--
-- Run AFTER 20260504000007_mv_scoped_usage_return.sql.
-- ============================================================================

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
  v_project_id        BIGINT;
  v_material_id       BIGINT;
  v_qty               NUMERIC(12,3);
  v_status            TEXT;
  v_return_number     TEXT;
  v_condition         TEXT;
  v_qty_variant_id    BIGINT;
  v_qty_variant_name  TEXT;
  v_material_name     TEXT;
  v_metric            TEXT;
  v_project_name      TEXT;
  v_remaining         NUMERIC(12,3);
  v_total_value       NUMERIC(14,2) := 0;
  v_breakdown         JSONB         := '[]'::JSONB;
  v_lines             TEXT[]        := ARRAY[]::TEXT[];
  v_return_qty        NUMERIC(12,3);
  v_pkg_tag           TEXT          := '';
  v_notes_proj        TEXT;
  v_notes_store       TEXT;
  r RECORD;
BEGIN
  PERFORM public._assert_admin();

  SELECT mr.project_id, mr.material_id, mr.returned_quantity, mr.status,
         mr.return_number, mr.condition, mr.quantity_variant_id,
         m.material_name, m.metric, p.project_name
    INTO v_project_id, v_material_id, v_qty, v_status,
         v_return_number, v_condition, v_qty_variant_id,
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

  IF v_qty_variant_id IS NOT NULL THEN
    SELECT mv.variant_name INTO v_qty_variant_name
    FROM public.material_variants mv
    WHERE mv.variant_id = v_qty_variant_id;
    v_pkg_tag := ' [' || COALESCE(v_qty_variant_name, 'MV#' || v_qty_variant_id::TEXT) || ']';
  END IF;

  v_remaining := v_qty;

  -- LIFO walk, scoped to submitted packaging when material_returns.quantity_variant_id is set.
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
      AND (v_qty_variant_id IS NULL OR mpv.quantity_variant_id = v_qty_variant_id)
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
    RAISE EXCEPTION
      'Return request %: only % could be returned out of % — insufficient matching breakdown rows',
      p_return_id, v_qty - v_remaining, v_qty::TEXT || v_pkg_tag;
  END IF;

  UPDATE public.material_returns AS mr
     SET status       = 'Accepted',
         reviewed_at  = NOW(),
         review_notes = COALESCE(p_review_notes, 'Accepted by store'),
         reviewed_by  = auth.uid()
   WHERE mr.return_id = p_return_id;

  v_notes_proj :=
    'PROJECT OUT (Return Approved): ' || v_qty::TEXT || ' ' || COALESCE(v_metric, '') ||
    ' of ' || v_material_name || v_pkg_tag ||
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
    ' of ' || v_material_name || v_pkg_tag ||
    ' | total value = Rs.' || v_total_value::TEXT ||
    ' | condition=' || COALESCE(v_condition, 'N/A') ||
    ' | stock re-credited to original batches (LIFO)' ||
    ' | at=' || NOW()::TEXT;

  INSERT INTO public.material_movement_logs (
    material_id, movement_type, project_id, quantity,
    reference_type, reference_id, notes, created_by
  ) VALUES (
    v_material_id, 'Store In', v_project_id, v_qty,
    'Material Return', p_return_id, v_notes_store, auth.uid()
  );

  RETURN QUERY SELECT p_return_id, v_qty, v_total_value, v_breakdown;
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_material_return_request(BIGINT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
