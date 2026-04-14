-- Make project expense types configurable from Settings.
-- Also relax project_cost_ledger category validation so new dynamic values are accepted.

alter table public.dynamic_field_options
  drop constraint if exists dynamic_field_options_field_type_check;

alter table public.dynamic_field_options
  add constraint dynamic_field_options_field_type_check
  check (field_type in (
    'lead_source',
    'cost_category',
    'project_expense_type',
    'payment_method',
    'project_type',
    'material_category',
    'task_priority',
    'other'
  ));

insert into public.dynamic_field_options (field_type, option_value, display_order, is_active)
select 'project_expense_type', v, o, true
from (values
  ('Travel Expenses'::text, 1),
  ('Food Costs', 2),
  ('Others', 3)
) as t(v, o)
where not exists (
  select 1
  from public.dynamic_field_options d
  where d.field_type = 'project_expense_type'
    and d.option_value = t.v
);

alter table public.project_cost_ledger
  drop constraint if exists project_cost_ledger_cost_category_check;

alter table public.project_cost_ledger
  add constraint project_cost_ledger_cost_category_check
  check (length(trim(cost_category)) > 0);

notify pgrst, 'reload schema';
