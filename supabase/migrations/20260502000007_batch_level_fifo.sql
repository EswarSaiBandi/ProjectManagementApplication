-- ============================================================================
-- Batch-level FIFO.
--
-- Each add_stock_to_store call now creates a separate BATCH under its price
-- variant. FIFO consumes batches in arrival order (batch_date ASC, batch_id
-- ASC). A variant is just the price tier — it aggregates its batches.
--
-- Prereqs:
--   * variant + breakdown tables are empty (user truncated via cleanup SQL)
--   * run AFTER 20260502000006_auto_purchase_date_on_variant_create.sql
--
-- Scope:
--   1. New table: material_stock_batches
--   2. Drop obsolete columns from material_price_variants
--       (quantity_received, quantity_available, purchase_date,
--        invoice_number, bill_path, notes moved to batches)
--   3. Recreate allocation_variant_breakdown with a batch_id FK
--   4. Rewrite all 5 FIFO/LIFO RPCs against batches
--   5. Recreate views to aggregate from batches
-- ============================================================================

-- --- Safety: ensure we're starting from empty state -------------------------

TRUNCATE TABLE
  public.allocation_variant_breakdown,
  public.material_price_variants
  RESTART IDENTITY CASCADE;

-- --- Drop dependent views + functions (we recreate them below) --------------

DROP VIEW IF EXISTS public.material_stock_variants_admin      CASCADE;
DROP VIEW IF EXISTS public.active_price_variants_dropdown     CASCADE;
DROP VIEW IF EXISTS public.store_stock_by_material            CASCADE;
DROP VIEW IF EXISTS public.project_allocation_breakdown       CASCADE;

DROP FUNCTION IF EXISTS public.add_stock_to_store(BIGINT, NUMERIC, TEXT, TEXT, TEXT)            CASCADE;
DROP FUNCTION IF EXISTS public.allocate_material_fifo(BIGINT, BIGINT, NUMERIC)                   CASCADE;
DROP FUNCTION IF EXISTS public.record_material_usage(BIGINT, NUMERIC)                            CASCADE;
DROP FUNCTION IF EXISTS public.record_material_return(BIGINT, NUMERIC)                           CASCADE;
DROP FUNCTION IF EXISTS public.reduce_store_stock_lifo(BIGINT, NUMERIC, TEXT)                    CASCADE;

-- --- Reshape material_price_variants: drop per-batch columns ----------------

ALTER TABLE public.material_price_variants
  DROP COLUMN IF EXISTS quantity_received,
  DROP COLUMN IF EXISTS quantity_available,
  DROP COLUMN IF EXISTS purchase_date,
  DROP COLUMN IF EXISTS invoice_number,
  DROP COLUMN IF EXISTS bill_path,
  DROP COLUMN IF EXISTS notes;

-- Any remaining indexes that referenced purchase_date are now gone (dropped
-- with the column). Keep the active/price indexes.

-- --- Recreate allocation_variant_breakdown with batch_id --------------------

DROP TABLE IF EXISTS public.allocation_variant_breakdown CASCADE;

CREATE TABLE public.allocation_variant_breakdown (
  breakdown_id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  allocation_id  BIGINT NOT NULL REFERENCES public.material_allocations(allocation_id) ON DELETE CASCADE,
  batch_id       BIGINT NOT NULL,      -- FK added below after batches table exists
  variant_id     BIGINT NOT NULL REFERENCES public.material_price_variants(variant_id) ON DELETE RESTRICT,

  qty_allocated  NUMERIC(12,3) NOT NULL CHECK (qty_allocated > 0),
  unit_price     NUMERIC(12,2) NOT NULL CHECK (unit_price > 0),
  cost_allocated NUMERIC(14,2) GENERATED ALWAYS AS (qty_allocated * unit_price) STORED,

  qty_used       NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (qty_used >= 0),
  qty_returned   NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (qty_returned >= 0),

  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT check_usage_plus_returns_fits
    CHECK (qty_used + qty_returned <= qty_allocated)
);

