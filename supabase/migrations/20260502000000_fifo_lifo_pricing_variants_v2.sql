-- ============================================================================
-- Material Price Variants (FIFO/LIFO) — v2
--
-- Supersedes the broken draft 20260501000000_fifo_lifo_pricing_variants.sql
-- (missing purchase_date column; disallowed movement_type/reference_type values).
--
-- Rules:
--   * FIFO (oldest purchase_date) for allocation and on-site usage.
--   * LIFO (newest allocation breakdown row) for returns.
--   * LIFO across variants for direct store-level reductions (damage / write-off).
--   * No averages. Every breakdown row carries its exact unit_price.
--   * Admin-only: create variant, toggle active, add stock, upload bill.
--   * Variants cannot be edited — only paused/resumed via is_active.
--   * Deactivation blocks NEW stock entries only. Existing stock remains
--     allocatable via FIFO until depleted.
--   * For one material, two ACTIVE variants cannot share the same unit_price
--     (same price == same variant; top up the existing one instead).
-- ============================================================================

-- Clean up anything the broken draft may have left behind.
DROP VIEW IF EXISTS public.material_stock_variants_admin CASCADE;
DROP VIEW IF EXISTS public.active_price_variants_dropdown CASCADE;

DROP FUNCTION IF EXISTS public.allocate_material_fifo(BIGINT, BIGINT, NUMERIC) CASCADE;
DROP FUNCTION IF EXISTS public.record_material_usage(BIGINT, NUMERIC) CASCADE;
DROP FUNCTION IF EXISTS public.record_material_return(BIGINT, NUMERIC) CASCADE;
DROP FUNCTION IF EXISTS public.create_price_variant(BIGINT, TEXT, NUMERIC, BIGINT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.create_price_variant(BIGINT, TEXT, NUMERIC, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.toggle_price_variant_status(BIGINT, BOOLEAN) CASCADE;
DROP FUNCTION IF EXISTS public.add_stock_to_store(BIGINT, NUMERIC, TEXT, TEXT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.reduce_store_stock_lifo(BIGINT, NUMERIC, TEXT) CASCADE;

DROP TABLE IF EXISTS public.allocation_variant_breakdown CASCADE;
DROP TABLE IF EXISTS public.material_price_variants CASCADE;

-- ============================================================================
-- Table: material_price_variants
-- One row per (material, price tier). Stock_available tracked here.
-- ============================================================================

CREATE TABLE public.material_price_variants (
  variant_id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  material_id       BIGINT NOT NULL REFERENCES public.materials_master(material_id) ON DELETE CASCADE,

  variant_name      TEXT NOT NULL,
  unit_price        NUMERIC(12,2) NOT NULL CHECK (unit_price > 0),

  purchase_date     DATE NOT NULL DEFAULT CURRENT_DATE,

  quantity_received NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (quantity_received >= 0),
  quantity_available NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (quantity_available >= 0),

  invoice_number    TEXT,
  bill_path         TEXT,
  notes             TEXT,

  is_active         BOOLEAN NOT NULL DEFAULT TRUE,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by        UUID REFERENCES public.profiles(user_id),

  CONSTRAINT unique_variant_name_per_material UNIQUE (material_id, variant_name)
);

CREATE INDEX idx_mpv_material          ON public.material_price_variants(material_id);
CREATE INDEX idx_mpv_fifo              ON public.material_price_variants(material_id, purchase_date ASC, variant_id ASC);
CREATE INDEX idx_mpv_lifo              ON public.material_price_variants(material_id, purchase_date DESC, variant_id DESC);
CREATE INDEX idx_mpv_active            ON public.material_price_variants(material_id) WHERE is_active = TRUE;

-- Enforce: for one material, no two ACTIVE variants can share the same price.
CREATE UNIQUE INDEX unique_active_price_per_material
  ON public.material_price_variants(material_id, unit_price)
  WHERE is_active = TRUE;

-- ============================================================================
-- Table: allocation_variant_breakdown
-- Exact FIFO slice of variants pulled into a single allocation.
-- Usage (FIFO) and returns (LIFO) mutate qty_used / qty_returned here.
-- ============================================================================

CREATE TABLE public.allocation_variant_breakdown (
  breakdown_id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  allocation_id  BIGINT NOT NULL REFERENCES public.material_allocations(allocation_id) ON DELETE CASCADE,
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

-- ============================================================================
-- Views
-- ============================================================================

-- Dropdown for "add stock" screen: active variants with name + price display.
CREATE OR REPLACE VIEW public.active_price_variants_dropdown AS
SELECT
  v.variant_id,
  v.material_id,
  m.material_name,
  v.variant_name,
  v.unit_price,
  v.variant_name || ' (Rs. ' || v.unit_price::TEXT || ')' AS display_label,
  v.purchase_date,
  v.quantity_available
FROM public.material_price_variants v
JOIN public.materials_master m ON m.material_id = v.material_id
WHERE v.is_active = TRUE
ORDER BY v.material_id, v.purchase_date ASC, v.variant_id ASC;

-- Admin-facing detailed stock view: exact per-variant inventory + value.
CREATE OR REPLACE VIEW public.material_stock_variants_admin AS
SELECT
  m.material_id,
  m.material_name,
  v.variant_id,
  v.variant_name,
  v.purchase_date,
  v.unit_price,
  v.quantity_received,
  v.quantity_available,
  v.quantity_received - v.quantity_available AS quantity_outflow,
  v.quantity_available * v.unit_price        AS stock_value,
  v.is_active,
  v.invoice_number,
  v.bill_path,
  v.created_at,
  v.created_by
FROM public.materials_master m
JOIN public.material_price_variants v ON v.material_id = m.material_id
ORDER BY m.material_id, v.purchase_date ASC, v.variant_id ASC;

-- ============================================================================
-- Helper: role check (internal)
-- ============================================================================

CREATE OR REPLACE FUNCTION public._assert_admin()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE user_id = auth.uid();
  IF v_role IS DISTINCT FROM 'Admin' THEN
    RAISE EXCEPTION 'Only Admin can perform this action' USING ERRCODE = '42501';
  END IF;
END;
$$;

-- ============================================================================
-- Function: create_price_variant  (Admin only)
-- Rejects if an ACTIVE variant at the same unit_price already exists for the
-- material. Admin should top up the existing variant instead.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_price_variant(
  p_material_id  BIGINT,
  p_variant_name TEXT,
  p_unit_price   NUMERIC(12,2),
  p_purchase_date DATE DEFAULT NULL,
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
    COALESCE(p_purchase_date, CURRENT_DATE),
    p_notes,
    auth.uid()
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_price_variant(BIGINT, TEXT, NUMERIC, DATE, TEXT) TO authenticated;

-- ============================================================================
-- Function: toggle_price_variant_status  (Admin only)
-- Activate/pause a variant. Pause = no new stock entries. Existing stock
-- remains allocatable via FIFO until depleted.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.toggle_price_variant_status(
  p_variant_id BIGINT,
  p_is_active  BOOLEAN
)
RETURNS public.material_price_variants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row         public.material_price_variants;
  v_material_id BIGINT;
  v_unit_price  NUMERIC(12,2);
BEGIN
  PERFORM public._assert_admin();

  SELECT material_id, unit_price INTO v_material_id, v_unit_price
  FROM public.material_price_variants WHERE variant_id = p_variant_id;

  IF v_material_id IS NULL THEN
    RAISE EXCEPTION 'Variant % not found', p_variant_id;
  END IF;

  -- Re-activation must not collide with another active variant at the same price.
  IF p_is_active = TRUE AND EXISTS (
    SELECT 1 FROM public.material_price_variants
    WHERE material_id = v_material_id
      AND unit_price  = v_unit_price
      AND is_active   = TRUE
      AND variant_id <> p_variant_id
  ) THEN
    RAISE EXCEPTION 'Another active variant already exists at price % for material %. Deactivate it first.',
      v_unit_price, v_material_id;
  END IF;

  UPDATE public.material_price_variants
  SET is_active = p_is_active
  WHERE variant_id = p_variant_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.toggle_price_variant_status(BIGINT, BOOLEAN) TO authenticated;

-- ============================================================================
-- Function: add_stock_to_store  (Admin only)
-- Tops up an ACTIVE variant. Variant keeps its original purchase_date for FIFO.
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
  v_material_id BIGINT;
  v_name        TEXT;
  v_price       NUMERIC(12,2);
  v_active      BOOLEAN;
BEGIN
  PERFORM public._assert_admin();

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'quantity must be > 0';
  END IF;

  SELECT mpv.material_id, mpv.variant_name, mpv.unit_price, mpv.is_active
    INTO v_material_id, v_name, v_price, v_active
  FROM public.material_price_variants mpv
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

  INSERT INTO public.material_movement_logs (
    material_id, movement_type, project_id, quantity,
    reference_type, reference_id, notes, created_by
  ) VALUES (
    v_material_id, 'Store In', NULL, p_quantity,
    'Manual Adjustment', p_variant_id,
    'Purchase | variant=' || v_name
      || ' | price=' || v_price::TEXT
      || ' | invoice=' || COALESCE(p_invoice_number, 'N/A')
      || ' | bill=' || COALESCE(p_bill_path, 'N/A'),
    auth.uid()
  );

  RETURN QUERY
  SELECT p_variant_id, v_name, p_quantity, v_price, (p_quantity * v_price)::NUMERIC(14,2), p_bill_path;
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_stock_to_store(BIGINT, NUMERIC, TEXT, TEXT, TEXT) TO authenticated;

-- ============================================================================
-- Function: allocate_material_fifo
-- Consumes stock oldest-first across ALL variants (active OR paused) with
-- quantity_available > 0. Paused variants are still allocatable — pause only
-- blocks new store-in.
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
  v_qty_to_alloc  NUMERIC(12,3);
  r RECORD;
BEGIN
  IF p_required_qty IS NULL OR p_required_qty <= 0 THEN
    RAISE EXCEPTION 'required_qty must be > 0';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.materials_master WHERE material_id = p_material_id) THEN
    RAISE EXCEPTION 'Material % does not exist', p_material_id;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.projects WHERE project_id = p_project_id) THEN
    RAISE EXCEPTION 'Project % does not exist', p_project_id;
  END IF;

  IF (SELECT COALESCE(SUM(quantity_available), 0)
        FROM public.material_price_variants
        WHERE material_id = p_material_id) < p_required_qty THEN
    RAISE EXCEPTION 'Insufficient stock for material % (need %, have %)',
      p_material_id,
      p_required_qty,
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
    SELECT mpv.variant_id, mpv.unit_price, mpv.quantity_available, mpv.purchase_date
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
      'purchase_date', r.purchase_date,
      'qty',           v_qty_to_alloc,
      'unit_price',    r.unit_price,
      'cost',          v_qty_to_alloc * r.unit_price
    ));

    v_total_cost := v_total_cost + (v_qty_to_alloc * r.unit_price);
    v_remaining  := v_remaining  - v_qty_to_alloc;
  END LOOP;

  INSERT INTO public.material_movement_logs (
    material_id, movement_type, project_id, quantity,
    reference_type, reference_id, notes, created_by
  ) VALUES (
    p_material_id, 'Project In', p_project_id, p_required_qty,
    'Material Request', v_allocation_id,
    'FIFO allocation | cost=' || v_total_cost::TEXT,
    auth.uid()
  );

  RETURN QUERY SELECT v_allocation_id, p_required_qty, v_total_cost, v_breakdown;
END;
$$;

GRANT EXECUTE ON FUNCTION public.allocate_material_fifo(BIGINT, BIGINT, NUMERIC) TO authenticated;

-- ============================================================================
-- Function: record_material_usage
-- User enters "X used". We consume FIFO against allocation_variant_breakdown
-- (oldest breakdown row first). Returns total cost_of_usage.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.record_material_usage(
  p_allocation_id BIGINT,
  p_qty_used      NUMERIC(12,3)
)
RETURNS TABLE (
  allocation_id BIGINT,
  total_used    NUMERIC(12,3),
  cost_of_usage NUMERIC(14,2)
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_material_id BIGINT;
  v_project_id  BIGINT;
  v_remaining   NUMERIC(12,3) := p_qty_used;
  v_total_cost  NUMERIC(14,2) := 0;
  v_use_qty     NUMERIC(12,3);
  r RECORD;
BEGIN
  IF p_qty_used IS NULL OR p_qty_used <= 0 THEN
    RAISE EXCEPTION 'qty_used must be > 0';
  END IF;

  SELECT material_id, project_id INTO v_material_id, v_project_id
  FROM public.material_allocations WHERE allocation_id = p_allocation_id;

  IF v_material_id IS NULL THEN
    RAISE EXCEPTION 'Allocation % not found', p_allocation_id;
  END IF;

  FOR r IN
    SELECT breakdown_id,
           unit_price,
           qty_allocated - qty_used - qty_returned AS available
    FROM public.allocation_variant_breakdown
    WHERE allocation_id = p_allocation_id
    ORDER BY breakdown_id ASC   -- FIFO within allocation
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;
    CONTINUE WHEN r.available <= 0;

    v_use_qty := LEAST(r.available, v_remaining);

    UPDATE public.allocation_variant_breakdown
    SET qty_used = qty_used + v_use_qty
    WHERE allocation_variant_breakdown.breakdown_id = r.breakdown_id;

    v_total_cost := v_total_cost + (v_use_qty * r.unit_price);
    v_remaining  := v_remaining  - v_use_qty;
  END LOOP;

  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'Cannot record usage of %: only % available on this allocation',
      p_qty_used, p_qty_used - v_remaining;
  END IF;

  INSERT INTO public.material_movement_logs (
    material_id, movement_type, project_id, quantity,
    reference_type, reference_id, notes, created_by
  ) VALUES (
    v_material_id, 'Project Out', v_project_id, p_qty_used,
    'Material Request', p_allocation_id,
    'On-site usage | cost=' || v_total_cost::TEXT,
    auth.uid()
  );

  RETURN QUERY SELECT p_allocation_id, p_qty_used, v_total_cost;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_material_usage(BIGINT, NUMERIC) TO authenticated;

-- ============================================================================
-- Function: record_material_return
-- LIFO return against allocation_variant_breakdown (newest breakdown row
-- first). Stock flows back to that variant's quantity_available at the
-- variant's original unit_price.
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
  v_material_id BIGINT;
  v_project_id  BIGINT;
  v_remaining   NUMERIC(12,3) := p_qty_returned;
  v_total_value NUMERIC(14,2) := 0;
  v_breakdown   JSONB         := '[]'::JSONB;
  v_return_qty  NUMERIC(12,3);
  r RECORD;
BEGIN
  IF p_qty_returned IS NULL OR p_qty_returned <= 0 THEN
    RAISE EXCEPTION 'qty_returned must be > 0';
  END IF;

  SELECT material_id, project_id INTO v_material_id, v_project_id
  FROM public.material_allocations WHERE allocation_id = p_allocation_id;

  IF v_material_id IS NULL THEN
    RAISE EXCEPTION 'Allocation % not found', p_allocation_id;
  END IF;

  FOR r IN
    SELECT breakdown_id,
           variant_id,
           unit_price,
           qty_allocated - qty_used - qty_returned AS available
    FROM public.allocation_variant_breakdown
    WHERE allocation_id = p_allocation_id
    ORDER BY breakdown_id DESC   -- LIFO
    FOR UPDATE
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
      'variant_id', r.variant_id,
      'qty',        v_return_qty,
      'unit_price', r.unit_price,
      'value',      v_return_qty * r.unit_price
    ));

    v_total_value := v_total_value + (v_return_qty * r.unit_price);
    v_remaining   := v_remaining   - v_return_qty;
  END LOOP;

  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'Cannot return %: only % returnable on this allocation',
      p_qty_returned, p_qty_returned - v_remaining;
  END IF;

  INSERT INTO public.material_movement_logs (
    material_id, movement_type, project_id, quantity,
    reference_type, reference_id, notes, created_by
  ) VALUES (
    v_material_id, 'Return to Store', v_project_id, p_qty_returned,
    'Material Return', p_allocation_id,
    'LIFO return | value=' || v_total_value::TEXT,
    auth.uid()
  );

  RETURN QUERY SELECT p_allocation_id, p_qty_returned, v_total_value, v_breakdown;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_material_return(BIGINT, NUMERIC) TO authenticated;

