-- 0257_sync_pet_species_attrs.sql
-- 工单：布偶猫女特质信息不一致 + 品种属性同步逻辑调整
-- 1) 全量巡检：对齐所有已领养宠物的品种自带属性（特质 trait_id、稀有度 rarity）与商店模板
-- 2) 新增数据库触发器：后台修改商店品种模板的特质/稀有度后，所有已领养同品种宠物自动同步
--    边界：仅同步品种自带属性（trait_id、rarity），用户个体数据（name/level/exp/health/is_studying 等）不受影响

-- ============ 1) 立即修正存量不一致 ============
update public.pets p
   set trait_id = s.trait_id,
       rarity   = s.rarity
  from public.pet_shop_items s
 where p.shop_item_id = s.id
   and (p.trait_id is distinct from s.trait_id
     or p.rarity   is distinct from s.rarity);

-- ============ 2) 触发器：模板 -> 已领养宠物 属性同步 ============
-- 函数内仅更新 trait_id / rarity 两列，不触碰任何个体数据字段
create or replace function public.sync_pet_species_attrs()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  -- 仅当品种自带属性发生变化时才同步，避免无谓的全表更新
  if new.trait_id is distinct from old.trait_id
     or new.rarity is distinct from old.rarity then
    update public.pets
       set trait_id = new.trait_id,
           rarity   = new.rarity
     where shop_item_id = new.id;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_sync_pet_species_attrs on public.pet_shop_items;
create trigger trg_sync_pet_species_attrs
after update of trait_id, rarity on public.pet_shop_items
for each row execute function public.sync_pet_species_attrs();
