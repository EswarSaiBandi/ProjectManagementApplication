-- Allow Admin and Project Manager to insert/update proxy (labour) attendance like Site Supervisors.
-- Select for labour rows: Admin/PM already use attendance_logs_select_admin; SiteSupervisor keeps select_supervisor_proxy.

drop policy if exists "attendance_logs_insert_supervisor_proxy" on public.attendance_logs;
create policy "attendance_logs_insert_supervisor_proxy"
on public.attendance_logs for insert
to authenticated
with check (
  labour_id is not null
  and user_id is null
  and marked_by_user_id = auth.uid()
  and not public.labour_has_app_login(labour_id)
  and exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid()
      and p.role in ('Admin', 'ProjectManager', 'SiteSupervisor')
  )
);

drop policy if exists "attendance_logs_update_supervisor_proxy" on public.attendance_logs;
create policy "attendance_logs_update_supervisor_proxy"
on public.attendance_logs for update
to authenticated
using (
  labour_id is not null
  and not public.labour_has_app_login(labour_id)
  and exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid()
      and p.role in ('Admin', 'ProjectManager', 'SiteSupervisor')
  )
)
with check (
  labour_id is not null
  and user_id is null
  and not public.labour_has_app_login(labour_id)
  and exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid()
      and p.role in ('Admin', 'ProjectManager', 'SiteSupervisor')
  )
);

notify pgrst, 'reload schema';
