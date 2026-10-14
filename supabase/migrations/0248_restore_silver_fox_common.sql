-- 0248: 方案B - 还原银狐犬商品设计值，并使「普通升级测试」宠物回归普通稀有度（两边一致）
-- 背景：0247 曾按宠物当前稀有度把银狐犬模板对齐为 rare；现改为还原为设计值 common，
--       同时把该宠物改回 common（level=10=max_level=10 的普通满级态），确保数据一致且不改变商品定义。

update public.pet_shop_items
   set rarity = 'common', max_level = 10
 where id = 'e64f4b77-ccdf-4173-979b-71c449e1b52f';

update public.pets
   set rarity = 'common',
       max_level = 10,
       exp_to_next = case when level < 10 then public.exp_needed(level, 'common') else 0 end,
       pending_levelup = false
 where id = 'e9b4c1b4-dba0-4d69-869f-ad24f4d70e87';

notify pgrst, 'reload schema';