CREATE INDEX idx_avb_allocation ON public.allocation_variant_breakdown(allocation_id);
CREATE INDEX idx_avb_variant    ON public.allocation_variant_breakdown(variant_id);
CREATE INDEX idx_avb_batch      ON public.allocation_variant_breakdown(batch_id);

ALTER TABLE public.allocation_variant_breakdown ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS avb_select_auth ON public.allocation_variant_breakdown;
CREATE POLICY avb_select_auth
ON public.allocation_variant_breakdown FOR SELECT
TO authenticated
USING (TRUE);

-- --- Table: material_stock_batches ------------------------------------------

CREATE TABLE public.material_stock_batches (
  batch_id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  variant_id         BIGINT NOT NULL REFERENCES public.material_price_variants(variant_id) ON DELETE CASCADE,

  batch_date         DATE   NOT NULL DEFAULT CURRENT_DATE,

  quantity_received  NUMERIC(12,3) NOT NULL CHECK (quantity_received > 0),
  quantity_available NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (quantity_available >= 0),

  invoice_number     TEXT,
  bill_path          TEXT,
  notes              TEXT,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by         UUID REFERENCES public.profiles(user_id),

  CONSTRAINT check_available_le_received CHECK (quantity_available <= quantity_received)
);

CREATE INDEX idx_msb_variant        ON public.material_stock_batches(variant_id);
CREATE INDEX idx_msb_variant_fifo   ON public.material_stock_batches(variant_id, batch_date ASC, batch_id ASC)
                                    WHERE quantity_available > 0;

-- Now that batches exists, attach the FK from breakdown.batch_id.
ALTER TABLE public.allocation_variant_breakdown
  ADD CONSTRAINT fk_avb_batch
  FOREIGN KEY (batch_id) REFERENCES public.material_stock_batches(batch_id)
  ON DELETE RESTRICT;

-- RLS: same pattern as variants (Admin+PM read; writes via RPCs).
ALTER TABLE public.material_stock_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS msb_select_admin_pm ON public.material_stock_batches;
CREATE POLICY msb_select_admin_pm
ON public.material_stock_batches FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = auth.uid()
      AND p.role IN ('Admin', 'ProjectManager')
  )
);

DROP POLICY IF EXISTS msb_write_admin ON public.material_stock_batches;
CREATE POLICY msb_write_admin
ON public.material_stock_batches FOR ALL
TO authenticated
USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.role = 'Admin'))
WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.role = 'Admin'));

-- ============================================================================
-- Function: add_stock_to_store  (Admin only)
-- Inserts a NEW BATCH under the variant. Batch lands at the tail of the
-- variant's FIFO queue (today's date, next batch_id).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.add_stock_to_store(
  p_variant_id     BIGINT,
  p_quantity       NUMERIC(12,3),
  p_bill_path      TEXT DEFAULT NULL,
  p_invoice_number TEXT DEFAULT NULL,
  p_notes          TEXT DEFAULT NULL
)
RETURNS TABLE (
  batch_id       BIGINT,
  variant_id     BIGINT,
  variant_name   TEXT,
  quantity_added NUMERIC(12,3),
  unit_price     NUMERIC(12,2),
  total_value    NUMERIC(14,2),
  batch_date     DATE,
  bill_path      TEXT
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
  v_batch_id      BIGINT;
  v_batch_date    DATE := CURRENT_DATE;
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

  INSERT INTO public.material_stock_batches (
    variant_id, batch_date, quantity_received, quantity_available,
    invoice_number, bill_path, notes, created_by
  ) VALUES (
    p_variant_id, v_batch_date, p_quantity, p_quantity,
    p_invoice_number, p_bill_path, p_notes, auth.uid()
  )
  RETURNING material_stock_batches.batch_id INTO v_batch_id;

  v_notes :=
    'STORE IN (new batch): ' || p_quantity::TEXT || ' ' || COALESCE(v_metric, '') ||
    ' of ' || v_material_name ||
    ' @ Rs.' || v_price::TEXT || '/unit' ||
    ' (variant="' || v_name || '", batch#=' || v_batch_id || ', batch_date=' || v_batch_date::TEXT || ')' ||
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
    'Manual Adjustment', v_batch_id,
    v_notes,
    auth.uid()
  );

  RETURN QUERY
  SELECT v_batch_id, p_variant_id, v_name, p_quantity, v_price,
         (p_quantity * v_price)::NUMERIC(14,2), v_batch_date, p_bill_path;
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_stock_to_store(BIGINT, NUMERIC, TEXT, TEXT, TEXT) TO authenticated;

