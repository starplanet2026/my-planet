-- 0290: 补录 2026-10-22（昨天）全部宠物的互动记录
-- 背景：pet_interaction_logs 于 2026-10-23 才上线，昨天的互动没有写入日志。
-- 数据来源（可考证部分）：
--   1. 托管：pet_boarding_log.board_date = 2026-10-22 的 hunger_gain / clean_gain / happiness_gain 为精确值
--   2. 手动互动：每日重置（23:59）会把属性归零到特质初始值，因此
--      pet_daily_exp_log 中每满 1 次即代表该血条从初始值补满（约 +100）
--      hunger_full_count / clean_full_count / mood_full_count 各 ×100
-- 说明：托管已把血条补满的宠物，当天手动互动不会产生实际增量，故不重复计入。

do $$
declare
  v_dt date := date '2026-10-22';
begin
  -- 1. 托管补满（精确值）
  insert into public.pet_interaction_logs
    (member_id, pet_id, action, hunger_delta, clean_delta, happiness_delta, health_delta, created_at)
  select b.member_id, b.pet_id, 'boarding',
         greatest(coalesce(b.hunger_gain, 0), 0),
         greatest(coalesce(b.clean_gain, 0), 0),
         greatest(coalesce(b.happiness_gain, 0), 0),
         0,
         (v_dt + time '01:00') at time zone 'Asia/Shanghai'
  from public.pet_boarding_log b
  where b.board_date = v_dt
    and not exists (
      select 1 from public.pet_interaction_logs l
      where l.pet_id = b.pet_id
        and l.action = 'boarding'
        and (l.created_at at time zone 'Asia/Shanghai')::date = v_dt
    );

  -- 2. 手动互动补录（按满血次数还原增量）
  insert into public.pet_interaction_logs
    (member_id, pet_id, action, hunger_delta, clean_delta, happiness_delta, health_delta, created_at)
  select p.member_id, l.pet_id, 'manual',
         least(100, coalesce(l.hunger_full_count, 0) * 100),
         least(100, coalesce(l.clean_full_count, 0) * 100),
         least(300, coalesce(l.mood_full_count, 0) * 100),
         0,
         l.created_at
  from public.pet_daily_exp_log l
  join public.pets p on p.id = l.pet_id
  where l.log_date = v_dt
    and (coalesce(l.hunger_full_count, 0) > 0
      or coalesce(l.clean_full_count, 0) > 0
      or coalesce(l.mood_full_count, 0) > 0)
    -- 当天已托管满属性的宠物，手动互动无实际增量
    and not exists (
      select 1 from public.pet_boarding_log b
      where b.pet_id = l.pet_id and b.board_date = v_dt
    )
    and not exists (
      select 1 from public.pet_interaction_logs x
      where x.pet_id = l.pet_id
        and (x.created_at at time zone 'Asia/Shanghai')::date = v_dt
    );
end $$;

-- 验证输出
select (created_at at time zone 'Asia/Shanghai')::date as log_date,
       count(*) as rows,
       sum(hunger_delta) as hunger,
       sum(clean_delta) as clean,
       sum(happiness_delta) as happiness
from public.pet_interaction_logs
where (created_at at time zone 'Asia/Shanghai')::date = date '2026-10-22'
group by 1;
