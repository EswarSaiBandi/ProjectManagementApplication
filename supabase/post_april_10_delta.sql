-- =============================================================================
-- Post-April-10 delta migration
-- =============================================================================
-- Applies all schema changes made after the April 10, 2026 database dump.
-- Safe to re-run: every statement is guarded with IF EXISTS / IF NOT EXISTS /
-- CREATE OR REPLACE, so running twice is a no-op.
--
-- Source commits (from git log since 2026-04-10):
--   701f47f 2026-04-11 attendence excel module
--   d233f29 2026-04-14 changes on 14-4
--   25044d6 2026-04-14 changes on 14-4 2
--   f721f11 2026-04-14 changes on 14-4 4
--
-- Run against the direct connection (port 5432), not the transaction pooler.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1/7  20260404120000_attendance_labour_proxy.sql
-- Proxy attendance for manpower without app login.
-- -----------------------------------------------------------------------------

create or replace function public.normalize_phone(p text)
returns text
language sql
immutable
as $$
  select nullif(regexp_replace(coalesce(p, ''), '\D', '', 'g'), '');
$$;

create or replace function public.labour_has_app_login(p_labour_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select
        exists (
          select 1
          from public.labour_master lm
          where lm.id = p_labour_id
            and (
              exists (
                select 1
                from public.profiles pr
                where pr.phone is not null
                  and lm.phone is not null
                  and public.normalize_phone(pr.phone) = public.normalize_phone(lm.phone)
                  and coalesce(pr.is_active, true)
              )
              or exists (
                select 1
                from public.project_manpower pm
                where pm.labour_id = p_labour_id
                  and pm.team_member_id is not null
              )
            )
        )
    ),
    false
  );
$$;

grant execute on function public.normalize_phone(text) to authenticated;
grant execute on function public.labour_has_app_login(bigint) to authenticated;

alter table public.attendance_logs
  add column if not exists labour_id bigint references public.labour_master(id) on delete cascade,
  add column if not exists marked_by_user_id uuid references public.profiles(user_id) on delete set null;

alter table public.attendance_logs alter column user_id drop not null;

alter table public.attendance_logs drop constraint if exists attendance_logs_subject_chk;
alter table public.attendance_logs
  add constraint attendance_logs_subject_chk check (
    (user_id is not null and labour_id is null)
    or (user_id is null and labour_id is not null)
  );

alter table public.attendance_logs drop constraint if exists attendance_logs_user_day_unique;

create unique index if not exists attendance_logs_user_day_uq
  on public.attendance_logs (user_id, work_date)
  where user_id is not null;

create unique index if not exists attendance_logs_labour_day_uq
  on public.attendance_logs (labour_id, work_date)
  where labour_id is not null;

drop policy if exists "attendance_logs_insert_own" on public.attendance_logs;
drop policy if exists "attendance_logs_update_own" on public.attendance_logs;

create policy "attendance_logs_insert_own"
on public.attendance_logs for insert
to authenticated
with check (
  auth.uid() = user_id
  and labour_id is null
);

create policy "attendance_logs_update_own"
on public.attendance_logs for update
to authenticated
using (auth.uid() = user_id and labour_id is null)
with check (auth.uid() = user_id and labour_id is null);

drop policy if exists "attendance_logs_select_supervisor_proxy" on public.attendance_logs;
create policy "attendance_logs_select_supervisor_proxy"
on public.attendance_logs for select
to authenticated
using (
  labour_id is not null
  and exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid() and p.role = 'SiteSupervisor'
  )
);

drop policy if exists "attendance_logs_insert_supervisor_proxy" on public.attendance_logs;
-- (policy body is superseded by file 2/7 below — skipping create here to avoid churn)

drop policy if exists "attendance_logs_update_supervisor_proxy" on public.attendance_logs;
-- (policy body is superseded by file 2/7 below — skipping create here to avoid churn)

drop policy if exists "attendance_objects_select_supervisor" on storage.objects;
create policy "attendance_objects_select_supervisor"
on storage.objects for select
to authenticated
using (
  bucket_id = 'attendance'
  and exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid() and p.role = 'SiteSupervisor'
  )
);

