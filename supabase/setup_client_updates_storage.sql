-- Create the 'project_updates' bucket
insert into storage.buckets (id, name, public)
values ('project_updates', 'project_updates', true)
on conflict (id) do nothing;

-- Policy to allow public read access to project_updates
create policy "Public Access Project Updates"
  on storage.objects for select
  using ( bucket_id = 'project_updates' );

-- Policy to allow authenticated users to upload project_updates
create policy "Authenticated Upload Project Updates"
  on storage.objects for insert
  with check ( bucket_id = 'project_updates' and auth.role() = 'authenticated' );

-- Policy to allow authenticated users to update/delete
create policy "Authenticated Update Project Updates"
  on storage.objects for update
  using ( bucket_id = 'project_updates' and auth.role() = 'authenticated' );

create policy "Authenticated Delete Project Updates"
  on storage.objects for delete
  using ( bucket_id = 'project_updates' and auth.role() = 'authenticated' );
