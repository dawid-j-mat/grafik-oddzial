create extension if not exists pgcrypto;

create table if not exists public.doctors (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  is_active boolean not null default true
);

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('doctor', 'planner', 'head')),
  can_approve boolean not null default false,
  doctor_id uuid null references public.doctors(id),
  constraint head_can_approve check (role <> 'head' or can_approve = true)
);

create table if not exists public.weeks (
  id uuid primary key default gen_random_uuid(),
  week_start date not null unique,
  status text not null default 'draft' check (status in ('draft', 'approved')),
  approved_at timestamptz null,
  approved_by uuid null references auth.users(id)
);

create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(),
  week_id uuid not null references public.weeks(id) on delete cascade,
  date date not null,
  slot text not null check (slot in ('AM', 'PM')),
  doctor_id uuid not null references public.doctors(id),
  status text not null check (status in ('WARD', 'ADMISSIONS')),
  created_at timestamptz not null default now(),
  constraint assignments_unique_per_week unique (week_id, date, slot, doctor_id)
);

create unique index if not exists assignments_one_admissions_per_slot
  on public.assignments(week_id, date, slot)
  where status = 'ADMISSIONS';

create table if not exists public.absences (
  id uuid primary key default gen_random_uuid(),
  week_id uuid not null references public.weeks(id) on delete cascade,
  date date not null,
  slot text not null check (slot in ('AM', 'PM')),
  doctor_id uuid not null references public.doctors(id),
  reason text not null check (reason in ('VACATION', 'TRAINING', 'POST_CALL', 'OTHER')),
  note text null,
  created_at timestamptz not null default now(),
  constraint absences_unique_per_week unique (week_id, date, slot, doctor_id)
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, role, can_approve)
  values (new.id, 'doctor', false)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.doctors enable row level security;
alter table public.profiles enable row level security;
alter table public.weeks enable row level security;
alter table public.assignments enable row level security;
alter table public.absences enable row level security;

create policy doctors_select
  on public.doctors
  for select
  to authenticated
  using (true);

create policy profiles_select_own
  on public.profiles
  for select
  to authenticated
  using (user_id = auth.uid());

create policy weeks_select
  on public.weeks
  for select
  to authenticated
  using (true);

create policy weeks_insert_draft
  on public.weeks
  for insert
  to authenticated
  with check (
    status = 'draft'
    and exists (
      select 1
      from public.profiles
      where user_id = auth.uid()
        and role in ('planner', 'head')
    )
  );

create policy weeks_update_draft
  on public.weeks
  for update
  to authenticated
  using (
    status = 'draft'
    and exists (
      select 1
      from public.profiles
      where user_id = auth.uid()
        and role in ('planner', 'head')
    )
  )
  with check (
    status = 'draft'
    and exists (
      select 1
      from public.profiles
      where user_id = auth.uid()
        and role in ('planner', 'head')
    )
  );

create policy weeks_delete_draft
  on public.weeks
  for delete
  to authenticated
  using (
    status = 'draft'
    and exists (
      select 1
      from public.profiles
      where user_id = auth.uid()
        and role in ('planner', 'head')
    )
  );

create policy assignments_select
  on public.assignments
  for select
  to authenticated
  using (true);

create policy assignments_insert_draft
  on public.assignments
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.weeks
      where id = week_id
        and status = 'draft'
    )
    and exists (
      select 1
      from public.profiles
      where user_id = auth.uid()
        and role in ('planner', 'head')
    )
  );

create policy assignments_update_draft
  on public.assignments
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.weeks
      where id = week_id
        and status = 'draft'
    )
    and exists (
      select 1
      from public.profiles
      where user_id = auth.uid()
        and role in ('planner', 'head')
    )
  )
  with check (
    exists (
      select 1
      from public.weeks
      where id = week_id
        and status = 'draft'
    )
    and exists (
      select 1
      from public.profiles
      where user_id = auth.uid()
        and role in ('planner', 'head')
    )
  );

create policy assignments_delete_draft
  on public.assignments
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.weeks
      where id = week_id
        and status = 'draft'
    )
    and exists (
      select 1
      from public.profiles
      where user_id = auth.uid()
        and role in ('planner', 'head')
    )
  );

create policy absences_select
  on public.absences
  for select
  to authenticated
  using (true);

create policy absences_insert_draft
  on public.absences
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.weeks
      where id = week_id
        and status = 'draft'
    )
    and exists (
      select 1
      from public.profiles
      where user_id = auth.uid()
        and role in ('planner', 'head')
    )
  );

create policy absences_update_draft
  on public.absences
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.weeks
      where id = week_id
        and status = 'draft'
    )
    and exists (
      select 1
      from public.profiles
      where user_id = auth.uid()
        and role in ('planner', 'head')
    )
  )
  with check (
    exists (
      select 1
      from public.weeks
      where id = week_id
        and status = 'draft'
    )
    and exists (
      select 1
      from public.profiles
      where user_id = auth.uid()
        and role in ('planner', 'head')
    )
  );

create policy absences_delete_draft
  on public.absences
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.weeks
      where id = week_id
        and status = 'draft'
    )
    and exists (
      select 1
      from public.profiles
      where user_id = auth.uid()
        and role in ('planner', 'head')
    )
  );

create or replace function public.approve_week(p_week_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_week_start date;
  v_status text;
  v_day date;
  v_slot text;
  v_count integer;
  v_offset integer;
begin
  if not exists (
    select 1
    from public.profiles
    where user_id = auth.uid()
      and can_approve = true
  ) then
    raise exception 'Not allowed to approve week';
  end if;

  select week_start, status
    into v_week_start, v_status
  from public.weeks
  where id = p_week_id;

  if v_week_start is null then
    raise exception 'Week not found';
  end if;

  if v_status <> 'draft' then
    raise exception 'Week is not in draft';
  end if;

  for v_offset in 0..4 loop
    v_day := v_week_start + v_offset;
    foreach v_slot in array['AM', 'PM'] loop
      select count(*)
        into v_count
      from public.assignments
      where week_id = p_week_id
        and date = v_day
        and slot = v_slot
        and status = 'ADMISSIONS';

      if v_count <> 1 then
        raise exception 'ADMISSIONS count must be 1 for % % (found %)', v_day, v_slot, v_count;
      end if;
    end loop;
  end loop;

  update public.weeks
  set status = 'approved',
      approved_at = now(),
      approved_by = auth.uid()
  where id = p_week_id;
end;
$$;

create or replace function public.revert_week(p_week_id uuid)
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
      and can_approve = true
  ) then
    raise exception 'Not allowed to revert week';
  end if;

  update public.weeks
  set status = 'draft',
      approved_at = null,
      approved_by = null
  where id = p_week_id;
end;
$$;
