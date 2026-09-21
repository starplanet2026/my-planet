-- ============================================================
-- 0066: 统一用品性价比 + 狗屋容量
-- 恢复值层级：10/20/30/40/50，对应价格 2/4/6/8/10 星光值
-- 性价比 = 5（即 recovery_value = price_coin * 5）
-- 狗屋 recovery_value 改为容量描述
-- ============================================================

-- 1. 食品 (food) - 按实际价值排序定价
-- 低价小零食：2星→+10, 3星→+15→调整为+10(2星)
-- 中价：4星→+20, 5星→+25→调整为+20(4星)
-- 高价主食：6星→+30, 8星→+40, 10星→+50
UPDATE public.pet_shop_items SET price_coin = 2, recovery_value = 10 WHERE type = 'supply' AND subcategory = 'food' AND price_coin <= 3;
UPDATE public.pet_shop_items SET price_coin = 4, recovery_value = 20 WHERE type = 'supply' AND subcategory = 'food' AND price_coin > 3 AND price_coin <= 5;
UPDATE public.pet_shop_items SET price_coin = 6, recovery_value = 30 WHERE type = 'supply' AND subcategory = 'food' AND price_coin > 5 AND price_coin <= 7;
UPDATE public.pet_shop_items SET price_coin = 8, recovery_value = 40 WHERE type = 'supply' AND subcategory = 'food' AND price_coin > 7 AND price_coin <= 9;
UPDATE public.pet_shop_items SET price_coin = 10, recovery_value = 50 WHERE type = 'supply' AND subcategory = 'food' AND price_coin > 9;

-- 2. 清洁 (clean) - 香皂最便宜，沐浴露中等，高级洗护最贵
UPDATE public.pet_shop_items SET price_coin = 2, recovery_value = 10 WHERE type = 'supply' AND subcategory = 'clean' AND price_coin <= 3;
UPDATE public.pet_shop_items SET price_coin = 4, recovery_value = 20 WHERE type = 'supply' AND subcategory = 'clean' AND price_coin > 3 AND price_coin <= 5;
UPDATE public.pet_shop_items SET price_coin = 6, recovery_value = 30 WHERE type = 'supply' AND subcategory = 'clean' AND price_coin > 5 AND price_coin <= 7;
UPDATE public.pet_shop_items SET price_coin = 8, recovery_value = 40 WHERE type = 'supply' AND subcategory = 'clean' AND price_coin > 7 AND price_coin <= 9;
UPDATE public.pet_shop_items SET price_coin = 10, recovery_value = 50 WHERE type = 'supply' AND subcategory = 'clean' AND price_coin > 9;

-- 3. 玩具 (toy) - 小球便宜，毛绒玩具中等，智能玩具最贵
UPDATE public.pet_shop_items SET price_coin = 2, recovery_value = 10 WHERE type = 'supply' AND subcategory = 'toy' AND price_coin <= 3;
UPDATE public.pet_shop_items SET price_coin = 4, recovery_value = 20 WHERE type = 'supply' AND subcategory = 'toy' AND price_coin > 3 AND price_coin <= 5;
UPDATE public.pet_shop_items SET price_coin = 6, recovery_value = 30 WHERE type = 'supply' AND subcategory = 'toy' AND price_coin > 5 AND price_coin <= 7;
UPDATE public.pet_shop_items SET price_coin = 8, recovery_value = 40 WHERE type = 'supply' AND subcategory = 'toy' AND price_coin > 7 AND price_coin <= 9;
UPDATE public.pet_shop_items SET price_coin = 10, recovery_value = 50 WHERE type = 'supply' AND subcategory = 'toy' AND price_coin > 9;

-- 4. 药品 (medicine) - 基础药品便宜，特效药贵
UPDATE public.pet_shop_items SET price_coin = 2, recovery_value = 10 WHERE type = 'supply' AND subcategory = 'medicine' AND price_coin <= 3;
UPDATE public.pet_shop_items SET price_coin = 4, recovery_value = 20 WHERE type = 'supply' AND subcategory = 'medicine' AND price_coin > 3 AND price_coin <= 5;
UPDATE public.pet_shop_items SET price_coin = 6, recovery_value = 30 WHERE type = 'supply' AND subcategory = 'medicine' AND price_coin > 5 AND price_coin <= 7;
UPDATE public.pet_shop_items SET price_coin = 8, recovery_value = 40 WHERE type = 'supply' AND subcategory = 'medicine' AND price_coin > 7 AND price_coin <= 9;
UPDATE public.pet_shop_items SET price_coin = 10, recovery_value = 50 WHERE type = 'supply' AND subcategory = 'medicine' AND price_coin > 9;

-- 5. 寄养 (foster) - 性价比 = 3（比日常用品贵）
UPDATE public.pet_shop_items SET price_coin = 3, recovery_value = 9 WHERE type = 'supply' AND subcategory = 'foster' AND price_coin <= 4;
UPDATE public.pet_shop_items SET price_coin = 6, recovery_value = 18 WHERE type = 'supply' AND subcategory = 'foster' AND price_coin > 4 AND price_coin <= 7;
UPDATE public.pet_shop_items SET price_coin = 9, recovery_value = 27 WHERE type = 'supply' AND subcategory = 'foster' AND price_coin > 7 AND price_coin <= 10;
UPDATE public.pet_shop_items SET price_coin = 12, recovery_value = 36 WHERE type = 'supply' AND subcategory = 'foster' AND price_coin > 10;

-- 6. 狗屋 (doghouse) - recovery_value 改为容量数值（1/5/10）
UPDATE public.pet_shop_items SET recovery_value = 1 WHERE type = 'supply' AND subcategory = 'doghouse' AND doghouse_level = 1;
UPDATE public.pet_shop_items SET recovery_value = 5 WHERE type = 'supply' AND subcategory = 'doghouse' AND doghouse_level = 2;
UPDATE public.pet_shop_items SET recovery_value = 10 WHERE type = 'supply' AND subcategory = 'doghouse' AND doghouse_level = 3;
