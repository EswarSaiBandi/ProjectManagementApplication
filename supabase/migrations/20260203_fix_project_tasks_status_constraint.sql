-- Fix status check constraint for project_tasks to match web UI.
-- Some environments have a legacy constraint "project_tasks_status_check" that rejects 'Todo'/'Done'.

do $$
begin
  -- Backfill common legacy values into the web app's status vocabulary
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'project_tasks') then
    update public.project_tasks
      set status = 'Todo'
      where status is null
         or lower(status) in ('pending', 'not started', 'not_started', 'todo');

    update public.project_tasks
      set status = 'In Progress'
      where lower(status) in ('in progress', 'in-progress', 'in_progress', 'ongoing');

    update public.project_tasks
      set status = 'Done'
      where lower(status) in ('completed', 'complete', 'done');
  end if;
end $$;

-- Ensure default is consistent
alter table if exists public.project_tasks
  alter column status set default 'Todo';

-- Drop the legacy constraint (if present) and recreate with allowed values
alter table if exists public.project_tasks
  drop constraint if exists project_tasks_status_check;

alter table if exists public.project_tasks
  add constraint project_tasks_status_check
  check (status in ('Todo', 'In Progress', 'Done'));

-- Reload PostgREST schema cache
notify pgrst, 'reload schema';

