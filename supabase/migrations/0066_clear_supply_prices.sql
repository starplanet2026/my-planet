-- 0066: 清空用品价格和恢复值，让用户从后台自行填写
-- 只清空 type='supply' 的 price_star 和 recovery_value
-- price_coin 已经是 0（之前迁移清零的）

UPDATE public.pet_shop_items
SET price_star = 0, recovery_value = 0, price_coin = 0
WHERE type = 'supply';
