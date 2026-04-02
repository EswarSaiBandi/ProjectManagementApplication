-- Shell project for company-wide manpower overhead (e.g. store maintenance, oversight not tied to a client job).
-- Ledger rows still require project_id; this cost centre rolls up under MignonMinds.

insert into public.projects (project_name, status, start_date)
select 'MignonMinds — company overhead', 'Planning', (current_date at time zone 'utc')::date
where not exists (
  select 1 from public.projects p where p.project_name = 'MignonMinds — company overhead'
);

notify pgrst, 'reload schema';
