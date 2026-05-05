-- ============================================================================
-- Enforce: every quantity entered must be a multiple of 0.25
--   i.e. allowed 0, 0.25, 0.50, 0.75, 1.00, 1.25, …
--        rejected 0.1, 0.2, 0.3, 0.4, …
--
-- Strategy:
--   1. Helper fn public.is_quarter_multiple(NUMERIC) — single source of truth.
--   2. RPC guards on the hot paths (better error messages).
--   3. CHECK NOT VALID on every stored quantity column — backstop, doesn't
--      break any historical row (NOT VALID = enforced only on new/updated rows).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Helper
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_quarter_multiple(n NUMERIC)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT n IS NULL OR (n * 4) = TRUNC(n * 4);
$$;

COMMENT ON FUNCTION public.is_quarter_multiple(NUMERIC)
  IS 'TRUE when n is a multiple of 0.25 (0, 0.25, 0.5, 0.75, 1.0, ...). NULL-safe.';

-- Assertion helper — raises a friendly error before the constraint does.
CREATE OR REPLACE FUNCTION public._assert_quarter_multiple(n NUMERIC, col_name TEXT)
RETURNS VOID
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF NOT public.is_quarter_multiple(n) THEN
    RAISE EXCEPTION
      '% must be a multiple of 0.25 (got %). Allowed: 0.25, 0.50, 0.75, 1.00, ...',
      col_name, n;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. CHECK NOT VALID on stored quantity columns
--    NOT VALID = constraint is enforced on new rows only; existing rows are
--    left alone. Run VALIDATE CONSTRAINT manually if you want to back-check.
-- ---------------------------------------------------------------------------

-- material_stock_batches
ALTER TABLE public.material_stock_batches
  DROP CONSTRAINT IF EXISTS msb_qty_received_quarter,
  DROP CONSTRAINT IF EXISTS msb_qty_available_quarter,
  DROP CONSTRAINT IF EXISTS msb_number_of_units_quarter;

ALTER TABLE public.material_stock_batches
  ADD CONSTRAINT msb_qty_received_quarter
    CHECK (public.is_quarter_multiple(quantity_received))  NOT VALID,
  ADD CONSTRAINT msb_qty_available_quarter
    CHECK (public.is_quarter_multiple(quantity_available)) NOT VALID,
  ADD CONSTRAINT msb_number_of_units_quarter
    CHECK (public.is_quarter_multiple(number_of_units))    NOT VALID;

-- allocation_variant_breakdown
ALTER TABLE public.allocation_variant_breakdown
  DROP CONSTRAINT IF EXISTS avb_qty_allocated_quarter,
  DROP CONSTRAINT IF EXISTS avb_qty_used_quarter,
  DROP CONSTRAINT IF EXISTS avb_qty_returned_quarter;

ALTER TABLE public.allocation_variant_breakdown
  ADD CONSTRAINT avb_qty_allocated_quarter
    CHECK (public.is_quarter_multiple(qty_allocated)) NOT VALID,
  ADD CONSTRAINT avb_qty_used_quarter
    CHECK (public.is_quarter_multiple(qty_used))      NOT VALID,
  ADD CONSTRAINT avb_qty_returned_quarter
    CHECK (public.is_quarter_multiple(qty_returned))  NOT VALID;

-- material_requests
ALTER TABLE public.material_requests
  DROP CONSTRAINT IF EXISTS mr_requested_quarter,
  DROP CONSTRAINT IF EXISTS mr_fulfilled_quarter;

ALTER TABLE public.material_requests
  ADD CONSTRAINT mr_requested_quarter
    CHECK (public.is_quarter_multiple(requested_quantity)) NOT VALID,
  ADD CONSTRAINT mr_fulfilled_quarter
    CHECK (public.is_quarter_multiple(fulfilled_quantity)) NOT VALID;

-- material_returns
ALTER TABLE public.material_returns
  DROP CONSTRAINT IF EXISTS mret_returned_quarter,
  DROP CONSTRAINT IF EXISTS mret_number_of_units_quarter;

ALTER TABLE public.material_returns
  ADD CONSTRAINT mret_returned_quarter
    CHECK (public.is_quarter_multiple(returned_quantity))  NOT VALID,
  ADD CONSTRAINT mret_number_of_units_quarter
    CHECK (public.is_quarter_multiple(number_of_units))    NOT VALID;

-- material_movement_logs (quantity on each row too, for defence in depth)
ALTER TABLE public.material_movement_logs
  DROP CONSTRAINT IF EXISTS mml_quantity_quarter,
  DROP CONSTRAINT IF EXISTS mml_number_of_units_quarter;

ALTER TABLE public.material_movement_logs
  ADD CONSTRAINT mml_quantity_quarter
    CHECK (public.is_quarter_multiple(quantity))        NOT VALID,
  ADD CONSTRAINT mml_number_of_units_quarter
    CHECK (public.is_quarter_multiple(number_of_units)) NOT VALID;

-- request_fulfillment_items (units_issued is INT already so fine;
-- quantity_issued is NUMERIC)
ALTER TABLE public.request_fulfillment_items
  DROP CONSTRAINT IF EXISTS rfi_quantity_issued_quarter;

ALTER TABLE public.request_fulfillment_items
  ADD CONSTRAINT rfi_quantity_issued_quarter
    CHECK (public.is_quarter_multiple(quantity_issued)) NOT VALID;

NOTIFY pgrst, 'reload schema';
