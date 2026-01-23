-- Add new columns to site_activities
alter table public.site_activities
add column if not exists description text,
add column if not exists dependencies text;
