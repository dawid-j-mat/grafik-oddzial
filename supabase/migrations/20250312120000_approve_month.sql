create or replace function public.approve_month(p_month_start date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month_start date;
  v_month_end date;
  v_range_start date;
  v_range_end date;
  v_week_start date;
  v_week_id uuid;
  v_status text;
  v_day date;
  v_slot text;
  v_count integer;
  v_offset integer;
  v_missing jsonb := '[]'::jsonb;
  v_dow integer;
  v_dow_end integer;
begin
  if not exists (
    select 1
    from public.profiles
    where user_id = auth.uid()
      and can_approve = true
  ) then
    raise exception 'Brak uprawnień do zatwierdzania miesiąca';
  end if;

  if date_trunc('month', p_month_start)::date <> p_month_start then
    raise exception 'Parametr p_month_start musi wskazywać pierwszy dzień miesiąca';
  end if;

  v_month_start := p_month_start;
  v_month_end := (p_month_start + interval '1 month - 1 day')::date;

  v_dow := extract(dow from v_month_start)::int;
  v_range_start := v_month_start
    + (case when v_dow = 0 then -6 else 1 - v_dow end);

  v_dow_end := extract(dow from v_month_end)::int;
  v_range_end := (v_month_end
    + (case when v_dow_end = 0 then -6 else 1 - v_dow_end end))
    + 4;

  v_week_start := v_range_start;
  while v_week_start <= v_range_end loop
    select id, status
      into v_week_id, v_status
    from public.weeks
    where week_start = v_week_start;

    if v_week_id is null then
      v_missing := v_missing || jsonb_build_array(
        jsonb_build_object(
          'type', 'MISSING_WEEK',
          'week_start', v_week_start
        )
      );
    elsif v_status = 'draft' then
      for v_offset in 0..4 loop
        v_day := v_week_start + v_offset;
        foreach v_slot in array['AM', 'PM'] loop
          select count(*)
            into v_count
          from public.assignments
          where week_id = v_week_id
            and date = v_day
            and slot = v_slot
            and status = 'ADMISSIONS';

          if v_count <> 1 then
            v_missing := v_missing || jsonb_build_array(
              jsonb_build_object(
                'type', 'MISSING_ADMISSIONS',
                'week_start', v_week_start,
                'date', v_day,
                'slot', v_slot
              )
            );
          end if;
        end loop;
      end loop;
    end if;

    v_week_start := v_week_start + 7;
  end loop;

  if jsonb_array_length(v_missing) > 0 then
    return jsonb_build_object('ok', false, 'missing', v_missing);
  end if;

  update public.weeks
  set status = 'approved',
      approved_at = now(),
      approved_by = auth.uid()
  where status = 'draft'
    and week_start >= v_range_start
    and week_start <= v_range_end;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.approve_month(date) to authenticated;

select pg_notify('pgrst', 'reload schema');
