-- 0258_pet_insert_carry_species_attrs.sql
-- 真正的根因修复：领养（写入 pets）时未携带品种自带属性
-- 背景：
--   0200 新增 pets.trait_id 列（无 DEFAULT），但只回填了当时存量数据，
--   buy_pet_item / gacha_adopt 的 INSERT 列清单始终不含 trait_id（gacha_adopt 还漏了 rarity），
--   导致此后所有通过这两条 RPC 领养的宠物 trait_id 恒为 NULL → 与商店模板不一致。
-- 修复：在 pets 上加 BEFORE INSERT 触发器，从对应 pet_shop_items 模板复制
--       trait_id / rarity 到新宠物行。覆盖买宠、抽卡领养及任何未来写入路径。
-- 边界：仅复制品种自带属性（trait_id、rarity），不影响 name/level/exp/health 等个体字段。

create or replace function public.set_pet_species_attrs_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_trait_id uuid;
  v_rarity   text;
begin
  if new.shop_item_id is not null then
    select s.trait_id, s.rarity
      into v_trait_id, v_rarity
      from public.pet_shop_items s
     where s.id = new.shop_item_id;

    if found then
      new.trait_id := v_trait_id;
      new.rarity   := v_rarity;
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_set_pet_species_attrs_on_insert on public.pets;
create trigger trg_set_pet_species_attrs_on_insert
before insert on public.pets
for each row execute function public.set_pet_species_attrs_on_insert();
