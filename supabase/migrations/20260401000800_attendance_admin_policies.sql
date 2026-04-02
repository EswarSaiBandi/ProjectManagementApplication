-- Admins can read all attendance rows (for reporting).
drop policy if exists "attendance_logs_select_admin" on public.attendance_logs;
create policy "attendance_logs_select_admin"
on public.attendance_logs for select
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid() and p.role = 'Admin'
  )
);

-- Admins can view any attendance photo in the private bucket (paths are <user_id>/...).
drop policy if exists "attendance_objects_select_admin" on storage.objects;
create policy "attendance_objects_select_admin"
on storage.objects for select
to authenticated
using (
  bucket_id = 'attendance'
  and exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid() and p.role = 'Admin'
  )
);

notify pgrst, 'reload schema';
