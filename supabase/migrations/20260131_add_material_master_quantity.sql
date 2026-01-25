-- Add manual stock quantity tracking to material_master
-- This supports setting/maintaining inventory quantity from the UI.

alter table if exists public.material_master
  add column if not exists quantity numeric;

alter table if exists public.material_master
  alter column quantity set default 0;

update public.material_master
  set quantity = 0
  where quantity is null;

alter table if exists public.material_master
  alter column quantity set not null;

-- Force PostgREST schema cache reload (Supabase)
notify pgrst, 'reload schema';

