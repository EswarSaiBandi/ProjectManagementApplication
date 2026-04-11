-- Proxy attendance for manpower without app login (Site Supervisors).
-- Self attendance: user_id set, labour_id null.
-- Proxy attendance: labour_id set, user_id null, marked_by_user_id = supervisor.
-- Block proxy if labour maps to a login: same mobile as any profile, or project_manpower.team_member_id set.

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

-- Tighten self-service policies (explicit labour_id null)
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

-- Site supervisors: read proxy (labour) rows (any supervisor can complete checkout)
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
    where p.user_id = auth.uid() and p.role = 'SiteSupervisor'
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
    where p.user_id = auth.uid() and p.role = 'SiteSupervisor'
  )
)
with check (
  labour_id is not null
  and user_id is null
  and not public.labour_has_app_login(labour_id)
  and exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid() and p.role = 'SiteSupervisor'
  )
);

-- Supervisors may view any attendance photo (paths include other users' folders for proxy)
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

notify pgrst, 'reload schema';
