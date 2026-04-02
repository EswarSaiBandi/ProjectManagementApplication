-- Allow Project Managers to read all attendance (same scope as leave overview API).
drop policy if exists "attendance_logs_select_admin" on public.attendance_logs;
create policy "attendance_logs_select_admin"
on public.attendance_logs for select
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid()
      and p.role in ('Admin', 'ProjectManager')
  )
);

drop policy if exists "attendance_objects_select_admin" on storage.objects;
create policy "attendance_objects_select_admin"
on storage.objects for select
to authenticated
using (
  bucket_id = 'attendance'
  and exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid()
      and p.role in ('Admin', 'ProjectManager')
  )
);

notify pgrst, 'reload schema';
