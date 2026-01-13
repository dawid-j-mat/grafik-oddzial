create or replace function public.copy_week_ward_absences(p_target_week_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target_week_start date;
  v_source_week_start date;
  v_source_week_id uuid;
  v_ward_source_count int;
  v_absence_source_count int;
  v_ward_inserted int := 0;
  v_absence_inserted int := 0;
  v_skipped_due_to_admissions int := 0;
begin
  if not exists (
    select 1
    from public.profiles
    where user_id = auth.uid()
      and role in ('planner', 'head')
  ) then
    return jsonb_build_object('ok', false, 'error', 'Brak uprawnień');
  end if;

  select week_start
    into v_target_week_start
  from public.weeks
  where id = p_target_week_id;

  if v_target_week_start is null then
    return jsonb_build_object('ok', false, 'error', 'Week not found');
  end if;

  v_source_week_start := v_target_week_start - 7;

  select id
    into v_source_week_id
  from public.weeks
  where week_start = v_source_week_start;

  if v_source_week_id is null then
    return jsonb_build_object('ok', false, 'error', 'Brak poprzedniego tygodnia do skopiowania');
  end if;

  select count(*)
    into v_ward_source_count
  from (
    select distinct a.doctor_id, a.date
    from public.assignments as a
    where a.week_id = v_source_week_id
      and a.status = 'WARD'
      and a.date between v_source_week_start and v_source_week_start + 4
  ) as ward_source;

  select count(*)
    into v_absence_source_count
  from (
    select distinct x.doctor_id, x.date, x.reason, x.note
    from public.absences as x
    where x.week_id = v_source_week_id
      and x.date between v_source_week_start and v_source_week_start + 4
  ) as abs_source;

  if v_ward_source_count = 0 and v_absence_source_count = 0 then
    return jsonb_build_object('ok', false, 'error', 'Poprzedni tydzień nie ma danych do skopiowania');
  end if;

  delete from public.assignments
  where week_id = p_target_week_id
    and status = 'WARD';

  delete from public.absences
  where week_id = p_target_week_id;

  with ward_source as (
    select distinct a.doctor_id, a.date
    from public.assignments as a
    where a.week_id = v_source_week_id
      and a.status = 'WARD'
      and a.date between v_source_week_start and v_source_week_start + 4
  ),
  ward_slots as (
    select
      ws.doctor_id,
      (v_target_week_start + (ws.date - v_source_week_start))::date as date,
      'AM'::text as slot
    from ward_source as ws
    union all
    select
      ws.doctor_id,
      (v_target_week_start + (ws.date - v_source_week_start))::date as date,
      'PM'::text as slot
    from ward_source as ws
  ),
  admissions_conflicts as (
    select ws.doctor_id, ws.date, ws.slot
    from ward_slots as ws
    where exists (
      select 1
      from public.assignments as t
      where t.week_id = p_target_week_id
        and t.date = ws.date
        and t.slot = ws.slot
        and t.doctor_id = ws.doctor_id
        and t.status = 'ADMISSIONS'
    )
  )
  insert into public.assignments (week_id, date, slot, doctor_id, status)
  select
    p_target_week_id,
    ws.date,
    ws.slot,
    ws.doctor_id,
    'WARD'
  from ward_slots as ws
  where not exists (
    select 1
    from public.assignments as t
    where t.week_id = p_target_week_id
      and t.date = ws.date
      and t.slot = ws.slot
      and t.doctor_id = ws.doctor_id
      and t.status = 'ADMISSIONS'
  )
  on conflict (week_id, date, slot, doctor_id) do nothing;

  get diagnostics v_ward_inserted = row_count;
  select count(*)
    into v_skipped_due_to_admissions
  from admissions_conflicts;

  with abs_source as (
    select distinct x.doctor_id, x.date, x.reason, x.note
    from public.absences as x
    where x.week_id = v_source_week_id
      and x.date between v_source_week_start and v_source_week_start + 4
  ),
  abs_slots as (
    select
      ax.doctor_id,
      (v_target_week_start + (ax.date - v_source_week_start))::date as date,
      'AM'::text as slot,
      ax.reason,
      ax.note
    from abs_source as ax
    union all
    select
      ax.doctor_id,
      (v_target_week_start + (ax.date - v_source_week_start))::date as date,
      'PM'::text as slot,
      ax.reason,
      ax.note
    from abs_source as ax
  )
  insert into public.absences (week_id, date, slot, doctor_id, reason, note)
  select
    p_target_week_id,
    ax.date,
    ax.slot,
    ax.doctor_id,
    ax.reason,
    ax.note
  from abs_slots as ax;

  get diagnostics v_absence_inserted = row_count;

  return jsonb_build_object(
    'ok', true,
    'inserted_ward', v_ward_inserted,
    'inserted_absences', v_absence_inserted,
    'skipped_due_to_admissions', v_skipped_due_to_admissions
  );
exception
  when others then
    return jsonb_build_object('ok', false, 'error', sqlerrm);
end;
$$;

grant execute on function public.copy_week_ward_absences(uuid) to authenticated;

select pg_notify('pgrst', 'reload schema');
