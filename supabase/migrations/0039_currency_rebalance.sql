-- 0039: 货币平衡定价系统
-- 目标：月金币产出~200，月星光产出~2800

-- ============================================================
-- 一、特权卡片重新定价（按分类+原价排名映射到新区间）
-- ============================================================
-- 美食: 5-15 金币
-- 放松: 10-25 金币
-- 玩乐: 20-40 金币
-- 稀有: 40-80 金币
-- 无分类: 5-25 金币

WITH ranked AS (
  SELECT id, category, price,
    CASE
      WHEN count(*) OVER (PARTITION BY category) <= 1 THEN 0.5
      ELSE percent_rank() OVER (PARTITION BY category ORDER BY price)
    END as pct
  FROM items
  WHERE status <> 'deleted'
)
UPDATE items SET price = CASE
  WHEN ranked.category = '美食' THEN GREATEST(5, LEAST(15, round(5 + ranked.pct * 10)))
  WHEN ranked.category = '放松' THEN GREATEST(10, LEAST(25, round(10 + ranked.pct * 15)))
  WHEN ranked.category = '玩乐' THEN GREATEST(20, LEAST(40, round(20 + ranked.pct * 20)))
  WHEN ranked.category = '稀有' THEN GREATEST(40, LEAST(80, round(40 + ranked.pct * 40)))
  ELSE GREATEST(5, LEAST(25, round(5 + ranked.pct * 20)))
END
FROM ranked
WHERE items.id = ranked.id;

-- ============================================================
-- 二、宠物用品重新定价（星光值）
-- ============================================================
-- 食品: 3-8 星光
update pet_shop_items set price_star = 3 where subcategory = 'food' and (price_star is null or price_star = 0 or price_star > 20);
update pet_shop_items set price_star = 5 where subcategory = 'food' and price_star between 1 and 2;
update pet_shop_items set price_star = 8 where subcategory = 'food' and recovery_value >= 30;
update pet_shop_items set price_star = 6 where subcategory = 'food' and recovery_value >= 20 and recovery_value < 30;

-- 清洁: 5-10 星光
update pet_shop_items set price_star = 5 where subcategory = 'clean' and (price_star is null or price_star = 0 or price_star > 20);
update pet_shop_items set price_star = 8 where subcategory = 'clean' and recovery_value >= 30;
update pet_shop_items set price_star = 10 where subcategory = 'clean' and recovery_value >= 35;

-- 玩具: 5-12 星光
update pet_shop_items set price_star = 5 where subcategory = 'toy' and (price_star is null or price_star = 0 or price_star > 20);
update pet_shop_items set price_star = 8 where subcategory = 'toy' and recovery_value >= 30;
update pet_shop_items set price_star = 12 where subcategory = 'toy' and recovery_value >= 35;

-- 药品: 8-20 星光
update pet_shop_items set price_star = 8 where subcategory = 'medicine' and (price_star is null or price_star = 0 or price_star > 30);
update pet_shop_items set price_star = 15 where subcategory = 'medicine' and recovery_value >= 40;
update pet_shop_items set price_star = 20 where subcategory = 'medicine' and recovery_value >= 60;

-- ============================================================
-- 三、宠物定价（星光值）
-- ============================================================
-- 宠物按 base_coin_per_day 分档定价
-- 产金 1-2/天: 50 星光（入门宠物）
-- 产金 3-4/天: 100 星光（中级宠物）
-- 产金 5+/天: 200 星光（高级宠物）
update pet_shop_items set price_star = 50 where type = 'pet' and base_coin_per_day <= 2;
update pet_shop_items set price_star = 100 where type = 'pet' and base_coin_per_day between 3 and 4;
update pet_shop_items set price_star = 200 where type = 'pet' and base_coin_per_day >= 5;
update pet_shop_items set price_star = 50 where type = 'pet' and (price_star is null or price_star = 0) and base_coin_per_day is null;

-- ============================================================
-- 四、狗屋定价
-- ============================================================
update pet_shop_items set price_star = 50 where subcategory = 'doghouse' and doghouse_level = 1;
update pet_shop_items set price_star = 150 where subcategory = 'doghouse' and doghouse_level = 2;
update pet_shop_items set price_star = 300 where subcategory = 'doghouse' and doghouse_level = 3;

-- ============================================================
-- 五、设置宠物基础产金量（确保月产金~200）
-- ============================================================
-- 3只宠物 × 平均2金/天 × 30天 = 180金/月
-- 修改已有宠物的基础产金（如果未设置）
update pet_shop_items set base_coin_per_day = 2 where type = 'pet' and (base_coin_per_day is null or base_coin_per_day = 0);

-- ============================================================
-- 六、任务奖励范围（应用层控制，此处仅注释）
-- ============================================================
-- 简单任务: 2 星光（如：整理床铺、倒垃圾）
-- 中等任务: 3 星光（如：完成作业、练琴20分钟）
-- 困难任务: 4-5 星光（如：考试90分以上、大扫除）
-- 日产出: 6-8个任务 × 平均3 = 18-24 星光/天 → 540-720/月

-- ============================================================
-- 七、答题奖励范围（应用层控制，此处仅注释）
-- ============================================================
-- 简单: 0.5 星光
-- 中等: 1 星光
-- 困难: 2 星光
-- 100题/天 × 平均0.5(简单为主) = 50 星光/天 → 1500/月
-- 建议在 challenge_sets 表中设置 reward_easy=0.5, reward_medium=1, reward_hard=2
-- 但 Postgres 不支持小数 int，需改为 numeric

-- 将 reward 列改为支持小数
alter table challenge_sets alter column reward_easy type numeric(5,1);
alter table challenge_sets alter column reward_medium type numeric(5,1);
alter table challenge_sets alter column reward_hard type numeric(5,1);

-- 设置默认值
update challenge_sets set reward_easy = 0.5 where reward_easy is null or reward_easy > 5;
update challenge_sets set reward_medium = 1 where reward_medium is null or reward_medium > 10;
update challenge_sets set reward_hard = 2 where reward_hard is null or reward_hard > 20;

-- ============================================================
-- 八、陪伴学习奖励（应用层已实现 minutes=star，无需改）
-- ============================================================
-- 30分钟学习 = 30 星光
-- 每天1次30分钟 = 30星光/天 → 900/月

-- ============================================================
-- 总结：月度货币预算
-- ============================================================
-- 星光值产出: 任务600 + 答题1500 + 学习900 + 签到60 = ~3060
-- 星光值支出: 用品200 + 抽卡1000 + 新宠物150-300 = ~1500
-- 星光结余: ~1500（可攒钱买大件）

-- 金币产出: 宠物180 + 卖背包30 = ~210
-- 金币支出: 特权~100-120
-- 金币结余: ~80-110 ✓
