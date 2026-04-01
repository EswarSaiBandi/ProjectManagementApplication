-- Align material_cost_actual with Project Costing tab:
-- If a project has project_stock_used rows, material cost = sum of
--   (quantity_used / quantity_per_unit) * cost_per_unit
-- (same as apps/web ProjectCostingTab fetchStockUsedCost).
-- Otherwise use sum of Outward material_movements.total_cost.

create or replace view public.project_costing_summary as
with manpower_costs as (
  select
    pm.project_id,
    sum(
      case
        when coalesce(pm.labour_type, pm.labor_type) = 'In-House'
          and pm.start_date is not null
          and pm.end_date   is not null
          and pm.bandwidth_pct is not null
          and lm.monthly_salary is not null
        then
          (lm.monthly_salary / 24.0)
          * (pm.bandwidth_pct / 100.0)
          * ((pm.end_date - pm.start_date) + 1)
        else 0
      end
    ) as inhouse_cost,
    sum(
      case
        when coalesce(pm.labour_type, pm.labor_type) = 'Outsourced'
          and pm.start_date  is not null
          and pm.end_date    is not null
          and pm.daily_wage  is not null
        then
          pm.daily_wage * ((pm.end_date - pm.start_date) + 1)
          + coalesce(pm.incentive, 0)
        else 0
      end
    ) as outsourced_cost
  from public.project_manpower pm
  left join public.labour_master lm on lm.id = pm.labour_id
  group by pm.project_id
),
txn_totals as (
  select
    t.project_id,
    coalesce(sum(case when t.type = 'Debit'  then t.amount else 0 end), 0) as debit_total,
    coalesce(sum(case when t.type = 'Credit' then t.amount else 0 end), 0) as credit_total
  from public.transactions t
  group by t.project_id
),
ledger_actual as (
  select
    pcl.project_id,
    coalesce(sum(pcl.amount), 0) as actual_other
  from public.project_cost_ledger pcl
  where pcl.cost_type = 'Actual'
  group by pcl.project_id
),
stock_used_material as (
  select
    psu.project_id,
    coalesce(
      sum(
        case
          when coalesce(mv.quantity_per_unit, 0) > 0
          then (psu.quantity_used / mv.quantity_per_unit) * coalesce(psu.cost_per_unit, 0)
          else 0::numeric
        end
      ),
      0
    ) as amt
  from public.project_stock_used psu
  join public.material_variants mv on mv.variant_id = psu.variant_id
  group by psu.project_id
),
movement_material as (
  select
    mm.project_id,
    coalesce(
      sum(case when mm.movement_type = 'Outward' then coalesce(mm.total_cost, 0) else 0 end),
      0
    ) as amt
  from public.material_movements mm
  group by mm.project_id
),
material_resolved as (
  select
    p.project_id,
    case
      when exists (select 1 from public.project_stock_used psu where psu.project_id = p.project_id)
      then coalesce(su.amt, 0)
      else coalesce(mo.amt, 0)
    end as material_actual
  from public.projects p
  left join stock_used_material su on su.project_id = p.project_id
  left join movement_material mo on mo.project_id = p.project_id
)
select
  p.project_id,
  p.project_name,

  coalesce(mr.material_actual, 0) as material_cost_actual,

  coalesce(mc.inhouse_cost, 0)    as labor_cost_inhouse,
  coalesce(mc.outsourced_cost, 0) as labor_cost_outsourced,

  coalesce((
    select sum(amount)
    from public.project_cost_ledger pcl
    where pcl.project_id = p.project_id and pcl.cost_type = 'Budgeted'
  ), 0) as budgeted_total,

  coalesce(tt.debit_total, 0) + coalesce(la.actual_other, 0) as expenses_total,

  coalesce(tt.credit_total, 0) as income_total,

  coalesce(mr.material_actual, 0)
  + coalesce(mc.inhouse_cost, 0)
  + coalesce(mc.outsourced_cost, 0)
  + coalesce(tt.debit_total, 0)
  + coalesce(la.actual_other, 0)
    as total_actual_cost,

  coalesce((
    select sum(amount)
    from public.project_cost_ledger pcl
    where pcl.project_id = p.project_id and pcl.cost_type = 'Budgeted'
  ), 0)
  - (
    coalesce(mr.material_actual, 0)
    + coalesce(mc.inhouse_cost, 0)
    + coalesce(mc.outsourced_cost, 0)
    + coalesce(tt.debit_total, 0)
    + coalesce(la.actual_other, 0)
  ) as cost_variance,

  coalesce(tt.credit_total, 0)
  - (
    coalesce(mr.material_actual, 0)
    + coalesce(mc.inhouse_cost, 0)
    + coalesce(mc.outsourced_cost, 0)
    + coalesce(tt.debit_total, 0)
    + coalesce(la.actual_other, 0)
  ) as profit_loss

from public.projects p
left join material_resolved mr on mr.project_id = p.project_id
left join manpower_costs mc    on mc.project_id = p.project_id
left join txn_totals tt        on tt.project_id = p.project_id
left join ledger_actual la     on la.project_id = p.project_id;

grant select on public.project_costing_summary to authenticated;

notify pgrst, 'reload schema';