-- -----------------------------------------------------------------------------
-- 2/7  20260404131000_attendance_proxy_admin_pm.sql
-- Allow Admin + PM to mark proxy attendance alongside Site Supervisors.
-- -----------------------------------------------------------------------------

drop policy if exists "attendance_logs_insert_supervisor_proxy" on public.attendance_logs;
create policy "attendance_logs_insert_supervisor_proxy"
on public.attendance_logs for insert
to authenticated
with check (
  labour_id is not null
  and user_id is null
  and marked_by_user_id = auth.uid()
  and not public.labour_has_app_login(labour_id)
  and exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid()
      and p.role in ('Admin', 'ProjectManager', 'SiteSupervisor')
  )
);

drop policy if exists "attendance_logs_update_supervisor_proxy" on public.attendance_logs;
create policy "attendance_logs_update_supervisor_proxy"
on public.attendance_logs for update
to authenticated
using (
  labour_id is not null
  and not public.labour_has_app_login(labour_id)
  and exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid()
      and p.role in ('Admin', 'ProjectManager', 'SiteSupervisor')
  )
)
with check (
  labour_id is not null
  and user_id is null
  and not public.labour_has_app_login(labour_id)
  and exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid()
      and p.role in ('Admin', 'ProjectManager', 'SiteSupervisor')
  )
);

-- -----------------------------------------------------------------------------
-- 3/7  20260404133000_attendance_proxy_rpc.sql
-- SECURITY DEFINER RPC for reliable proxy attendance save.
-- -----------------------------------------------------------------------------

