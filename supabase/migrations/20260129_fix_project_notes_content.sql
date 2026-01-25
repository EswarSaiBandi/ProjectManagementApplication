-- Compatibility fix: some DBs use `content` (NOT NULL) for notes instead of `body`.
-- This migration makes the schema compatible with the web app and reloads PostgREST schema cache.

alter table if exists public.project_notes
  add column if not exists content text;

-- Backfill content from body if possible (best-effort)
update public.project_notes
  set content = coalesce(content, body, '')
  where content is null;

-- Reload PostgREST schema cache
notify pgrst, 'reload schema';

