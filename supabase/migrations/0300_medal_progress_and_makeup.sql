-- 0300: 勋章功能优化
-- 1) 补打卡 RPC：为指定应打卡日期补一条打卡记录（仅限过去日期 + 应打卡日 + 不重复）
-- 2) 勋章进度 RPC：连续周期型展示各任务本周进度与剩余天数；集齐型/当日型展示 X/Y 计数

-- ============================================================
-- 1. 单任务周期进度（供进度查询复用，与 0299 判定口径一致）
-- ============================================================
create or replace function public.calc_task_week_progress(p_task_id uuid, p_member_id uuid)
returns table(current_weeks int, done_this_week int, per_week int)
language plpgsql security definer as $$
declare
  v_repeat int[];
  v_eval_dates date[];
  v_today date := (now() at time zone 'Asia/Shanghai')::date;
  v_cutoff_week date := date_trunc('week', date '2026-11-04')::date;
  v_cur_week date := date_trunc('week', (now() at time zone 'Asia/Shanghai')::date)::date;
  v_week date;
  v_w int;
  v_req date;
  v_missing int;
  v_due_missing int;
  v_run int := 0;
  v_cur int := 0;
  v_done int := 0;
  v_per int;
begin
  select coalesce(t.repeat_days, array[]::int[]) into v_repeat from public.tasks t where t.id = p_task_id;
  v_per := coalesce(array_length(v_repeat, 1), 0);
  if v_per = 0 then
    return query select 0, 0, 0;
    return;
  end if;

  select array_agg(d order by d) into v_eval_dates
  from (
    select distinct (cr.created_at at time zone 'Asia/Shanghai')::date as d
    from public.coin_records cr
    where cr.member_id = p_member_id and cr.category = 'task' and cr.ref_id = p_task_id
  ) s
  where s.d >= v_cutoff_week;

  -- 本周已完成的应打卡日数
  foreach v_w in array v_repeat loop
    v_req := v_cur_week + ((v_w + 6) % 7);
    if v_req = any(coalesce(v_eval_dates, array[]::date[])) then
      v_done := v_done + 1;
    end if;
  end loop;

  v_week := v_cutoff_week;
  while v_week <= v_cur_week loop
    v_missing := 0;
    v_due_missing := 0;
    foreach v_w in array v_repeat loop
      v_req := v_week + ((v_w + 6) % 7);
      if not (v_req = any(coalesce(v_eval_dates, array[]::date[]))) then
        v_missing := v_missing + 1;
        if v_req < v_today then v_due_missing := v_due_missing + 1; end if;
      end if;
    end loop;

    if v_missing = 0 then
      v_run := v_run + 1;
      v_cur := v_run;
    elsif v_week = v_cur_week and v_due_missing = 0 then
      exit;  -- 当前周期未结束，保留连续数
    else
      v_run := 0;
      v_cur := 0;
    end if;
    v_week := v_week + 7;
  end loop;

  return query select v_cur, v_done, v_per;
end;
$$;

-- ============================================================
-- 2. 补打卡
-- ============================================================
create or replace function public.makeup_task_checkin(
  p_task_id uuid, p_member_id uuid, p_date date
)
returns void
language plpgsql security definer as $$
declare
  v_task public.tasks%rowtype;
  v_family uuid;
  v_dow int;
  v_today date := (now() at time zone 'Asia/Shanghai')::date;
  v_ts timestamptz;
  v_balance int;
