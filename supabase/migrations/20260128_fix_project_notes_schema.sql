-- Ensure project_notes matches web app expectations (idempotent)
-- Useful when the table existed previously with different columns/constraints.

-- Add missing columns
alter table if exists public.project_notes
  add column if not exists project_id bigint;

alter table if exists public.project_notes
  add column if not exists title text;

alter table if exists public.project_notes
  add column if not exists body text;

alter table if exists public.project_notes
  add column if not exists created_at timestamp with time zone;

alter table if exists public.project_notes
  add column if not exists updated_at timestamp with time zone;

alter table if exists public.project_notes
  add column if not exists created_by uuid references auth.users(id);

-- Backfill timestamps if missing
update public.project_notes
  set created_at = timezone('utc'::text, now())
  where created_at is null;

update public.project_notes
  set updated_at = timezone('utc'::text, now())
  where updated_at is null;

alter table if exists public.project_notes
  alter column created_at set default timezone('utc'::text, now());

alter table if exists public.project_notes
  alter column updated_at set default timezone('utc'::text, now());

-- Enable RLS + policies (safe to re-run)
alter table if exists public.project_notes enable row level security;

drop policy if exists "project_notes_read_authenticated" on public.project_notes;
drop policy if exists "project_notes_write_authenticated" on public.project_notes;
drop policy if exists "project_notes_update_authenticated" on public.project_notes;
drop policy if exists "project_notes_delete_authenticated" on public.project_notes;

create policy "project_notes_read_authenticated"
on public.project_notes for select
to authenticated
using (true);

create policy "project_notes_write_authenticated"
on public.project_notes for insert
to authenticated
with check (true);

create policy "project_notes_update_authenticated"
on public.project_notes for update
to authenticated
using (true);

create policy "project_notes_delete_authenticated"
on public.project_notes for delete
to authenticated
using (true);

-- Reload PostgREST schema cache
notify pgrst, 'reload schema';

