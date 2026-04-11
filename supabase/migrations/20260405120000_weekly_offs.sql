-- Weekly off days per team member (profile) or field staff (labour). day_of_week: 0=Sunday … 6=Saturday (matches JS Date.getDay()).

create table if not exists public.weekly_offs (
  id bigint generated always as identity primary key,
  profile_user_id uuid references public.profiles(user_id) on delete cascade,
  labour_id bigint references public.labour_master(id) on delete cascade,
  day_of_week smallint not null check (day_of_week >= 0 and day_of_week <= 6),
  created_at timestamptz default now() not null,
  created_by uuid references public.profiles(user_id) on delete set null,
  constraint weekly_offs_one_subject check (
    (profile_user_id is not null and labour_id is null)
    or (profile_user_id is null and labour_id is not null)
  )
);

create unique index if not exists weekly_offs_profile_day_uq
  on public.weekly_offs (profile_user_id, day_of_week)
  where profile_user_id is not null;

create unique index if not exists weekly_offs_labour_day_uq
  on public.weekly_offs (labour_id, day_of_week)
  where labour_id is not null;

create index if not exists idx_weekly_offs_profile on public.weekly_offs (profile_user_id) where profile_user_id is not null;
create index if not exists idx_weekly_offs_labour on public.weekly_offs (labour_id) where labour_id is not null;

alter table public.weekly_offs enable row level security;

drop policy if exists "weekly_offs_select_auth" on public.weekly_offs;
create policy "weekly_offs_select_auth"
  on public.weekly_offs for select
  to authenticated
  using (true);

drop policy if exists "weekly_offs_insert_admin_pm" on public.weekly_offs;
drop policy if exists "weekly_offs_update_admin_pm" on public.weekly_offs;
drop policy if exists "weekly_offs_delete_admin_pm" on public.weekly_offs;

create policy "weekly_offs_insert_admin_pm"
  on public.weekly_offs for insert
  to authenticated
  with check (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid() and p.role in ('Admin', 'ProjectManager')
    )
  );

create policy "weekly_offs_update_admin_pm"
  on public.weekly_offs for update
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid() and p.role in ('Admin', 'ProjectManager')
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid() and p.role in ('Admin', 'ProjectManager')
    )
  );

create policy "weekly_offs_delete_admin_pm"
  on public.weekly_offs for delete
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid() and p.role in ('Admin', 'ProjectManager')
    )
  );

-- Stable helpers for attendance (SECURITY DEFINER so reads are reliable under RLS)
create or replace function public.is_profile_weekly_off(p_user_id uuid, p_date date)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.weekly_offs w
    where w.profile_user_id = p_user_id
      and w.day_of_week = floor(extract(dow from p_date))::int
  );
$$;

create or replace function public.is_labour_weekly_off(p_labour_id bigint, p_date date)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.weekly_offs w
    where w.labour_id = p_labour_id
      and w.day_of_week = floor(extract(dow from p_date))::int
  );
$$;

create or replace function public.should_confirm_weekly_off_checkin(
  p_profile_user_id uuid,
  p_labour_id bigint,
  p_work_date date
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_profile_user_id is not null then public.is_profile_weekly_off(p_profile_user_id, p_work_date)
    when p_labour_id is not null then public.is_labour_weekly_off(p_labour_id, p_work_date)
    else false
  end;
$$;

grant execute on function public.is_profile_weekly_off(uuid, date) to authenticated;
grant execute on function public.is_labour_weekly_off(bigint, date) to authenticated;
grant execute on function public.should_confirm_weekly_off_checkin(uuid, bigint, date) to authenticated;

grant select, insert, update, delete on public.weekly_offs to authenticated;

notify pgrst, 'reload schema';
