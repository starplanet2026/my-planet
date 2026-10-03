-- 0196: 修复宠物稀有度与等级上限不匹配
-- Bug: 史诗宠物 max_level=10（应为25），稀有度与等级上限错配
-- 正确配置（来自 0067）: common=10, rare=20, epic=25

-- ============================================================
-- 一、修正 pet_shop_items.max_level
-- ============================================================
update public.pet_shop_items set max_level = 10
  where type = 'pet' and rarity = 'common' and coalesce(max_level, 0) <> 10;

update public.pet_shop_items set max_level = 20
  where type = 'pet' and rarity = 'rare' and coalesce(max_level, 0) <> 20;

update public.pet_shop_items set max_level = 25
  where type = 'pet' and rarity = 'epic' and coalesce(max_level, 0) <> 25;

-- ============================================================
-- 二、修正 pets.max_level
-- ============================================================
update public.pets set max_level = 10
  where rarity = 'common' and coalesce(max_level, 0) <> 10;

update public.pets set max_level = 20
  where rarity = 'rare' and coalesce(max_level, 0) <> 20;

update public.pets set max_level = 25
  where rarity = 'epic' and coalesce(max_level, 0) <> 25;

-- ============================================================
-- 三、修复 buy_pet_item：领养时确保 max_level 从商店物品正确复制
--    （现有逻辑已用 coalesce(v_item.max_level, 3)，无需改函数，
--     只需确保商店物品 max_level 正确即可，上面已修复）
-- ============================================================

notify pgrst, 'reload schema';
