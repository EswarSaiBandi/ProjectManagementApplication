-- Bifurcate manpower into In-House and Outsourced
-- Add labor_type to existing project_manpower table

alter table if exists public.project_manpower
add column if not exists labor_type text default 'In-House' not null;

-- Add constraint for labor_type
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'project_manpower_labor_type_check'
  ) then
    alter table public.project_manpower
      add constraint project_manpower_labor_type_check
      check (labor_type in ('In-House', 'Outsourced'));
  end if;
end $$;

-- Add vendor/contractor name for outsourced labor
alter table if exists public.project_manpower
add column if not exists vendor_name text;

-- Add contract details for outsourced labor
alter table if exists public.project_manpower
add column if not exists contract_number text;

alter table if exists public.project_manpower
add column if not exists contract_amount numeric(12,2);

-- Link to team members for in-house labor
alter table if exists public.project_manpower
add column if not exists team_member_id uuid references auth.users(id);

-- Add index for faster queries
create index if not exists idx_project_manpower_labor_type on public.project_manpower(labor_type);
create index if not exists idx_project_manpower_team_member on public.project_manpower(team_member_id);

notify pgrst, 'reload schema';