-- ============================================================================
-- Function: reduce_store_stock_lifo  (Admin only)
-- Direct store-level reduction (damage / write-off / transfer-out).
-- Consumes newest-first across all variants (active or paused).
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
  v_remaining   NUMERIC(12,3) := p_quantity;
  v_total_value NUMERIC(14,2) := 0;
  v_breakdown   JSONB         := '[]'::JSONB;
  v_reduce_qty  NUMERIC(12,3);
  r RECORD;
BEGIN
  PERFORM public._assert_admin();

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'quantity must be > 0';
  END IF;

  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'reason is required for store-level reduction';
  END IF;

  IF (SELECT COALESCE(SUM(quantity_available), 0)
        FROM public.material_price_variants
        WHERE material_id = p_material_id) < p_quantity THEN
    RAISE EXCEPTION 'Insufficient stock for material % (need %, have %)',
      p_material_id, p_quantity,
      (SELECT COALESCE(SUM(quantity_available), 0)
         FROM public.material_price_variants WHERE material_id = p_material_id);
  END IF;

  FOR r IN
    SELECT mpv.variant_id, mpv.unit_price, mpv.quantity_available, mpv.purchase_date
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
      'purchase_date', r.purchase_date,
      'qty',           v_reduce_qty,
      'unit_price',    r.unit_price,
      'value',         v_reduce_qty * r.unit_price
    ));

    v_total_value := v_total_value + (v_reduce_qty * r.unit_price);
    v_remaining   := v_remaining   - v_reduce_qty;
  END LOOP;

  INSERT INTO public.material_movement_logs (
    material_id, movement_type, project_id, quantity,
    reference_type, reference_id, notes, created_by
  ) VALUES (
    p_material_id, 'Store Out', NULL, p_quantity,
    'Manual Adjustment', NULL,
    'LIFO store reduction | reason=' || p_reason || ' | value=' || v_total_value::TEXT,
    auth.uid()
  );

  RETURN QUERY SELECT p_quantity, v_total_value, v_breakdown;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reduce_store_stock_lifo(BIGINT, NUMERIC, TEXT) TO authenticated;

