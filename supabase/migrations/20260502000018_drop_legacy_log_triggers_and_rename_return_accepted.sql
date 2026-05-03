-- ============================================================================
-- Fix duplicate project-level logs + rename return-acceptance event.
--
-- 1. Drop two legacy triggers from 20260208210000 that were the source of
--    duplicate entries on the project's Material Movements tab:
--      * trg_update_inventory_on_fulfillment (on material_requests)
--          → inserted 'Store Out' when status flipped to 'Fulfilled'.
--            Our new allocate_material_fifo RPC already writes the single
--            'Project In' entry.
--      * trg_handle_return_to_store (on material_returns)
--          → inserted 'Return to Store' when status flipped to 'Accepted'
--            AND wrote to the now-deprecated store_inventory table.
--            Our approve_material_return_request RPC handles everything.
--
-- 2. Rename the return-acceptance movement_type from 'Return Accepted' to
--    'Project Out (Return Approved)' per user request (makes it read as a
--    clean Project Out event at project level).
--
-- 3. Backfill existing 'Return Accepted' rows to the new label.
--
-- 4. Clean up duplicate rows created before the triggers were dropped.
--
-- Run AFTER 20260502000017_whole_unit_fifo_allocation.sql.
-- ============================================================================

-- --- 1. Drop the legacy triggers ---------------------------------------------

DROP TRIGGER IF EXISTS trg_update_inventory_on_fulfillment ON public.material_requests;
DROP TRIGGER IF EXISTS trg_handle_return_to_store          ON public.material_returns;

-- The functions can stay (in case anything else references them) or be
-- dropped. Safer to drop since they write to deprecated tables.
DROP FUNCTION IF EXISTS public.update_store_inventory_on_fulfillment() CASCADE;
DROP FUNCTION IF EXISTS public.handle_material_return_to_store()       CASCADE;

-- --- 2. Widen movement_type CHECK to include the new label ------------------

ALTER TABLE public.material_movement_logs
  DROP CONSTRAINT IF EXISTS material_movement_logs_movement_type_check;

ALTER TABLE public.material_movement_logs
  ADD CONSTRAINT material_movement_logs_movement_type_check
  CHECK (movement_type IN (
    'Store In', 'Store Out', 'Project In',
    'Return to Store', 'Local Procurement',
    'Stock Used', 'Stock Used Reverted',
    'Request Raised', 'Request Cancelled', 'Request Rejected',
    'Return Submitted', 'Return Accepted',
    'Project Out (Return Approved)',
    'Return Rejected', 'Return Cancelled'
  ));

-- --- 3. Backfill existing acceptance rows to the new label -------------------

UPDATE public.material_movement_logs
   SET movement_type = 'Project Out (Return Approved)'
 WHERE movement_type = 'Return Accepted';

-- Now drop 'Return Accepted' from CHECK (no rows use it anymore).
ALTER TABLE public.material_movement_logs
  DROP CONSTRAINT material_movement_logs_movement_type_check;

ALTER TABLE public.material_movement_logs
  ADD CONSTRAINT material_movement_logs_movement_type_check
  CHECK (movement_type IN (
    'Store In', 'Store Out', 'Project In',
    'Return to Store', 'Local Procurement',
    'Stock Used', 'Stock Used Reverted',
    'Request Raised', 'Request Cancelled', 'Request Rejected',
    'Return Submitted', 'Project Out (Return Approved)',
    'Return Rejected', 'Return Cancelled'
  ));

-- --- 4. Delete duplicate rows inserted by the old triggers -------------------

-- The old fulfillment trigger inserted:
--   movement_type = 'Store Out'
--   reference_type = 'Material Request'
--   project_id IS NOT NULL           (trigger always set project_id)
--   notes LIKE 'Fulfilled request: %'
-- These are the spurious rows that coexist with our Project In logs.
DELETE FROM public.material_movement_logs
 WHERE movement_type  = 'Store Out'
   AND reference_type = 'Material Request'
   AND project_id IS NOT NULL
   AND notes LIKE 'Fulfilled request:%';

-- The old return trigger inserted:
--   movement_type  = 'Return to Store'
--   reference_type = 'Material Return'
--   notes LIKE 'Accepted return: %'
-- These coexist with our Project Out (Return Approved) logs.
DELETE FROM public.material_movement_logs
 WHERE movement_type  = 'Return to Store'
   AND reference_type = 'Material Return'
   AND notes LIKE 'Accepted return:%';

-- --- 5. Update approve_material_return_request to use the new label ---------

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
  v_notes           TEXT;
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
    SELECT avb.breakdown_id,
           avb.allocation_id,
           avb.variant_id,
           avb.batch_id,
           mpv.variant_name,
           avb.unit_price,
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
      'allocation_id', r.allocation_id,
      'breakdown_id',  r.breakdown_id,
      'batch_id',      r.batch_id,
      'variant_id',    r.variant_id,
      'variant_name',  r.variant_name,
      'qty',           v_return_qty,
      'unit_price',    r.unit_price,
      'value',         v_return_qty * r.unit_price
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
    RAISE EXCEPTION 'Return request %: only % could be returned out of % (insufficient returnable breakdown rows)',
      p_return_id, v_qty - v_remaining, v_qty;
  END IF;

  UPDATE public.material_returns AS mr
     SET status       = 'Accepted',
         reviewed_at  = NOW(),
         review_notes = COALESCE(p_review_notes, 'Accepted by store'),
         reviewed_by  = auth.uid()
   WHERE mr.return_id = p_return_id;

  v_notes :=
    'PROJECT OUT (Return Approved): ' || v_qty::TEXT || ' ' || COALESCE(v_metric, '') ||
    ' of ' || v_material_name ||
    ' returned from project "' || v_project_name || '" (#' || v_project_id || ') to store' ||
    ' | return#=' || v_return_number ||
    ' | LIFO breakdown: [' || array_to_string(v_lines, '; ') || ']' ||
    ' | total value = Rs.' || v_total_value::TEXT ||
    ' | condition=' || COALESCE(v_condition, 'N/A') ||
    CASE WHEN p_review_notes IS NOT NULL AND btrim(p_review_notes) <> ''
         THEN ' | review_note="' || p_review_notes || '"' ELSE '' END ||
    ' | stock re-credited to original batches' ||
    ' | at=' || NOW()::TEXT;

  INSERT INTO public.material_movement_logs (
    material_id, movement_type, project_id, quantity,
    reference_type, reference_id, notes, created_by
  ) VALUES (
    v_material_id, 'Project Out (Return Approved)', v_project_id, v_qty,
    'Material Return', p_return_id, v_notes, auth.uid()
  );

  RETURN QUERY SELECT p_return_id, v_qty, v_total_value, v_breakdown;
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_material_return_request(BIGINT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
