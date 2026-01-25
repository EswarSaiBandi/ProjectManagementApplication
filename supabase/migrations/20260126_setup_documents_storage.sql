-- Supabase Storage setup for the 'documents' bucket
-- Used by: Project Files + Moodboard (and can be reused for quotes/orders/invoices attachments)

-- Create bucket (private by default)
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

-- Drop existing policies to allow re-running safely
drop policy if exists "Documents: Authenticated Read" on storage.objects;
drop policy if exists "Documents: Authenticated Upload" on storage.objects;
drop policy if exists "Documents: Authenticated Update" on storage.objects;
drop policy if exists "Documents: Authenticated Delete" on storage.objects;

-- Allow authenticated users to read objects in documents bucket
create policy "Documents: Authenticated Read"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'documents' and auth.role() = 'authenticated');

-- Allow authenticated users to upload objects in documents bucket
create policy "Documents: Authenticated Upload"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'documents' and auth.role() = 'authenticated');

-- Allow authenticated users to update objects in documents bucket
create policy "Documents: Authenticated Update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'documents' and auth.role() = 'authenticated');

-- Allow authenticated users to delete objects in documents bucket
create policy "Documents: Authenticated Delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'documents' and auth.role() = 'authenticated');

