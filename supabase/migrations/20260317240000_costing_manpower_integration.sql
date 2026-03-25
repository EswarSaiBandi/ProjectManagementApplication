-- Update project_costing_summary view to derive labor costs from the
-- project_manpower + labour_master tables (the new manpower module).
--
-- In-House  cost = (monthly_salary / 24) * (bandwidth_pct / 100) * working_days
-- Outsourced cost = daily_wage * working_days + incentive
-- working_days    = (end_date - start_date) + 1  (inclusive)

create or replace view public.project_costing_summary as
with manpower_costs as (
  select
    pm.project_id,

    -- In-House estimated cost
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

    -- Outsourced estimated cost
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
)
select
  p.project_id,
  p.project_name,

  -- Material costs from material movements
  coalesce(sum(case when mm.movement_type = 'Outward' then mm.total_cost else 0 end), 0)
    as material_cost_actual,

  -- In-house labour cost from manpower module
  coalesce(mc.inhouse_cost, 0)    as labor_cost_inhouse,

  -- Outsourced labour cost from manpower module
  coalesce(mc.outsourced_cost, 0) as labor_cost_outsourced,

  -- Budgeted total from ledger
  coalesce((
    select sum(amount)
    from public.project_cost_ledger pcl
    where pcl.project_id = p.project_id and pcl.cost_type = 'Budgeted'
  ), 0) as budgeted_total,

  -- Other expenses (Debit transactions)
  coalesce((
    select sum(amount)
    from public.transactions t
    where t.project_id = p.project_id and t.type = 'Debit'
  ), 0) as expenses_total,

  -- Income (Credit transactions)
  coalesce((
    select sum(amount)
    from public.transactions t
    where t.project_id = p.project_id and t.type = 'Credit'
  ), 0) as income_total,

  -- Total actual cost = materials + in-house + outsourced
  coalesce(sum(case when mm.movement_type = 'Outward' then mm.total_cost else 0 end), 0)
  + coalesce(mc.inhouse_cost, 0)
  + coalesce(mc.outsourced_cost, 0)
    as total_actual_cost,

  -- Cost variance = budget - actual
  coalesce((
    select sum(amount)
    from public.project_cost_ledger pcl
    where pcl.project_id = p.project_id and pcl.cost_type = 'Budgeted'
  ), 0)
  - (
    coalesce(sum(case when mm.movement_type = 'Outward' then mm.total_cost else 0 end), 0)
    + coalesce(mc.inhouse_cost, 0)
    + coalesce(mc.outsourced_cost, 0)
  ) as cost_variance,

  -- Profit/Loss = income - actual cost
  coalesce((
    select sum(amount)
    from public.transactions t
    where t.project_id = p.project_id and t.type = 'Credit'
  ), 0)
  - (
    coalesce(sum(case when mm.movement_type = 'Outward' then mm.total_cost else 0 end), 0)
    + coalesce(mc.inhouse_cost, 0)
    + coalesce(mc.outsourced_cost, 0)
  ) as profit_loss

from public.projects p
left join public.material_movements mm on mm.project_id = p.project_id
left join manpower_costs mc             on mc.project_id = p.project_id
group by p.project_id, p.project_name, mc.inhouse_cost, mc.outsourced_cost;

grant select on public.project_costing_summary to authenticated;

notify pgrst, 'reload schema';
