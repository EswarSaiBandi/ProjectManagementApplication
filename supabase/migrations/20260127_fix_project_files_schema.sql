-- Ensure project module tables match the web app expectations
-- Fixes "Could not find the 'bucket' column ... in the schema cache" by:
-- 1) Adding missing columns (idempotent)
-- 2) Backfilling defaults for existing rows
-- 3) Re-enabling RLS + policies (idempotent)
-- 4) Reloading PostgREST schema cache

-- -----------------------------
-- project_files
-- -----------------------------
alter table if exists public.project_files
  add column if not exists bucket text;

update public.project_files
  set bucket = 'documents'
  where bucket is null;

alter table if exists public.project_files
  alter column bucket set default 'documents';

alter table if exists public.project_files
  add column if not exists object_path text;

-- Some existing schemas expect a NOT NULL file_url column.
-- We keep it for compatibility and populate it with a stable storage locator.
alter table if exists public.project_files
  add column if not exists file_url text;

update public.project_files
  set file_url = concat(coalesce(bucket, 'documents'), '/', coalesce(object_path, ''))
  where file_url is null;

alter table if exists public.project_files
  add column if not exists file_name text;

alter table if exists public.project_files
  add column if not exists mime_type text;

alter table if exists public.project_files
  add column if not exists size_bytes bigint;

alter table if exists public.project_files
  add column if not exists created_at timestamp with time zone;

update public.project_files
  set created_at = timezone('utc'::text, now())
  where created_at is null;

alter table if exists public.project_files
  alter column created_at set default timezone('utc'::text, now());

alter table if exists public.project_files
  add column if not exists created_by uuid references auth.users(id);

-- RLS + policies
alter table if exists public.project_files enable row level security;

drop policy if exists "project_files_read_authenticated" on public.project_files;
drop policy if exists "project_files_write_authenticated" on public.project_files;
drop policy if exists "project_files_delete_authenticated" on public.project_files;

create policy "project_files_read_authenticated"
on public.project_files for select
to authenticated
using (true);

create policy "project_files_write_authenticated"
on public.project_files for insert
to authenticated
with check (true);

create policy "project_files_delete_authenticated"
on public.project_files for delete
to authenticated
using (true);

-- -----------------------------
-- project_moodboard_items
-- -----------------------------
alter table if exists public.project_moodboard_items
  add column if not exists bucket text;

update public.project_moodboard_items
  set bucket = 'documents'
  where bucket is null;

alter table if exists public.project_moodboard_items
  alter column bucket set default 'documents';

alter table if exists public.project_moodboard_items
  add column if not exists image_path text;

alter table if exists public.project_moodboard_items
  add column if not exists created_at timestamp with time zone;

update public.project_moodboard_items
  set created_at = timezone('utc'::text, now())
  where created_at is null;

alter table if exists public.project_moodboard_items
  alter column created_at set default timezone('utc'::text, now());

alter table if exists public.project_moodboard_items
  add column if not exists created_by uuid references auth.users(id);

-- RLS + policies
alter table if exists public.project_moodboard_items enable row level security;

drop policy if exists "project_moodboard_read_authenticated" on public.project_moodboard_items;
drop policy if exists "project_moodboard_write_authenticated" on public.project_moodboard_items;
drop policy if exists "project_moodboard_delete_authenticated" on public.project_moodboard_items;

create policy "project_moodboard_read_authenticated"
on public.project_moodboard_items for select
to authenticated
using (true);

create policy "project_moodboard_write_authenticated"
on public.project_moodboard_items for insert
to authenticated
with check (true);

create policy "project_moodboard_delete_authenticated"
on public.project_moodboard_items for delete
to authenticated
using (true);

-- Reload PostgREST schema cache so new columns are visible immediately
notify pgrst, 'reload schema';

