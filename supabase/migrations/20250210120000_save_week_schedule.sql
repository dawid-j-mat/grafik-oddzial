create or replace function public.save_week_schedule(p_week_id uuid, p_assignments jsonb, p_absences jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if not exists (
    select 1
    from public.profiles
    where user_id = auth.uid()
      and role in ('planner', 'head')
  ) then
    raise exception 'Brak uprawnień do zapisu';
  end if;

  select status
    into v_status
  from public.weeks
  where id = p_week_id
  for update;

  if v_status is null then
    raise exception 'Tydzień nie istnieje';
  end if;

  if v_status <> 'draft' then
    raise exception 'Tydzień zatwierdzony — brak zapisu';
  end if;

  if p_assignments is null then
    p_assignments := '[]'::jsonb;
  end if;

  if p_absences is null then
    p_absences := '[]'::jsonb;
  end if;

  if jsonb_typeof(p_assignments) <> 'array' then
    raise exception 'Niepoprawny format assignments';
  end if;

  if jsonb_typeof(p_absences) <> 'array' then
    raise exception 'Niepoprawny format absences';
  end if;

  delete from public.assignments
  where week_id = p_week_id;

  delete from public.absences
  where week_id = p_week_id;

  insert into public.assignments (week_id, date, slot, doctor_id, status)
  select
    p_week_id,
    x.date,
    x.slot,
    x.doctor_id,
    x.status
  from jsonb_to_recordset(p_assignments)
    as x(date date, slot text, doctor_id uuid, status text);

  insert into public.absences (week_id, date, slot, doctor_id, reason, note)
  select
    p_week_id,
    y.date,
    y.slot,
    y.doctor_id,
    y.reason,
    y.note
  from jsonb_to_recordset(p_absences)
    as y(date date, slot text, doctor_id uuid, reason text, note text);
end;
$$;

grant execute on function public.save_week_schedule(uuid, jsonb, jsonb) to authenticated;

select pg_notify('pgrst', 'reload schema');
