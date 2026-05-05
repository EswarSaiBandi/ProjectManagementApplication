-- ============================================================================
-- project_costing_summary: drop the material_movements legacy fallback.
--
-- Before (20260503000001): when a project had no FIFO allocations, material
-- cost fell back to SUM(material_movements.total_cost WHERE Outward). That
-- path produced doubled/incorrect costs for any project whose `material_movements`
-- rows survived the batch-FIFO cutover.
--
-- After: material cost is always SUM(qty_used × unit_price) from
-- allocation_variant_breakdown. Projects with no FIFO allocations show 0 — which
-- is correct, they haven't consumed anything through the canonical system.
--
-- Everything else (manpower, ledger actual/budgeted, profit/loss formula) is
-- preserved verbatim.
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
)
SELECT
  p.project_id,
  p.project_name,

  COALESCE(fm.amt, 0)                 AS material_cost_actual,

  COALESCE(mc.inhouse_cost, 0)        AS labor_cost_inhouse,
  COALESCE(mc.outsourced_cost, 0)     AS labor_cost_outsourced,

  COALESCE(lb.budgeted_total, 0)      AS budgeted_total,

  -- Expenses come only from project_cost_ledger (Actual). No transactions, no material_movements.
  COALESCE(la.actual_other, 0)        AS expenses_total,

  -- Income field is deprecated but kept at 0 so existing SELECT * callers don't break.
  0::NUMERIC                          AS income_total,

  COALESCE(fm.amt, 0)
  + COALESCE(mc.inhouse_cost, 0)
  + COALESCE(mc.outsourced_cost, 0)
  + COALESCE(la.actual_other, 0)
                                      AS total_actual_cost,

  -- Cost variance still = budget − actual (kept for old consumers, but UI
  -- renamed this to "Profit/Loss" per user's simplified model).
  COALESCE(lb.budgeted_total, 0)
  - (
    COALESCE(fm.amt, 0)
    + COALESCE(mc.inhouse_cost, 0)
    + COALESCE(mc.outsourced_cost, 0)
    + COALESCE(la.actual_other, 0)
  )                                   AS cost_variance,

  -- Profit / Loss = Budget − Actual Cost (user-confirmed model).
  COALESCE(lb.budgeted_total, 0)
  - (
    COALESCE(fm.amt, 0)
    + COALESCE(mc.inhouse_cost, 0)
    + COALESCE(mc.outsourced_cost, 0)
    + COALESCE(la.actual_other, 0)
  )                                   AS profit_loss

FROM public.projects p
LEFT JOIN fifo_material     fm ON fm.project_id = p.project_id
LEFT JOIN manpower_costs    mc ON mc.project_id = p.project_id
LEFT JOIN ledger_actual     la ON la.project_id = p.project_id
LEFT JOIN ledger_budgeted   lb ON lb.project_id = p.project_id;

GRANT SELECT ON public.project_costing_summary TO authenticated;

NOTIFY pgrst, 'reload schema';
