-- 0218: 回溯执行今日的属性重置 + 托管养护
-- 背景：run_daily_global_pet_reset 的 cron 之前未调度（0216 才补上），
--       导致宠物属性未重置，托管养护计算属性缺口为 0，星光值未扣除。
-- 本迁移一次性回溯今日数据。
--
-- 执行顺序：
--   1. 清理今日已有的托管记录（若已执行过0扣费的空跑记录）
--   2. 执行全局属性重置（属性回到特质初始值）
--   3. 执行托管养护（按缺口扣除星光、补满属性、发放经验金币）
--
-- 注意：幂等保证——
--   - run_daily_global_pet_reset 检查 last_reset_date，已重置则跳过
--   - run_daily_boarding_care 检查 pet_boarding.board_date，已执行则跳过
--   所以重复执行本迁移不会重复扣费。

-- 步骤1：清理今日已有的托管记录（让 boarding care 能重新执行）
delete from public.pet_boarding_log where board_date = (now() at time zone 'Asia/Shanghai')::date;
delete from public.pet_boarding where board_date = (now() at time zone 'Asia/Shanghai')::date;

-- 步骤2：全局属性重置
select public.run_daily_global_pet_reset();

-- 步骤3：托管养护（扣除星光、补满属性、发放经验金币）
select public.run_daily_boarding_care();

-- 验证：今日托管扣费记录
select
  m.name as member_name,
  p.breed as pet_name,
  bl.board_date,
  bl.hunger_gain,
  bl.clean_gain,
  bl.happiness_gain,
  bl.stars_cost,
  bl.exp_gain,
  bl.coin_gain
from public.pet_boarding_log bl
join public.members m on m.id = bl.member_id
join public.pets p on p.id = bl.pet_id
where bl.board_date = (now() at time zone 'Asia/Shanghai')::date
order by bl.stars_cost desc;

notify pgrst, 'reload schema';
