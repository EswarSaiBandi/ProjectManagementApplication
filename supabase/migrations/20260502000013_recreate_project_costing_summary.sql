-- ============================================================================
-- Safely recreate project_costing_summary.
--
-- Migration 20260502000007 did:
--   DROP TABLE public.allocation_variant_breakdown CASCADE;
-- which cascades to DROP any view depending on that table — including
-- project_costing_summary. That's why Financials module shows material cost
-- as 0 / stale: the view has been silently gone since 0007 was applied.
--
-- This migration drops-and-creates it unconditionally, using the exact
-- same definition as 20260502000003 (FIFO-backed material cost, movement
-- ledger fallback, manpower, txn, ledger totals). Idempotent — safe to
-- re-run.
--
-- Run AFTER 20260502000012_rename_usage_log_types.sql.
-- ============================================================================

DROP VIEW IF EXISTS public.project_costing_summary CASCADE;

CREATE OR REPLACE VIEW public.project_costing_summary AS
WITH manpower_costs AS (
  SELECT
    pm.project_id,
    SUM(
      CASE
        WHEN COALESCE(pm.labour_type, pm.labor_type) = 'In-House'
          AND pm.start_date IS NOT NULL AND pm.end_date IS NOT NULL
          AND pm.bandwidth_pct IS NOT NULL AND lm.monthly_salary IS NOT NULL
        THEN (lm.monthly_salary / 24.0)
             * (pm.bandwidth_pct / 100.0)
             * ((pm.end_date - pm.start_date) + 1)
        ELSE 0
      END
    ) AS inhouse_cost,
    SUM(
      CASE
        WHEN COALESCE(pm.labour_type, pm.labor_type) = 'Outsourced'
          AND pm.start_date IS NOT NULL AND pm.end_date IS NOT NULL
          AND pm.daily_wage IS NOT NULL
        THEN pm.daily_wage * ((pm.end_date - pm.start_date) + 1)
             + COALESCE(pm.incentive, 0)
        ELSE 0
      END
    ) AS outsourced_cost
  FROM public.project_manpower pm
  LEFT JOIN public.labour_master lm ON lm.id = pm.labour_id
  GROUP BY pm.project_id
),
txn_totals AS (
  SELECT
    t.project_id,
    COALESCE(SUM(CASE WHEN t.type = 'Debit'  THEN t.amount ELSE 0 END), 0) AS debit_total,
    COALESCE(SUM(CASE WHEN t.type = 'Credit' THEN t.amount ELSE 0 END), 0) AS credit_total
  FROM public.transactions t
  GROUP BY t.project_id
),
ledger_actual AS (
  SELECT
    pcl.project_id,
    COALESCE(SUM(pcl.amount), 0) AS actual_other
  FROM public.project_cost_ledger pcl
  WHERE pcl.cost_type = 'Actual'
  GROUP BY pcl.project_id
),
-- Net FIFO material cost. qty_used is already net: it goes up on Stock Used
-- (record) and down on Stock Used Reverted (revert), both at the breakdown
-- row's exact unit_price.
fifo_material AS (
  SELECT
    ma.project_id,
    COALESCE(SUM(avb.qty_used * avb.unit_price), 0)::NUMERIC(14,2) AS amt
  FROM public.material_allocations ma
  JOIN public.allocation_variant_breakdown avb
    ON avb.allocation_id = ma.allocation_id
  GROUP BY ma.project_id
),
-- Fallback for projects with no FIFO allocations (e.g. Market Purchase only).
movement_material AS (
  SELECT
    mm.project_id,
    COALESCE(
      SUM(CASE WHEN mm.movement_type = 'Outward' THEN COALESCE(mm.total_cost, 0) ELSE 0 END),
      0
    ) AS amt
  FROM public.material_movements mm
  GROUP BY mm.project_id
),
material_resolved AS (
  SELECT
    p.project_id,
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM public.material_allocations ma
        JOIN public.allocation_variant_breakdown avb ON avb.allocation_id = ma.allocation_id
        WHERE ma.project_id = p.project_id
      )
      THEN COALESCE(fm.amt, 0)
      ELSE COALESCE(mo.amt, 0)
    END AS material_actual
  FROM public.projects p
  LEFT JOIN fifo_material    fm ON fm.project_id = p.project_id
  LEFT JOIN movement_material mo ON mo.project_id = p.project_id
)
SELECT
  p.project_id,
  p.project_name,

  COALESCE(mr.material_actual, 0) AS material_cost_actual,

  COALESCE(mc.inhouse_cost, 0)    AS labor_cost_inhouse,
  COALESCE(mc.outsourced_cost, 0) AS labor_cost_outsourced,

  COALESCE((
    SELECT SUM(amount)
    FROM public.project_cost_ledger pcl
    WHERE pcl.project_id = p.project_id AND pcl.cost_type = 'Budgeted'
  ), 0) AS budgeted_total,

  COALESCE(tt.debit_total, 0) + COALESCE(la.actual_other, 0) AS expenses_total,

  COALESCE(tt.credit_total, 0) AS income_total,

  COALESCE(mr.material_actual, 0)
  + COALESCE(mc.inhouse_cost, 0)
  + COALESCE(mc.outsourced_cost, 0)
  + COALESCE(tt.debit_total, 0)
  + COALESCE(la.actual_other, 0)
    AS total_actual_cost,

  COALESCE((
    SELECT SUM(amount)
    FROM public.project_cost_ledger pcl
    WHERE pcl.project_id = p.project_id AND pcl.cost_type = 'Budgeted'
  ), 0)
  - (
    COALESCE(mr.material_actual, 0)
    + COALESCE(mc.inhouse_cost, 0)
    + COALESCE(mc.outsourced_cost, 0)
    + COALESCE(tt.debit_total, 0)
    + COALESCE(la.actual_other, 0)
  ) AS cost_variance,

  COALESCE(tt.credit_total, 0)
  - (
    COALESCE(mr.material_actual, 0)
    + COALESCE(mc.inhouse_cost, 0)
    + COALESCE(mc.outsourced_cost, 0)
    + COALESCE(tt.debit_total, 0)
    + COALESCE(la.actual_other, 0)
  ) AS profit_loss

FROM public.projects p
LEFT JOIN material_resolved mr ON mr.project_id = p.project_id
LEFT JOIN manpower_costs    mc ON mc.project_id = p.project_id
LEFT JOIN txn_totals        tt ON tt.project_id = p.project_id
LEFT JOIN ledger_actual     la ON la.project_id = p.project_id;

GRANT SELECT ON public.project_costing_summary TO authenticated;

NOTIFY pgrst, 'reload schema';
