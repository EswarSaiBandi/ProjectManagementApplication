-- Add is_active to profiles for user activation/deactivation
alter table public.profiles
add column if not exists is_active boolean default true not null;

-- Existing users default to active
update public.profiles set is_active = true where is_active is null;
