-- 0302: 坚持类勋章改为「连续应打卡天数」判定（不再按自然周对齐）
--
-- 规则：
--   以任务 repeat_days 配置的星期为应打卡日；
--   连续完成应打卡日，未配置的星期自动跳过、不计缺卡、不打断连续；
--   只要漏打一个已到期的应打卡日，连续天数清零重新累计；
--   连续天数达到 7 / 14 / 21 天分别发放一周坚持之星 / 双周自律先锋 / 三周习惯大师；
--   同一任务断掉后重新累计满 7 天可再次获得（可叠加）。

-- ============================================================
-- 1. 单任务连续天数统计（连续应打卡日）
-- ============================================================
drop function if exists public.calc_task_week_progress(uuid, uuid);

create or replace function public.calc_task_streak(p_task_id uuid, p_member_id uuid)
returns table(current_days int, best_days int, segments int[])
language plpgsql security definer as $$
declare
  v_repeat int[];
  v_eval date[];
  v_req_dates date[];
  v_today date := (now() at time zone 'Asia/Shanghai')::date;
  v_cutoff date := date_trunc('week', date '2026-11-04')::date;
  v_run int := 0;
  v_best int := 0;
  v_segs int[] := array[]::int[];
  v_d date;
begin
  select coalesce(t.repeat_days, array[]::int[]) into v_repeat
  from public.tasks t where t.id = p_task_id;

  if v_repeat is null or array_length(v_repeat, 1) is null then
    return query select 0, 0, array[]::int[];
    return;
  end if;

  select coalesce(array_agg(d order by d), array[]::date[]) into v_eval
  from (
    select distinct (cr.created_at at time zone 'Asia/Shanghai')::date as d
    from public.coin_records cr
    where cr.member_id = p_member_id
      and cr.category = 'task'
      and cr.ref_id = p_task_id
      and (cr.created_at at time zone 'Asia/Shanghai')::date >= v_cutoff
  ) s;

  select coalesce(array_agg(d::date order by d), array[]::date[]) into v_req_dates
  from generate_series(v_cutoff, v_today, interval '1 day') g(d)
  where extract(dow from g.d::date)::int = any(v_repeat);

  foreach v_d in array v_req_dates loop
    if v_d = any(v_eval) then
      v_run := v_run + 1;
      v_best := greatest(v_best, v_run);
    elsif v_d >= v_today then
      -- 今天还没打卡，不算缺卡、不打断连续
      null;
    else
      if v_run > 0 then
        v_segs := v_segs || v_run;
        v_run := 0;
      end if;
    end if;
  end loop;

  -- 仍在进行中的最后一段
  if v_run > 0 then
    v_segs := v_segs || v_run;
  end if;

  return query select v_run, greatest(v_best, v_run), v_segs;
end;
$$;

-- ============================================================
-- 2. 勋章判定：streak 改为按连续天数
-- ============================================================
create or replace function public.sync_member_medals(p_member_id uuid)
returns int
language plpgsql security definer as $$
declare
  v_family uuid;
  v_task record;
  v_medal record;
  v_stats record;
  v_total int;
  v_target int;
  v_current int;
  v_existing int;
  v_day date;
  v_day_count int;
  v_awards int := 0;
begin
  select family_id into v_family from public.members where id = p_member_id;
  if v_family is null then return 0; end if;

  -- ---------- 连续打卡：按应打卡日的连续天数判定 ----------
  for v_task in
    select t.id
    from public.tasks t
    where t.family_id = v_family
      and array_length(coalesce(t.repeat_days, array[]::int[]), 1) is not null
      and exists (
        select 1 from public.coin_records cr
        where cr.member_id = p_member_id and cr.category = 'task' and cr.ref_id = t.id
      )
  loop
    select * into v_stats from public.calc_task_streak(v_task.id, p_member_id);

    for v_medal in
      select * from public.medals
      where family_id = v_family and is_active and series = 'streak'
    loop
      -- 该任务应获得的勋章总数：各连续段长度整除阈值的和
      select coalesce(sum(floor(s::numeric / greatest(v_medal.threshold, 1))), 0)
      into v_target
      from unnest(coalesce(v_stats.segments, array[]::int[])) s;

      -- 已发放数量（含旧规则发放记录，历史保留不回滚）
      select count(*) into v_existing
      from public.medal_awards a
      where a.member_id = p_member_id
        and a.medal_id = v_medal.id
        and a.award_key like 'streak:' || v_task.id || ':%';

      while v_existing < v_target loop
        v_existing := v_existing + 1;
        if public.award_medal(
          p_member_id, v_medal.id,
          'streak:' || v_task.id || ':n' || v_existing
        ) then
          v_awards := v_awards + 1;
        end if;
      end loop;
    end loop;
  end loop;

  -- ---------- 分类集齐：累计完成次数达到阈值 ----------
  for v_medal in
    select * from public.medals
    where family_id = v_family and is_active and series = 'collect'
  loop
    select count(*) into v_total
    from public.coin_records cr
    join public.tasks t on t.id = cr.ref_id
    where cr.member_id = p_member_id
      and cr.category = 'task'
      and t.subcategory = v_medal.subcategory;

    v_target := floor(coalesce(v_total, 0) / greatest(v_medal.threshold, 1));
    select coalesce(m.count, 0) into v_current
    from public.member_medals m
    where m.member_id = p_member_id and m.medal_id = v_medal.id;
    v_current := coalesce(v_current, 0);

    while v_current < v_target loop
      v_current := v_current + 1;
      if public.award_medal(p_member_id, v_medal.id, 'collect:' || v_current) then
        v_awards := v_awards + 1;
      end if;
    end loop;
  end loop;

  -- ---------- 当日活跃：单日完成条数达到阈值 ----------
  for v_medal in
    select * from public.medals
    where family_id = v_family and is_active and series = 'daily'
  loop
    for v_day, v_day_count in
      select (cr.created_at at time zone 'Asia/Shanghai')::date as d, count(*)
      from public.coin_records cr
      where cr.member_id = p_member_id and cr.category = 'task'
      group by 1
      having count(*) >= v_medal.threshold
    loop
      if public.award_medal(p_member_id, v_medal.id, 'daily:' || v_day) then
        v_awards := v_awards + 1;
      end if;
    end loop;
  end loop;

  return v_awards;
