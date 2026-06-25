-- Make project activity master list configurable from Settings > Dynamic Field Configuration.
-- The activity's tag (Site Work, Civil, MEP, etc.) is stored in `description` since
-- dynamic_field_options already exposes that free-text column.

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
    'activity_master',
    'other'
  ));

-- Seed the existing hardcoded master activities so users see the same list they
-- had before, but can now extend / disable entries from Settings.
insert into public.dynamic_field_options (field_type, option_value, display_order, is_active, description)
select 'activity_master', v, o, true, t
from (values
  ('Snags'::text,                1, 'Site Work'::text),
  ('Plumbing Drawing',           2, 'Design'),
  ('Flooring',                   3, 'Civil'),
  ('Electrical Cabling',         4, 'MEP'),
  ('Brickwork',                  5, 'Civil'),
  ('Plastering',                 6, 'Civil'),
  ('Painting',                   7, 'Finishing'),
  ('HVAC Installation',          8, 'MEP'),
  ('Fire Fighting Sys',          9, 'MEP'),
  ('False Ceiling',             10, 'Finishing'),
  ('Carpentry',                 11, 'Finishing'),
  ('Waterproofing',             12, 'Civil'),
  ('Demolition',                13, 'Site Work'),
  ('Site Clearance',            14, 'Site Work'),
  ('Excavation',                15, 'Civil'),
  ('Foundation',                16, 'Civil'),
  ('Structural Steel',          17, 'Civil'),
  ('Glass Work',                18, 'Finishing'),
  ('Landscaping',               19, 'Site Work'),
  ('Sewerage Line',             20, 'Plumbing')
) as t(v, o, t)
where not exists (
  select 1
  from public.dynamic_field_options d
  where d.field_type = 'activity_master'
    and d.option_value = t.v
);

notify pgrst, 'reload schema';
