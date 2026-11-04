-- 0299: 勋章「连续打卡」改为按任务配置的打卡周期判定
-- 规则生效日：2026-11-04（所在周 2026-11-02 起算），历史打卡不回算、不回收。
--
-- 新规则：
--   以任务 repeat_days 配置的星期为准，一个自然周（周一至周日）为一个完整周期；
--   周期内所有应打卡日全部完成 —— 该周期坚持成功；未配置的星期跳过、不算缺卡；
--   连续成功的周期数 >= 勋章阈值（1/2/3 周）即发放；断一期则连续数清零重新累计。

-- ============================================================
-- 1. 三枚坚持勋章：名称 / 阈值 / 文案更新
-- ============================================================
update public.medal_templates
set name = '一周坚持之星',
    threshold = 1,
    tier = '一周（1个周期）',
    condition_text = '按任务配置的打卡周期，1个完整周期内应打卡日全部完成',
    description = '在一个完整打卡周期内坚持完成所有应打卡日，好习惯正式启程！',
    updated_at = now()
where code = '01';

update public.medal_templates
set threshold = 2,
    tier = '两周（2个周期）',
    condition_text = '连续2个完整打卡周期，每期内应打卡日全部完成',
    description = '连续两个周期坚持完成应打卡日，自律能力稳步提升，这份坚持超难得！',
    updated_at = now()
where code = '02';

update public.medal_templates
set threshold = 3,
    tier = '三周（3个周期）',
    condition_text = '连续3个完整打卡周期，每期内应打卡日全部完成',
    description = '连续三个周期坚持完成应打卡日，把一件事变成长期习惯，你就是习惯养成小大师！',
    updated_at = now()
where code = '03';

-- 同步已复制到各家庭的个人勋章库（仅更新规则相关字段，保留自定义图标/奖励配置）
update public.medals
set name = t.name, threshold = t.threshold, tier = t.tier,
    condition_text = t.condition_text, description = t.description,
    updated_at = now()
from public.medal_templates t
where medals.code = t.code
  and medals.series = 'streak'
  and t.code in ('01','02','03');

-- ============================================================
-- 2. 全量判定：streak 改为「周期坚持」
-- ============================================================
create or replace function public.sync_member_medals(p_member_id uuid)
returns int
language plpgsql security definer as $$
declare
  v_family uuid;
  v_task record;
  v_medal record;
  v_dates date[];
  v_eval_dates date[];
  v_repeat int[];
  v_total int;
  v_target int;
  v_current int;
  v_day date;
  v_day_count int;
  v_awards int := 0;
  -- 规则生效日所在周的周一
  v_cutoff_week date := date_trunc('week', date '2026-11-04')::date;
  v_today date := (now() at time zone 'Asia/Shanghai')::date;
  v_cur_week date := date_trunc('week', (now() at time zone 'Asia/Shanghai')::date)::date;
  v_week date;
  v_w int;
  v_req date;
  v_missing int;
  v_due_missing int;
  v_run int;
  v_seg_start date;
