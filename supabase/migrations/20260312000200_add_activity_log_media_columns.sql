alter table public.activity_logs
add column if not exists audio_path text;

alter table public.activity_logs
add column if not exists file_path text;

alter table public.activity_logs
add column if not exists file_name text;