-- ============================================================================
-- Function: allocate_material_fifo
-- FIFO across BATCHES (not variants). Oldest batch first — meaning the oldest
-- *physical arrival* under any variant, regardless of variant price tier.
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

  IF (
    SELECT COALESCE(SUM(b.quantity_available), 0)
      FROM public.material_stock_batches b
      JOIN public.material_price_variants v ON v.variant_id = b.variant_id
      WHERE v.material_id = p_material_id
  ) < p_required_qty THEN
    RAISE EXCEPTION 'Insufficient stock for material "%": need %, have %',
      v_material_name, p_required_qty,
      (SELECT COALESCE(SUM(b.quantity_available), 0)
         FROM public.material_stock_batches b
         JOIN public.material_price_variants v ON v.variant_id = b.variant_id
         WHERE v.material_id = p_material_id);
  END IF;

  INSERT INTO public.material_allocations (
    material_id, project_id, allocated_quantity, status, allocated_by
  ) VALUES (
    p_material_id, p_project_id, p_required_qty, 'Reserved', auth.uid()
  )
  RETURNING material_allocations.allocation_id INTO v_allocation_id;

  FOR r IN
    SELECT b.batch_id,
           b.variant_id,
           b.batch_date,
           v.variant_name,
           v.unit_price,
           b.quantity_available
      FROM public.material_stock_batches b
      JOIN public.material_price_variants v ON v.variant_id = b.variant_id
     WHERE v.material_id = p_material_id
       AND b.quantity_available > 0
     ORDER BY b.batch_date ASC, b.batch_id ASC       -- FIFO across batches
     FOR UPDATE OF b
  LOOP
    EXIT WHEN v_remaining <= 0;

    v_qty_to_alloc := LEAST(r.quantity_available, v_remaining);

    INSERT INTO public.allocation_variant_breakdown (
      allocation_id, batch_id, variant_id, qty_allocated, unit_price
    ) VALUES (
      v_allocation_id, r.batch_id, r.variant_id, v_qty_to_alloc, r.unit_price
    );

    UPDATE public.material_stock_batches
       SET quantity_available = quantity_available - v_qty_to_alloc
     WHERE material_stock_batches.batch_id = r.batch_id;

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
-- Function: record_material_usage
-- FIFO within allocation breakdown (by breakdown_id ASC — same order they
-- were pulled from store). No change to batch.quantity_available — stock
-- already left the store at allocation time.
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
           avb.batch_id,
           avb.variant_id,
           mpv.variant_name,
           avb.unit_price,
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
      'batch_id',     r.batch_id,
      'variant_id',   r.variant_id,
      'variant_name', r.variant_name,
      'qty',          v_use_qty,
      'unit_price',   r.unit_price,
      'cost',         v_use_qty * r.unit_price
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
-- Function: record_material_return  (LIFO)
-- Newest breakdown row first. Stock flows back to its specific BATCH, which
-- restores that batch's qty_available at the variant's original unit_price.
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
           avb.batch_id,
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

    UPDATE public.material_stock_batches
    SET quantity_available = quantity_available + v_return_qty
    WHERE material_stock_batches.batch_id = r.batch_id;

    v_breakdown := v_breakdown || jsonb_build_array(jsonb_build_object(
      'batch_id',     r.batch_id,
      'variant_id',   r.variant_id,
      'variant_name', r.variant_name,
      'qty',          v_return_qty,
      'unit_price',   r.unit_price,
      'value',        v_return_qty * r.unit_price
    ));
    v_lines := v_lines || (
      v_return_qty::TEXT || ' @ Rs.' || r.unit_price::TEXT ||
      ' (variant="' || r.variant_name || '", batch#=' || r.batch_id || ')' ||
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
-- Function: reduce_store_stock_lifo  (Admin only)
-- LIFO across BATCHES for damage / write-off / transfer-out.
-- Newest-physical-arrival first.
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

  IF (
    SELECT COALESCE(SUM(b.quantity_available), 0)
      FROM public.material_stock_batches b
      JOIN public.material_price_variants v ON v.variant_id = b.variant_id
      WHERE v.material_id = p_material_id
  ) < p_quantity THEN
    RAISE EXCEPTION 'Insufficient stock for "%": need %, have %',
      v_material_name, p_quantity,
      (SELECT COALESCE(SUM(b.quantity_available), 0)
         FROM public.material_stock_batches b
         JOIN public.material_price_variants v ON v.variant_id = b.variant_id
         WHERE v.material_id = p_material_id);
  END IF;

  FOR r IN
    SELECT b.batch_id, b.variant_id, b.batch_date,
           v.variant_name, v.unit_price, b.quantity_available
      FROM public.material_stock_batches b
      JOIN public.material_price_variants v ON v.variant_id = b.variant_id
     WHERE v.material_id = p_material_id
       AND b.quantity_available > 0
     ORDER BY b.batch_date DESC, b.batch_id DESC      -- LIFO across batches
     FOR UPDATE OF b
  LOOP
    EXIT WHEN v_remaining <= 0;

    v_reduce_qty := LEAST(r.quantity_available, v_remaining);

    UPDATE public.material_stock_batches
    SET quantity_available = quantity_available - v_reduce_qty
    WHERE material_stock_batches.batch_id = r.batch_id;

    v_breakdown := v_breakdown || jsonb_build_array(jsonb_build_object(
      'batch_id',     r.batch_id,
      'variant_id',   r.variant_id,
      'variant_name', r.variant_name,
      'batch_date',   r.batch_date,
      'qty',          v_reduce_qty,
      'unit_price',   r.unit_price,
      'value',        v_reduce_qty * r.unit_price
    ));
    v_lines := v_lines || (
      v_reduce_qty::TEXT || ' @ Rs.' || r.unit_price::TEXT ||
      ' (variant="' || r.variant_name || '", batch#=' || r.batch_id ||
      ', batch_date=' || r.batch_date::TEXT || ')' ||
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
-- Views recreated against batches
-- ============================================================================

-- Variant-level dropdown (for Add Stock UI). Shows ALL active variants even
-- with zero stock (admin may want to add a first batch).
CREATE OR REPLACE VIEW public.active_price_variants_dropdown AS
SELECT
  v.variant_id,
  v.material_id,
  m.material_name,
  v.variant_name,
  v.unit_price,
  v.variant_name || ' (Rs. ' || v.unit_price::TEXT || ')' AS display_label,
  COALESCE(SUM(b.quantity_available), 0) AS quantity_available
FROM public.material_price_variants v
JOIN public.materials_master m ON m.material_id = v.material_id
LEFT JOIN public.material_stock_batches b ON b.variant_id = v.variant_id
WHERE v.is_active = TRUE
GROUP BY v.variant_id, v.material_id, m.material_name, v.variant_name, v.unit_price;

-- Per-variant summary for admin page.
CREATE OR REPLACE VIEW public.material_stock_variants_admin AS
SELECT
  m.material_id,
  m.material_name,
  m.metric,
  v.variant_id,
  v.variant_name,
  v.unit_price,
  v.is_active,
  COUNT(b.batch_id)                          AS batch_count,
  MIN(b.batch_date)                          AS earliest_batch_date,
  MAX(b.batch_date)                          AS latest_batch_date,
  COALESCE(SUM(b.quantity_received), 0)      AS quantity_received,
  COALESCE(SUM(b.quantity_available), 0)     AS quantity_available,
  (COALESCE(SUM(b.quantity_available), 0) * v.unit_price)::NUMERIC(14,2) AS stock_value,
  v.created_at,
  v.created_by
FROM public.materials_master m
JOIN public.material_price_variants v ON v.material_id = m.material_id
LEFT JOIN public.material_stock_batches b ON b.variant_id = v.variant_id
GROUP BY m.material_id, m.material_name, m.metric,
         v.variant_id, v.variant_name, v.unit_price, v.is_active,
         v.created_at, v.created_by;

-- Per-batch detail for admin page (expandable under each variant).
CREATE OR REPLACE VIEW public.material_stock_batches_admin AS
SELECT
  m.material_id,
  m.material_name,
  m.metric,
  v.variant_id,
  v.variant_name,
  v.unit_price,
  v.is_active                                 AS variant_is_active,
  b.batch_id,
  b.batch_date,
  b.quantity_received,
  b.quantity_available,
  (b.quantity_received - b.quantity_available) AS quantity_outflow,
  (b.quantity_available * v.unit_price)::NUMERIC(14,2) AS stock_value,
  b.invoice_number,
  b.bill_path,
  b.notes,
  b.created_at,
  b.created_by
FROM public.materials_master m
JOIN public.material_price_variants v ON v.material_id = m.material_id
JOIN public.material_stock_batches b  ON b.variant_id  = v.variant_id;

-- Per-material aggregate for store Inventory tab.
CREATE OR REPLACE VIEW public.store_stock_by_material AS
SELECT
  m.material_id,
  m.material_name,
  m.metric,
  m.is_active                                 AS material_is_active,
  COUNT(DISTINCT v.variant_id)                AS total_variants,
  COUNT(DISTINCT v.variant_id) FILTER (WHERE v.is_active) AS active_variants,
  COUNT(b.batch_id)                           AS total_batches,
  COALESCE(SUM(b.quantity_received), 0)       AS total_received,
  COALESCE(SUM(b.quantity_available), 0)      AS total_available,
  COALESCE(SUM(b.quantity_available * v.unit_price), 0)::NUMERIC(14,2) AS total_stock_value,
  MIN(v.unit_price) FILTER (WHERE b.quantity_available > 0) AS min_price_in_stock,
  MAX(v.unit_price) FILTER (WHERE b.quantity_available > 0) AS max_price_in_stock
FROM public.materials_master m
LEFT JOIN public.material_price_variants v ON v.material_id = m.material_id
LEFT JOIN public.material_stock_batches  b ON b.variant_id  = v.variant_id
GROUP BY m.material_id, m.material_name, m.metric, m.is_active;

-- Per-project allocation breakdown (batch-aware).
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
  avb.batch_id,
  b.batch_date,
  avb.unit_price,
  avb.qty_allocated,
  avb.qty_used,
  avb.qty_returned,
  (avb.qty_allocated - avb.qty_used - avb.qty_returned) AS qty_remaining,
  avb.cost_allocated,
  (avb.qty_used     * avb.unit_price)::NUMERIC(14,2) AS cost_used,
  (avb.qty_returned * avb.unit_price)::NUMERIC(14,2) AS value_returned,
  ((avb.qty_allocated - avb.qty_used - avb.qty_returned) * avb.unit_price)::NUMERIC(14,2) AS value_remaining
FROM public.material_allocations ma
JOIN public.allocation_variant_breakdown avb ON avb.allocation_id = ma.allocation_id
JOIN public.material_price_variants v        ON v.variant_id      = avb.variant_id
JOIN public.material_stock_batches b         ON b.batch_id        = avb.batch_id
JOIN public.materials_master m                ON m.material_id     = ma.material_id
JOIN public.projects p                        ON p.project_id      = ma.project_id;

-- Grants
GRANT SELECT ON public.active_price_variants_dropdown  TO authenticated;
GRANT SELECT ON public.material_stock_variants_admin   TO authenticated;
GRANT SELECT ON public.material_stock_batches_admin    TO authenticated;
GRANT SELECT ON public.store_stock_by_material         TO authenticated;
GRANT SELECT ON public.project_allocation_breakdown    TO authenticated;

NOTIFY pgrst, 'reload schema';
