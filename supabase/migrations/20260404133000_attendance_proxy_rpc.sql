-- Reliable proxy attendance save (bypasses RLS inside a vetted SECURITY DEFINER function).
-- Fixes cases where direct PostgREST insert/update fails (e.g. policy / null handling quirks).

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

notify pgrst, 'reload schema';
