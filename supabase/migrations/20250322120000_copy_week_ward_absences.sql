create or replace function public.copy_week_ward_absences(p_target_week_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target_week_start date;
  v_target_status text;
  v_source_week_start date;
  v_source_week_id uuid;
begin
  if not exists (
    select 1
    from public.profiles
    where user_id = auth.uid()
      and role in ('planner', 'head')
  ) then
    raise exception 'Brak uprawnień do kopiowania';
  end if;

  select week_start, status
    into v_target_week_start, v_target_status
  from public.weeks
  where id = p_target_week_id
  for update;

  if not found then
    raise exception 'Nie znaleziono tygodnia';
  end if;

  if v_target_status <> 'draft' then
    raise exception 'Tydzień zatwierdzony — brak kopiowania';
  end if;

  v_source_week_start := v_target_week_start - 7;

  select id
    into v_source_week_id
  from public.weeks
  where week_start = v_source_week_start;

  if not found then
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
    source_assignments.date + 7,
    source_assignments.slot,
    source_assignments.doctor_id,
    'WARD'
  from public.assignments as source_assignments
  where source_assignments.week_id = v_source_week_id
    and source_assignments.status = 'WARD'
    and not exists (
      select 1
      from public.assignments as target_admissions
      where target_admissions.week_id = p_target_week_id
        and target_admissions.status = 'ADMISSIONS'
        and target_admissions.date = source_assignments.date + 7
        and target_admissions.slot = source_assignments.slot
        and target_admissions.doctor_id = source_assignments.doctor_id
    );

  insert into public.absences (week_id, date, slot, doctor_id, reason, note)
  select
    p_target_week_id,
    source_absences.date + 7,
    source_absences.slot,
    source_absences.doctor_id,
    source_absences.reason,
    source_absences.note
  from public.absences as source_absences
  where source_absences.week_id = v_source_week_id;
end;
$$;

grant execute on function public.copy_week_ward_absences(uuid) to authenticated;

select pg_notify('pgrst', 'reload schema');
