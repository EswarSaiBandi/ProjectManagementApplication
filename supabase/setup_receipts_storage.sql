-- Create the 'receipts' bucket
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', true);

-- Policy to allow public read access to receipts
create policy "Public Access"
  on storage.objects for select
  using ( bucket_id = 'receipts' );

-- Policy to allow authenticated users to upload receipts
create policy "Authenticated Upload"
  on storage.objects for insert
  with check ( bucket_id = 'receipts' and auth.role() = 'authenticated' );

-- Policy to allow users to update their own uploads (optional, but good for edits)
create policy "Authenticated Update"
  on storage.objects for update
  using ( bucket_id = 'receipts' and auth.role() = 'authenticated' );

-- Policy to allow users to delete their own uploads
create policy "Authenticated Delete"
  on storage.objects for delete
  using ( bucket_id = 'receipts' and auth.role() = 'authenticated' );