create or replace function public.attendance_proxy_upsert(
  p_labour_id bigint,
  p_work_date date,
  p_checkin boolean,
  p_lat double precision,
  p_lng double precision,
  p_accuracy double precision,
  p_photo_path text
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  rrole text;
  aid bigint;
  existing_id bigint;
  existing_check_in timestamptz;
  existing_check_out timestamptz;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  select p.role into rrole from public.profiles p where p.user_id = uid limit 1;
  if rrole is null or rrole not in ('Admin', 'ProjectManager', 'SiteSupervisor') then
    raise exception 'Only Admin, Project Manager, or Site Supervisor can mark field-staff attendance';
  end if;

  if public.labour_has_app_login(p_labour_id) then
    raise exception 'This person is linked to an app login (phone or team member). They must check in themselves.';
  end if;

  select a.attendance_id, a.check_in_at, a.check_out_at
    into existing_id, existing_check_in, existing_check_out
  from public.attendance_logs a
  where a.labour_id = p_labour_id and a.work_date = p_work_date
  limit 1;

  if p_checkin then
    if existing_check_in is not null then
      raise exception 'Already checked in today for this person';
    end if;
    if existing_id is not null then
      update public.attendance_logs
      set
        check_in_at = now(),
        check_in_lat = p_lat,
        check_in_lng = p_lng,
        check_in_accuracy = p_accuracy,
        check_in_photo_path = p_photo_path
      where attendance_id = existing_id;
      return existing_id;
    else
      insert into public.attendance_logs (
        user_id,
        labour_id,
        marked_by_user_id,
        work_date,
        check_in_at,
        check_in_lat,
        check_in_lng,
        check_in_accuracy,
        check_in_photo_path
      )
      values (
        null,
        p_labour_id,
        uid,
        p_work_date,
        now(),
        p_lat,
        p_lng,
        p_accuracy,
        p_photo_path
      )
      returning attendance_id into aid;
      return aid;
    end if;
  else
    if existing_id is null or existing_check_in is null then
      raise exception 'Check in first for this person';
    end if;
    if existing_check_out is not null then
      raise exception 'Already checked out today for this person';
    end if;
    update public.attendance_logs
    set
      check_out_at = now(),
      check_out_lat = p_lat,
      check_out_lng = p_lng,
      check_out_accuracy = p_accuracy,
      check_out_photo_path = p_photo_path
    where attendance_id = existing_id;
    return existing_id;
  end if;
end;
$$;

revoke all on function public.attendance_proxy_upsert(bigint, date, boolean, double precision, double precision, double precision, text) from public;
grant execute on function public.attendance_proxy_upsert(bigint, date, boolean, double precision, double precision, double precision, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 4/7  20260405120000_weekly_offs.sql
-- Weekly-off days per profile/labour + helper functions.
-- -----------------------------------------------------------------------------

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

-- -----------------------------------------------------------------------------
-- 5/7  20260414100000_attendance_status_codes.sql
-- Calendar-style attendance status codes (WO/HO/CO/HD/CL/SL/PL/LOP).
-- (Superseded in part by 6/7 which adds 'WORKING' — final CHECK lives there.)
-- -----------------------------------------------------------------------------

alter table public.attendance_logs
  add column if not exists attendance_status text;

-- -----------------------------------------------------------------------------
-- 6/7  20260414113000_add_working_attendance_status.sql
-- Adds 'WORKING' to the status code set; redefines upsert_attendance_status.
-- (Check constraint here is the final authoritative version.)
-- -----------------------------------------------------------------------------

alter table public.attendance_logs
  drop constraint if exists attendance_logs_status_check;

alter table public.attendance_logs
  add constraint attendance_logs_status_check
  check (
    attendance_status is null
    or attendance_status in ('WORKING', 'WO', 'HO', 'CO', 'HD', 'CL', 'SL', 'PL', 'LOP')
  );

create or replace function public.upsert_attendance_status(
  p_work_date date,
  p_attendance_status text,
  p_user_id uuid default null,
  p_labour_id bigint default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  select p.role
    into v_role
  from public.profiles p
  where p.user_id = auth.uid()
  limit 1;

  if v_role not in ('Admin', 'ProjectManager') then
    raise exception 'Only Admin or ProjectManager can update attendance status';
  end if;

  if p_work_date is null then
    raise exception 'Work date is required';
  end if;

  if p_attendance_status is null
     or p_attendance_status not in ('WORKING', 'WO', 'HO', 'CO', 'HD', 'CL', 'SL', 'PL', 'LOP') then
    raise exception 'Invalid attendance status code';
  end if;

  if (p_user_id is null and p_labour_id is null) or (p_user_id is not null and p_labour_id is not null) then
    raise exception 'Provide exactly one subject: user_id or labour_id';
  end if;

  if p_user_id is not null then
    update public.attendance_logs
       set attendance_status = p_attendance_status
     where user_id = p_user_id
       and work_date = p_work_date;

    if not found then
      insert into public.attendance_logs (user_id, work_date, attendance_status)
      values (p_user_id, p_work_date, p_attendance_status);
    end if;
  else
    update public.attendance_logs
       set attendance_status = p_attendance_status
     where labour_id = p_labour_id
       and work_date = p_work_date;

    if not found then
      insert into public.attendance_logs (user_id, labour_id, marked_by_user_id, work_date, attendance_status)
      values (null, p_labour_id, auth.uid(), p_work_date, p_attendance_status);
    end if;
  end if;
end;
$$;

grant execute on function public.upsert_attendance_status(date, text, uuid, bigint) to authenticated;

-- -----------------------------------------------------------------------------
-- 7/7  20260414160000_add_project_expense_type_dynamic_field.sql
-- Make project expense types configurable from Settings.
-- -----------------------------------------------------------------------------

alter table public.dynamic_field_options
  drop constraint if exists dynamic_field_options_field_type_check;

alter table public.dynamic_field_options
  add constraint dynamic_field_options_field_type_check
  check (field_type in (
    'lead_source',
    'cost_category',
    'project_expense_type',
    'payment_method',
    'project_type',
    'material_category',
    'task_priority',
    'other'
  ));

insert into public.dynamic_field_options (field_type, option_value, display_order, is_active)
select 'project_expense_type', v, o, true
from (values
  ('Travel Expenses'::text, 1),
  ('Food Costs', 2),
  ('Others', 3)
) as t(v, o)
where not exists (
  select 1
  from public.dynamic_field_options d
  where d.field_type = 'project_expense_type'
    and d.option_value = t.v
);

alter table public.project_cost_ledger
  drop constraint if exists project_cost_ledger_cost_category_check;

alter table public.project_cost_ledger
  add constraint project_cost_ledger_cost_category_check
  check (length(trim(cost_category)) > 0);

commit;

-- Reload PostgREST schema cache (outside the transaction).
notify pgrst, 'reload schema';
