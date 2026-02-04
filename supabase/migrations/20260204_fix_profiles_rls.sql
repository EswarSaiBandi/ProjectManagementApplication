-- Fix profiles access so Settings/Team screens work reliably.
-- Without policies, RLS can hide existing rows (select returns 0), causing duplicate key errors on insert.

alter table if exists public.profiles enable row level security;

drop policy if exists "profiles_select_auth" on public.profiles;
drop policy if exists "profiles_insert_auth" on public.profiles;
drop policy if exists "profiles_update_auth" on public.profiles;
drop policy if exists "profiles_delete_auth" on public.profiles;

-- Allow authenticated users to read profiles (used for team member pickers/autocomplete)
create policy "profiles_select_auth"
on public.profiles for select
to authenticated
using (true);

-- Allow authenticated users to insert/update their own profile row
create policy "profiles_insert_auth"
on public.profiles for insert
to authenticated
with check (auth.uid() = user_id);

create policy "profiles_update_auth"
on public.profiles for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- Delete is optional; keep restricted to own row
create policy "profiles_delete_auth"
on public.profiles for delete
to authenticated
using (auth.uid() = user_id);

notify pgrst, 'reload schema';

