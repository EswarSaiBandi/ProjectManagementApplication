-- Add "WORKING" as a valid attendance status code.

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

notify pgrst, 'reload schema';
