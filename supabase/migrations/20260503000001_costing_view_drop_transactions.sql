-- ============================================================================
-- project_costing_summary: drop dependency on the transactions table.
--
-- Reason: user has removed the transactions module from the UI. Expenses are
-- captured via:
--   * Material  → FIFO stock usage (allocation_variant_breakdown.qty_used × price)
--   * Manpower  → project_manpower × labour_master
--   * Overhead  → project_cost_ledger where cost_type = 'Actual'
--
-- Old view computed:
--   expenses_total    = debit_total + ledger.actual_other
--   income_total      = credit_total
--   profit_loss       = credit_total − total_actual_cost
--
-- New view computes:
--   expenses_total    = ledger.actual_other (debit_total removed)
--   income_total      = 0 (kept in schema for backward compat; always 0)
--   profit_loss       = budgeted_total − total_actual_cost
--                       (matches the UI rule: Profit/Loss = Budget − Actual)
--
-- Existing data in public.transactions is NOT touched. The table and its rows
-- stay for historical reference. They just no longer contribute to costing.
--
-- Run AFTER 20260503000000_project_type_multi.sql.
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
ledger_actual AS (
  SELECT
    pcl.project_id,
    COALESCE(SUM(pcl.amount), 0) AS actual_other
  FROM public.project_cost_ledger pcl
  WHERE pcl.cost_type = 'Actual'
  GROUP BY pcl.project_id
),
ledger_budgeted AS (
  SELECT
    pcl.project_id,
    COALESCE(SUM(pcl.amount), 0) AS budgeted_total
  FROM public.project_cost_ledger pcl
  WHERE pcl.cost_type = 'Budgeted'
  GROUP BY pcl.project_id
),
fifo_material AS (
  SELECT
    ma.project_id,
    COALESCE(SUM(avb.qty_used * avb.unit_price), 0)::NUMERIC(14,2) AS amt
  FROM public.material_allocations ma
  JOIN public.allocation_variant_breakdown avb
    ON avb.allocation_id = ma.allocation_id
  GROUP BY ma.project_id
),
-- Legacy material_movements fallback for projects with no FIFO allocations.
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

  COALESCE(mr.material_actual, 0)     AS material_cost_actual,

  COALESCE(mc.inhouse_cost, 0)        AS labor_cost_inhouse,
  COALESCE(mc.outsourced_cost, 0)     AS labor_cost_outsourced,

  COALESCE(lb.budgeted_total, 0)      AS budgeted_total,

  -- Expenses now come only from project_cost_ledger (Actual). No transactions.
  COALESCE(la.actual_other, 0)        AS expenses_total,

  -- Income field is deprecated but kept at 0 so existing SELECT * callers don't break.
  0::NUMERIC                          AS income_total,

  COALESCE(mr.material_actual, 0)
  + COALESCE(mc.inhouse_cost, 0)
  + COALESCE(mc.outsourced_cost, 0)
  + COALESCE(la.actual_other, 0)
                                      AS total_actual_cost,

  -- Cost variance still = budget − actual (kept for old consumers, but UI
  -- renamed this to "Profit/Loss" per user's simplified model).
  COALESCE(lb.budgeted_total, 0)
  - (
    COALESCE(mr.material_actual, 0)
    + COALESCE(mc.inhouse_cost, 0)
    + COALESCE(mc.outsourced_cost, 0)
    + COALESCE(la.actual_other, 0)
  )                                   AS cost_variance,

  -- Profit / Loss = Budget − Actual Cost (user-confirmed model).
  COALESCE(lb.budgeted_total, 0)
  - (
    COALESCE(mr.material_actual, 0)
    + COALESCE(mc.inhouse_cost, 0)
    + COALESCE(mc.outsourced_cost, 0)
    + COALESCE(la.actual_other, 0)
  )                                   AS profit_loss

FROM public.projects p
LEFT JOIN material_resolved mr ON mr.project_id = p.project_id
LEFT JOIN manpower_costs    mc ON mc.project_id = p.project_id
LEFT JOIN ledger_actual     la ON la.project_id = p.project_id
LEFT JOIN ledger_budgeted   lb ON lb.project_id = p.project_id;

GRANT SELECT ON public.project_costing_summary TO authenticated;

NOTIFY pgrst, 'reload schema';
