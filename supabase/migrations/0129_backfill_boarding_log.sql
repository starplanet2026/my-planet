-- 0129: 回填托管历史明细
-- 问题：0128 之前执行的托管结算未记录到 pet_boarding_log，导致前端"今日已托管X只"
--       点击后显示"暂无托管记录"。
-- 修复：从 pet_boarding（已有托管记录）+ pet_daily_exp_log（经验日志）回填明细。
-- 说明：stat gains 为估算值（取当日 exp_log 中对应 full_count 是否达标判断
--       托管是否补满了该项属性，达标则记 100，否则记 0）；后续新结算按 0128 精确记录。

insert into public.pet_boarding_log
  (family_id, member_id, pet_id, board_date,
   hunger_gain, clean_gain, happiness_gain, exp_gain, coin_gain)
select
  pb.family_id,
  pb.member_id,
  pb.pet_id,
  pb.board_date,
  -- 体力增加值：exp_log 中 hunger_full_count >= 1 说明托管补满了体力
  case when coalesce(el.hunger_full_count, 0) >= 1 then 100 else 0 end,
  -- 清洁增加值
  case when coalesce(el.clean_full_count, 0) >= 1 then 100 else 0 end,
  -- 心情增加值：托管会一次性将 mood_full_count 置为 3
  case when coalesce(el.mood_full_count, 0) >= 3 then 100 else 0 end,
  -- 经验增加值：重建逻辑与 run_daily_boarding_care 一致
  least(50,
    (case when coalesce(el.hunger_full_count, 0) >= 1 then 10 else 0 end
    + case when coalesce(el.clean_full_count, 0) >= 1 then 10 else 0 end
    + case when coalesce(el.mood_full_count, 0) >= 3 then 10 else 0 end)
  ),
  -- 金币收益：按宠物当日等级公式估算
  coalesce(p.base_coin_per_day, 0)
    * (1.0 + coalesce(p.upgrade_percent, 10.0) / 100.0 * (coalesce(p.level, 1) - 1))
from public.pet_boarding pb
join public.pets p on p.id = pb.pet_id
left join public.pet_daily_exp_log el
  on el.pet_id = pb.pet_id and el.log_date = pb.board_date
where not exists (
  select 1 from public.pet_boarding_log bl
  where bl.member_id = pb.member_id
    and bl.pet_id = pb.pet_id
    and bl.board_date = pb.board_date
)
on conflict (member_id, pet_id, board_date) do nothing;

-- 验证回填结果
do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.pet_boarding_log;
  raise notice '回填完成，pet_boarding_log 共 % 条记录', v_count;
end $$;
