-- ============================================================
-- 0066: 用品只用星光值 + 5层恢复值体系
-- 规则：恢复值 10/20/30/40/50，对应价格 2/4/6/8/10 星光值
-- 金币价格 price_coin 全部清零（只用星光值）
-- ============================================================

-- 1. 所有用品的金币价格清零
UPDATE public.pet_shop_items
SET price_coin = 0
WHERE type = 'supply';

-- 2. 按恢复值层级重新设置价格和恢复值
-- 食品/清洁/玩具/药品：性价比5（恢复值 = 价格 * 5）
-- 寄养：性价比3（恢复值 = 价格 * 3）

-- 先把现有恢复值归档到最近的层级（10/20/30/40/50）
-- 然后按层级设置星光值价格

-- 食品/清洁/玩具/药品
UPDATE public.pet_shop_items
SET recovery_value = 10, price_star = 2
WHERE type = 'supply' AND subcategory IN ('food', 'clean', 'toy', 'medicine')
  AND recovery_value <= 15;

UPDATE public.pet_shop_items
SET recovery_value = 20, price_star = 4
WHERE type = 'supply' AND subcategory IN ('food', 'clean', 'toy', 'medicine')
  AND recovery_value > 15 AND recovery_value <= 25;

UPDATE public.pet_shop_items
SET recovery_value = 30, price_star = 6
WHERE type = 'supply' AND subcategory IN ('food', 'clean', 'toy', 'medicine')
  AND recovery_value > 25 AND recovery_value <= 35;

UPDATE public.pet_shop_items
SET recovery_value = 40, price_star = 8
WHERE type = 'supply' AND subcategory IN ('food', 'clean', 'toy', 'medicine')
  AND recovery_value > 35 AND recovery_value <= 45;

UPDATE public.pet_shop_items
SET recovery_value = 50, price_star = 10
WHERE type = 'supply' AND subcategory IN ('food', 'clean', 'toy', 'medicine')
  AND recovery_value > 45;

-- 寄养（性价比3）
UPDATE public.pet_shop_items
SET recovery_value = 10, price_star = 3
WHERE type = 'supply' AND subcategory = 'foster'
  AND recovery_value <= 15;

UPDATE public.pet_shop_items
SET recovery_value = 20, price_star = 6
WHERE type = 'supply' AND subcategory = 'foster'
  AND recovery_value > 15 AND recovery_value <= 25;

UPDATE public.pet_shop_items
SET recovery_value = 30, price_star = 9
WHERE type = 'supply' AND subcategory = 'foster'
  AND recovery_value > 25 AND recovery_value <= 35;

UPDATE public.pet_shop_items
SET recovery_value = 40, price_star = 12
WHERE type = 'supply' AND subcategory = 'foster'
  AND recovery_value > 35 AND recovery_value <= 45;

UPDATE public.pet_shop_items
SET recovery_value = 50, price_star = 15
WHERE type = 'supply' AND subcategory = 'foster'
  AND recovery_value > 45;

-- 3. 狗屋 recovery_value 改为容量数值（1/5/10）
UPDATE public.pet_shop_items SET recovery_value = 1 WHERE type = 'supply' AND subcategory = 'doghouse' AND doghouse_level = 1;
UPDATE public.pet_shop_items SET recovery_value = 5 WHERE type = 'supply' AND subcategory = 'doghouse' AND doghouse_level = 2;
UPDATE public.pet_shop_items SET recovery_value = 10 WHERE type = 'supply' AND subcategory = 'doghouse' AND doghouse_level = 3;