begin
  select * into v_task from public.tasks where id = p_task_id;
  if not found then raise exception '任务不存在'; end if;

  select family_id into v_family from public.members where id = p_member_id;
  if v_family is null or v_family <> v_task.family_id then
    raise exception '无权为该成员补打卡';
  end if;

  if v_task.member_id is not null and v_task.member_id <> p_member_id then
    raise exception '该任务不属于此成员';
  end if;

  if p_date >= v_today then
    raise exception '只能补过去的打卡日期，今天请直接完成';
  end if;

  -- 必须是任务配置的应打卡日（repeat_days: 0=周日...6=周六）
  v_dow := extract(dow from p_date)::int;
  if not (v_dow = any(coalesce(v_task.repeat_days, array[]::int[]))) then
    raise exception '该日期不是打卡日';
  end if;

  if exists (
    select 1 from public.coin_records
    where member_id = p_member_id and category = 'task' and ref_id = p_task_id
      and (created_at at time zone 'Asia/Shanghai')::date = p_date
  ) then
    raise exception '该日期已有打卡记录';
  end if;

  -- 补打卡时间定在当天北京时间中午，保证日期归属正确
  v_ts := (p_date::text || ' 12:00:00+08')::timestamptz;

  update public.members
  set star_value = coalesce(star_value, 0) + v_task.reward_coins
  where id = p_member_id
  returning star_value into v_balance;

  insert into public.coin_records
    (id, family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by, created_at, balance_type)
  values
    (gen_random_uuid(), v_task.family_id, p_member_id, v_task.reward_coins, coalesce(v_balance, 0),
     '补打卡·' || v_task.title, 'task', 'task', p_task_id, p_member_id, v_ts, 'star');
  -- coin_record_medal_sync 触发器会自动重算勋章，无需重复调用
end;
$$;

-- ============================================================
-- 3. 勋章进度总览
-- ============================================================
create or replace function public.get_medal_progress(p_member_id uuid)
returns table(medal_id uuid, series text, current_value int, target_value int, detail jsonb)
language plpgsql security definer as $$
declare
  v_family uuid;
  v_medal record;
  v_task record;
  v_total int;
  v_today_cnt int;
  v_today date := (now() at time zone 'Asia/Shanghai')::date;
  v_cutoff_week date := date_trunc('week', date '2026-11-04')::date;
  v_tasks jsonb;
  v_best int;
  v_prog record;
  v_gap int;
begin
  select family_id into v_family from public.members where id = p_member_id;
  if v_family is null then return; end if;

  for v_medal in
    select * from public.medals where family_id = v_family and is_active
  loop
    if v_medal.series = 'collect' then
      select count(*) into v_total
      from public.coin_records cr
      join public.tasks t on t.id = cr.ref_id
      where cr.member_id = p_member_id and cr.category = 'task'
        and t.subcategory = v_medal.subcategory;
      return query select v_medal.id, v_medal.series, coalesce(v_total, 0), v_medal.threshold, null::jsonb;

    elsif v_medal.series = 'daily' then
      select count(*) into v_today_cnt
      from public.coin_records cr
      where cr.member_id = p_member_id and cr.category = 'task'
        and (cr.created_at at time zone 'Asia/Shanghai')::date = v_today;
      return query select v_medal.id, v_medal.series, coalesce(v_today_cnt, 0), v_medal.threshold, null::jsonb;

    elsif v_medal.series = 'streak' then
      v_tasks := '[]'::jsonb;
      v_best := 0;
      for v_task in
        select t.id, t.title
        from public.tasks t
        where t.family_id = v_family
          and array_length(coalesce(t.repeat_days, array[]::int[]), 1) is not null
          and exists (
            select 1 from public.coin_records cr
            where cr.member_id = p_member_id and cr.category = 'task' and cr.ref_id = t.id
              and (cr.created_at at time zone 'Asia/Shanghai')::date >= v_cutoff_week
          )
        order by t.title
      loop
        select * into v_prog from public.calc_task_week_progress(v_task.id, p_member_id);
        v_best := greatest(v_best, v_prog.current_weeks);
        if v_prog.current_weeks >= v_medal.threshold then
          v_gap := 0;
        elsif v_prog.done_this_week >= v_prog.per_week then
          -- 本周已完整，从下周起按整周计算
          v_gap := (v_medal.threshold - v_prog.current_weeks) * v_prog.per_week;
        else
          -- 先补完本周剩余应打卡日，再按整周计算
          v_gap := (v_prog.per_week - v_prog.done_this_week)
                   + (v_medal.threshold - v_prog.current_weeks - 1) * v_prog.per_week;
        end if;
        v_tasks := v_tasks || jsonb_build_object(
          'task_id', v_task.id,
          'title', v_task.title,
          'current_weeks', v_prog.current_weeks,
          'done_this_week', v_prog.done_this_week,
          'per_week', v_prog.per_week,
          'gap_days', greatest(v_gap, 0)
        );
      end loop;
      return query select v_medal.id, v_medal.series, v_best, v_medal.threshold, v_tasks;
    end if;
  end loop;
end;
$$;
