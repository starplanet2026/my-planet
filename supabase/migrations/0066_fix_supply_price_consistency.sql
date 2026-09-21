-- ============================================================
-- 0066: 统一用品性价比
-- 规则：同一子分类下，recovery_value / price_coin = 固定比率
-- 食品(food)→5/星, 清洁(clean)→5/星, 玩具(toy)→5/星, 药品(medicine)→5/星, 寄养(foster)→3/星
-- ============================================================

-- 1. 先查看当前数据（只读，不修改）
-- SELECT id, name, subcategory, price_coin, price_star, recovery_value,
--   CASE WHEN price_coin > 0 THEN round(recovery_value::numeric / price_coin, 2) ELSE 0 END as ratio
-- FROM public.pet_shop_items
-- WHERE type = 'supply' AND price_coin > 0
-- ORDER BY subcategory, price_coin;

-- 2. 统一性价比：recovery_value = price_coin * 固定比率
-- food/clean/toy/medicine: 5 倍；foster: 3 倍
UPDATE public.pet_shop_items
SET recovery_value = price_coin * 5
WHERE type = 'supply'
  AND subcategory IN ('food', 'clean', 'toy', 'medicine')
  AND price_coin > 0;

UPDATE public.pet_shop_items
SET recovery_value = price_coin * 3
WHERE type = 'supply'
  AND subcategory = 'foster'
  AND price_coin > 0;

-- 3. 星光值定价的用品也统一（如果有的话）
UPDATE public.pet_shop_items
SET recovery_value = price_star * 5
WHERE type = 'supply'
  AND subcategory IN ('food', 'clean', 'toy', 'medicine')
  AND price_coin = 0
  AND price_star > 0;

UPDATE public.pet_shop_items
SET recovery_value = price_star * 3
WHERE type = 'supply'
  AND subcategory = 'foster'
  AND price_coin = 0
  AND price_star > 0;

-- 4. 狗屋不做调整（无 recovery_value 概念）