begin
  select family_id into v_family from public.members where id = p_member_id;
  if v_family is null then return 0; end if;

  -- ---------- 周期坚持：按任务自身配置的打卡星期判定 ----------
  for v_task in
    select t.id, coalesce(t.repeat_days, array[]::int[]) as repeat_days
    from public.tasks t
    where t.family_id = v_family
      and array_length(coalesce(t.repeat_days, array[]::int[]), 1) is not null
      and exists (
        select 1 from public.coin_records cr
        where cr.member_id = p_member_id and cr.category = 'task' and cr.ref_id = t.id
          and (cr.created_at at time zone 'Asia/Shanghai')::date >= v_cutoff_week
      )
  loop
    v_repeat := v_task.repeat_days;

    select array_agg(d order by d) into v_eval_dates
    from (
      select distinct (cr.created_at at time zone 'Asia/Shanghai')::date as d
      from public.coin_records cr
      where cr.member_id = p_member_id and cr.category = 'task' and cr.ref_id = v_task.id
    ) s
    where s.d >= v_cutoff_week;

    if v_eval_dates is null then continue; end if;

    v_run := 0;
    v_seg_start := null;
    v_week := v_cutoff_week;

    while v_week <= v_cur_week loop
      v_missing := 0;
      v_due_missing := 0;
      foreach v_w in array v_repeat loop
        -- repeat_days: 0=周日...6=周六；周偏移 0=周一...6=周日
        v_req := v_week + ((v_w + 6) % 7);
        if not (v_req = any(v_eval_dates)) then
          v_missing := v_missing + 1;
          if v_req < v_today then
            v_due_missing := v_due_missing + 1;
          end if;
        end if;
      end loop;

      if v_missing = 0 then
        v_run := v_run + 1;
        if v_seg_start is null then v_seg_start := v_week; end if;
      elsif v_week = v_cur_week and v_due_missing = 0 then
        -- 当前周期尚未结束（仍有应打卡日未到期），保留连续数，等待后续打卡
        exit;
      else
        v_run := 0;
        v_seg_start := null;
      end if;

      v_week := v_week + 7;
    end loop;

    if v_seg_start is not null and v_run > 0 then
      for v_medal in
        select * from public.medals
        where family_id = v_family and is_active and series = 'streak'
      loop
        if v_run >= v_medal.threshold then
          if public.award_medal(p_member_id, v_medal.id,
              'streak:' || v_task.id || ':w' || to_char(v_seg_start, 'YYYYMMDD')) then
            v_awards := v_awards + 1;
          end if;
        end if;
      end loop;
    end if;
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
-- 3. 成就详情统计：日历日期 + 当前/历史最佳「连续成功周期数」
-- ============================================================
create or replace function public.get_task_checkin_stats(
  p_task_id uuid, p_member_id uuid, p_days int default 21
)
returns table (dates date[], current_streak int, best_streak int)
language plpgsql security definer as $$
declare
  v_dates date[];
  v_eval_dates date[];
  v_repeat int[];
  v_today date := (now() at time zone 'Asia/Shanghai')::date;
  v_cutoff_week date := date_trunc('week', date '2026-11-04')::date;
  v_cur_week date := date_trunc('week', (now() at time zone 'Asia/Shanghai')::date)::date;
  v_week date;
  v_w int;
  v_req date;
  v_missing int;
  v_due_missing int;
  v_run int := 0;
  v_best int := 0;
  v_cur int := 0;
begin
  -- 日历展示：近 p_days 天打卡日期
  select array_agg(d order by d) into v_dates
  from (
    select distinct (cr.created_at at time zone 'Asia/Shanghai')::date as d
    from public.coin_records cr
    where cr.member_id = p_member_id
      and cr.category = 'task'
      and cr.ref_id = p_task_id
      and (cr.created_at at time zone 'Asia/Shanghai')::date >= v_today - (p_days - 1)
  ) s;
  v_dates := coalesce(v_dates, array[]::date[]);

  select coalesce(t.repeat_days, array[]::int[]) into v_repeat
  from public.tasks t where t.id = p_task_id;

  if v_repeat is null or array_length(v_repeat, 1) is null then
    return query select v_dates, 0, 0;
    return;
  end if;

  select array_agg(d order by d) into v_eval_dates
  from (
    select distinct (cr.created_at at time zone 'Asia/Shanghai')::date as d
    from public.coin_records cr
    where cr.member_id = p_member_id
      and cr.category = 'task'
      and cr.ref_id = p_task_id
  ) s
  where s.d >= v_cutoff_week;

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
      v_best := greatest(v_best, v_run);
      v_cur := v_run;
    elsif v_week = v_cur_week and v_due_missing = 0 then
      exit;
    else
      v_run := 0;
      v_cur := 0;
    end if;

    v_week := v_week + 7;
  end loop;

  return query select v_dates, v_cur, v_best;
end;
$$;

-- 回溯：对已有打卡记录的孩子按新规则重算（仅从生效周开始，不会回收已发勋章）
do $$
declare r record;
begin
  for r in select id from public.members where role = 'child' loop
    perform public.sync_member_medals(r.id);
  end loop;
end;
$$;
