-- Incurred project expenses: use project_cost_ledger with cost_type = 'Actual'
-- (Travel, Food, Others). Extend category check and fold ledger actuals into
-- project_costing_summary alongside debit transactions.

alter table public.project_cost_ledger
  drop constraint if exists project_cost_ledger_cost_category_check;

alter table public.project_cost_ledger
  add constraint project_cost_ledger_cost_category_check
  check (cost_category in (
    'Material', 'Labor', 'Equipment', 'Overhead', 'Other', 'Others',
    'Travel Expenses', 'Food Costs'
  ));

insert into public.dynamic_field_options (field_type, option_value, display_order, is_active, color_code)
select 'cost_category', v, o, true, c
from (values
  ('Travel Expenses'::text, 6, '#0EA5E9'),
  ('Food Costs', 7, '#F97316'),
  ('Others', 8, '#64748B')
) as t(v, o, c)
where not exists (
  select 1 from public.dynamic_field_options d
  where d.field_type = 'cost_category' and d.option_value = t.v and d.is_active = true
);

-- expenses_total = debit transactions + incurred ledger (Actual)
-- total_actual_cost / variance / profit_loss include the same other-expense total

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
)
select
  p.project_id,
  p.project_name,

  coalesce(sum(case when mm.movement_type = 'Outward' then mm.total_cost else 0 end), 0)
    as material_cost_actual,

  coalesce(mc.inhouse_cost, 0)    as labor_cost_inhouse,
  coalesce(mc.outsourced_cost, 0) as labor_cost_outsourced,

  coalesce((
    select sum(amount)
    from public.project_cost_ledger pcl
    where pcl.project_id = p.project_id and pcl.cost_type = 'Budgeted'
  ), 0) as budgeted_total,

  coalesce(tt.debit_total, 0) + coalesce(la.actual_other, 0) as expenses_total,

  coalesce(tt.credit_total, 0) as income_total,

  coalesce(sum(case when mm.movement_type = 'Outward' then mm.total_cost else 0 end), 0)
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
    coalesce(sum(case when mm.movement_type = 'Outward' then mm.total_cost else 0 end), 0)
    + coalesce(mc.inhouse_cost, 0)
    + coalesce(mc.outsourced_cost, 0)
    + coalesce(tt.debit_total, 0)
    + coalesce(la.actual_other, 0)
  ) as cost_variance,

  coalesce(tt.credit_total, 0)
  - (
    coalesce(sum(case when mm.movement_type = 'Outward' then mm.total_cost else 0 end), 0)
    + coalesce(mc.inhouse_cost, 0)
    + coalesce(mc.outsourced_cost, 0)
    + coalesce(tt.debit_total, 0)
    + coalesce(la.actual_other, 0)
  ) as profit_loss

from public.projects p
left join public.material_movements mm on mm.project_id = p.project_id
left join manpower_costs mc             on mc.project_id = p.project_id
left join txn_totals tt                 on tt.project_id = p.project_id
left join ledger_actual la              on la.project_id = p.project_id
group by p.project_id, p.project_name, mc.inhouse_cost, mc.outsourced_cost, tt.debit_total, tt.credit_total, la.actual_other;

grant select on public.project_costing_summary to authenticated;

notify pgrst, 'reload schema';