-- ============================================================================
-- RLS
-- ============================================================================

ALTER TABLE public.material_price_variants     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.allocation_variant_breakdown ENABLE ROW LEVEL SECURITY;

-- Variants: Admin + PM can read; only Admin can write (write paths go through
-- SECURITY DEFINER RPCs anyway).
DROP POLICY IF EXISTS mpv_select_admin_pm ON public.material_price_variants;
CREATE POLICY mpv_select_admin_pm
ON public.material_price_variants FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = auth.uid()
      AND p.role IN ('Admin', 'ProjectManager')
  )
);

DROP POLICY IF EXISTS mpv_write_admin ON public.material_price_variants;
CREATE POLICY mpv_write_admin
ON public.material_price_variants FOR ALL
TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.role = 'Admin')
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.role = 'Admin')
);

-- Breakdown: any authenticated user can read (needed for project costing UI);
-- writes only via SECURITY DEFINER RPCs.
DROP POLICY IF EXISTS avb_select_auth ON public.allocation_variant_breakdown;
CREATE POLICY avb_select_auth
ON public.allocation_variant_breakdown FOR SELECT
TO authenticated
USING (TRUE);

-- ============================================================================
-- Storage bucket: material-invoices
-- ============================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('material-invoices', 'material-invoices', FALSE)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS material_invoices_admin_write ON storage.objects;
CREATE POLICY material_invoices_admin_write
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'material-invoices'
  AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.role = 'Admin')
);

DROP POLICY IF EXISTS material_invoices_admin_update ON storage.objects;
CREATE POLICY material_invoices_admin_update
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'material-invoices'
  AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.role = 'Admin')
)
WITH CHECK (
  bucket_id = 'material-invoices'
  AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.role = 'Admin')
);

DROP POLICY IF EXISTS material_invoices_admin_delete ON storage.objects;
CREATE POLICY material_invoices_admin_delete
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'material-invoices'
  AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.role = 'Admin')
);

DROP POLICY IF EXISTS material_invoices_admin_pm_read ON storage.objects;
CREATE POLICY material_invoices_admin_pm_read
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'material-invoices'
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = auth.uid() AND p.role IN ('Admin', 'ProjectManager')
  )
);

-- ============================================================================
-- Grants for views
-- ============================================================================

GRANT SELECT ON public.active_price_variants_dropdown TO authenticated;
GRANT SELECT ON public.material_stock_variants_admin  TO authenticated;

-- ============================================================================
-- Reload PostgREST schema cache
-- ============================================================================

NOTIFY pgrst, 'reload schema';
