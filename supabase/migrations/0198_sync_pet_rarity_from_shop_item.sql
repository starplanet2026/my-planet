-- 0198: 同步已领养宠物的 rarity / max_level 与商店物品一致
-- Bug: 商店物品稀有度从 common 改为 rare 后，已领养宠物的 rarity 仍为 common，
--       导致【我的宠物】显示"普通"但 max_level 已被 0196 修正为 20（稀有），前后矛盾。
-- 修复: 将 pets.rarity 和 pets.max_level 同步为对应商店物品的当前值。

-- 同步 pets.rarity
update public.pets p
set rarity = i.rarity
from public.pet_shop_items i
where p.shop_item_id = i.id
  and i.rarity is not null
  and coalesce(p.rarity, '') <> i.rarity;

-- 同步 pets.max_level（0196 已做过，这里再补一次确保与 rarity 对齐）
update public.pets p
set max_level = i.max_level
from public.pet_shop_items i
where p.shop_item_id = i.id
  and i.max_level is not null
  and coalesce(p.max_level, 0) <> i.max_level;

notify pgrst, 'reload schema';
