-- 0298: 成就卡打卡统计 RPC（近 N 天打卡日期 / 当前连续 / 历史最佳连续）
create or replace function public.get_task_checkin_stats(
  p_task_id uuid, p_member_id uuid, p_days int default 21
)
returns table (dates date[], current_streak int, best_streak int)
language plpgsql security definer as $$
declare
  v_dates date[];
  v_d date;
  v_prev date;
  v_run int := 0;
  v_best int := 0;
  v_cur int := 0;
  v_today date := (now() at time zone 'Asia/Shanghai')::date;
begin
  select array_agg(d order by d) into v_dates
  from (
    select distinct (cr.created_at at time zone 'Asia/Shanghai')::date as d
    from public.coin_records cr
    where cr.member_id = p_member_id
      and cr.category = 'task'
      and cr.ref_id = p_task_id
  ) s;

  if v_dates is null or array_length(v_dates, 1) is null then
    return query select array[]::date[], 0, 0;
    return;
  end if;

  foreach v_d in array v_dates loop
    if v_prev is not null and v_d = v_prev + 1 then
      v_run := v_run + 1;
    else
      v_run := 1;
    end if;
    v_best := greatest(v_best, v_run);
    v_prev := v_d;
  end loop;

  v_d := v_dates[array_length(v_dates, 1)];
  v_cur := case when v_d >= v_today - 1 then v_run else 0 end;

  return query select v_dates, v_cur, v_best;
end;
$$;
