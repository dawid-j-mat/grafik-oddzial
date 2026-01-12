create or replace function public.copy_week_ward_absences(p_target_week_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target_week_start date;
  v_source_week_start date;
  v_source_week_id uuid;
begin
  if not exists (
    select 1
    from public.profiles
    where user_id = auth.uid()
      and role in ('planner', 'head')
  ) then
    raise exception 'Brak uprawnień';
  end if;

  select week_start
    into v_target_week_start
  from public.weeks
  where id = p_target_week_id;

  if v_target_week_start is null then
    raise exception 'Week not found';
  end if;

  v_source_week_start := v_target_week_start - 7;

  select id
    into v_source_week_id
  from public.weeks
  where week_start = v_source_week_start;

  if v_source_week_id is null then
    raise exception 'Brak poprzedniego tygodnia do skopiowania';
  end if;

  delete from public.assignments
  where week_id = p_target_week_id
    and status = 'WARD';

  delete from public.absences
  where week_id = p_target_week_id;

  insert into public.assignments (week_id, date, slot, doctor_id, status)
  select
    p_target_week_id,
    a.date,
    a.slot,
    a.doctor_id,
    a.status
  from public.assignments as a
  where a.week_id = v_source_week_id
    and a.status = 'WARD'
    and not exists (
      select 1
      from public.assignments as t
      where t.week_id = p_target_week_id
        and t.date = a.date
        and t.slot = a.slot
        and t.status = 'ADMISSIONS'
        and t.doctor_id = a.doctor_id
    );

  insert into public.absences (week_id, date, slot, doctor_id, reason, note)
  select
    p_target_week_id,
    x.date,
    x.slot,
    x.doctor_id,
    x.reason,
    x.note
  from public.absences as x
  where x.week_id = v_source_week_id;
end;
$$;

grant execute on function public.copy_week_ward_absences(uuid) to authenticated;

select pg_notify('pgrst', 'reload schema');
