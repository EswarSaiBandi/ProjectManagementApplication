-- Storage bucket for attendance photos (camera captures)

-- Create bucket (private by default)
insert into storage.buckets (id, name, public)
values ('attendance', 'attendance', false)
on conflict (id) do nothing;

-- Note: Do NOT alter storage.objects here.
-- On hosted Supabase, storage.objects is owned/managed by Supabase and RLS is already enabled.

-- Policies: users can manage only their own folder: <uid>/...
drop policy if exists "attendance_objects_select_own" on storage.objects;
drop policy if exists "attendance_objects_insert_own" on storage.objects;
drop policy if exists "attendance_objects_update_own" on storage.objects;
drop policy if exists "attendance_objects_delete_own" on storage.objects;

create policy "attendance_objects_select_own"
on storage.objects for select
to authenticated
using (
  bucket_id = 'attendance'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "attendance_objects_insert_own"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'attendance'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "attendance_objects_update_own"
on storage.objects for update
to authenticated
using (
  bucket_id = 'attendance'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'attendance'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "attendance_objects_delete_own"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'attendance'
  and (storage.foldername(name))[1] = auth.uid()::text
);

