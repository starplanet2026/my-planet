-- ============================================================
-- 0214: 猫-史诗宠物最高等级从30调整为25
-- 仅影响 subcategory='cat' AND rarity='epic' 的商品
-- ============================================================

update public.pet_shop_items
set max_level = 25
where subcategory = 'cat'
  and rarity = 'epic'
  and max_level <> 25;

-- 同步已领养的史诗猫的 max_level
update public.pets p
set max_level = 25
from public.pet_shop_items psi
where p.shop_item_id = psi.id
  and psi.subcategory = 'cat'
  and psi.rarity = 'epic'
  and p.max_level <> 25;

-- 若已升级超过25级，回退等级到25并保留经验
update public.pets p
set level = 25
from public.pet_shop_items psi
where p.shop_item_id = psi.id
  and psi.subcategory = 'cat'
  and psi.rarity = 'epic'
  and p.level > 25;

notify pgrst, 'reload schema';
