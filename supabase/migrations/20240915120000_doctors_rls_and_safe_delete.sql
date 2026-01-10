create policy doctors_insert_planner_head
  on public.doctors
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.profiles
      where user_id = auth.uid()
        and role in ('planner', 'head')
    )
  );

create policy doctors_update_planner_head
  on public.doctors
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.profiles
      where user_id = auth.uid()
        and role in ('planner', 'head')
    )
  )
  with check (
    exists (
      select 1
      from public.profiles
      where user_id = auth.uid()
        and role in ('planner', 'head')
    )
  );

create or replace function public.delete_doctor_safe(p_doctor_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.profiles
    where user_id = auth.uid()
      and role in ('planner', 'head')
  ) then
    raise exception 'Brak uprawnień do usuwania lekarzy';
  end if;

  if exists (
    select 1
    from public.assignments
    where doctor_id = p_doctor_id
  )
  or exists (
    select 1
    from public.absences
    where doctor_id = p_doctor_id
  )
  or exists (
    select 1
    from public.profiles
    where doctor_id = p_doctor_id
  ) then
    raise exception 'Nie można usunąć trwale — użyj archiwizacji';
  end if;

  delete from public.doctors
  where id = p_doctor_id;
end;
$$;

grant execute on function public.delete_doctor_safe(uuid) to authenticated;