end;
$$;

-- ============================================================
-- 3. 成就详情统计：日历日期 + 当前/历史最佳连续天数
-- ============================================================
create or replace function public.get_task_checkin_stats(
  p_task_id uuid, p_member_id uuid, p_days int default 21
)
returns table (dates date[], current_streak int, best_streak int)
language plpgsql security definer as $$
declare
  v_dates date[];
  v_today date := (now() at time zone 'Asia/Shanghai')::date;
  v_stats record;
begin
  select coalesce(array_agg(d order by d), array[]::date[]) into v_dates
  from (
    select distinct (cr.created_at at time zone 'Asia/Shanghai')::date as d
    from public.coin_records cr
    where cr.member_id = p_member_id
      and cr.category = 'task'
      and cr.ref_id = p_task_id
      and (cr.created_at at time zone 'Asia/Shanghai')::date >= v_today - (p_days - 1)
  ) s;

  select * into v_stats from public.calc_task_streak(p_task_id, p_member_id);

  return query select v_dates, coalesce(v_stats.current_days, 0), coalesce(v_stats.best_days, 0);
end;
$$;

-- ============================================================
-- 4. 勋章进度总览：streak 改为连续天数
-- ============================================================
create or replace function public.get_medal_progress(p_member_id uuid)
returns table(medal_id uuid, series text, current_value int, target_value int, detail jsonb)
language plpgsql security definer as $$
declare
  v_family uuid;
  v_medal record;
  v_task record;
  v_stats record;
  v_total int;
  v_today_cnt int;
  v_today date := (now() at time zone 'Asia/Shanghai')::date;
  v_tasks jsonb;
  v_best int;
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
          )
        order by t.title
      loop
        select * into v_stats from public.calc_task_streak(v_task.id, p_member_id);
        v_best := greatest(v_best, v_stats.current_days);
        v_tasks := v_tasks || jsonb_build_object(
          'task_id', v_task.id,
          'title', v_task.title,
          'current_days', v_stats.current_days,
          'best_days', v_stats.best_days,
          'gap_days', greatest(v_medal.threshold - v_stats.current_days, 0)
        );
      end loop;
      return query select v_medal.id, v_medal.series, v_best, v_medal.threshold, v_tasks;
    end if;
  end loop;
end;
$$;

-- ============================================================
-- 5. 三枚坚持勋章：阈值改 7/14/21 天
-- ============================================================
update public.medal_templates
set threshold = 7, tier = '7天',
    condition_text = '连续7天完成所有应打卡日（未配置的星期自动跳过）',
    description = '连续7个应打卡日全部完成，好习惯正式启程！',
    updated_at = now()
where code = '01';

update public.medal_templates
set threshold = 14, tier = '14天',
    condition_text = '连续14天完成所有应打卡日（未配置的星期自动跳过）',
    description = '连续14个应打卡日全部完成，自律能力稳步提升，这份坚持超难得！',
    updated_at = now()
where code = '02';

update public.medal_templates
set threshold = 21, tier = '21天',
    condition_text = '连续21天完成所有应打卡日（未配置的星期自动跳过）',
    description = '连续21个应打卡日全部完成，把一件事变成长期习惯，你就是习惯养成小大师！',
    updated_at = now()
where code = '03';

update public.medals
set name = t.name, threshold = t.threshold, tier = t.tier,
    condition_text = t.condition_text, description = t.description,
    updated_at = now()
from public.medal_templates t
where medals.code = t.code
  and medals.series = 'streak'
  and t.code in ('01','02','03');

-- ============================================================
-- 6. 回溯重算
-- ============================================================
do $$
declare r record;
begin
  for r in select id from public.members where role = 'child' loop
    perform public.sync_member_medals(r.id);
  end loop;
end;
$$;
