-- 0033: 用品恢复值字段 + 基础用品数据 + interact_with_pet 使用 recovery_value
-- ============================================================

-- 1. 给 pet_shop_items 加 recovery_value 字段（用品恢复对应血条值）
alter table public.pet_shop_items add column if not exists recovery_value int default 20;

-- 2. 重写 interact_with_pet：使用商品的 recovery_value 而非固定 +20
drop function if exists public.interact_with_pet(uuid, uuid, text, uuid);
create or replace function public.interact_with_pet(
  p_member_id uuid,
  p_pet_id uuid,
  p_action text,
  p_item_id uuid
)
returns table(success boolean, message text, new_hunger int, new_clean int, new_happiness int, new_health int, inventory_qty int)
language plpgsql security definer as $$
declare
  v_pet public.pets%rowtype;
  v_inv public.pet_inventory%rowtype;
  v_item public.pet_shop_items%rowtype;
  v_required_sub text;
  v_msg text;
  v_recovery int := 20;
begin
  select * into v_pet from public.pets where id = p_pet_id for update;
  if not found then return query select false, '宠物不存在', 0, 0, 0, 0, 0; return; end if;
  if v_pet.member_id <> p_member_id then return query select false, '无权操作', 0, 0, 0, 0, 0; return; end if;

  -- action → subcategory 映射
  if p_action = 'feed' then v_required_sub := 'food';
  elsif p_action = 'clean' then v_required_sub := 'clean';
  elsif p_action = 'play' then v_required_sub := 'toy';
  elsif p_action = 'heal' then v_required_sub := 'medicine';
  else return query select false, '未知操作', 0, 0, 0, 0, 0; return; end if;

  -- 治疗需宠物生病
  if p_action = 'heal' and not v_pet.is_sick then
    return query select false, '宠物没有生病', v_pet.hunger, v_pet.clean, v_pet.happiness, v_pet.health, 0; return;
  end if;

  -- 校验背包物品
  select * into v_inv from public.pet_inventory where member_id = p_member_id and item_id = p_item_id for update;
  if not found or v_inv.quantity <= 0 then
    return query select false, '背包无此物品', v_pet.hunger, v_pet.clean, v_pet.happiness, v_pet.health, 0; return;
  end if;
  if v_inv.subcategory <> v_required_sub then
    return query select false, '物品类型不匹配', v_pet.hunger, v_pet.clean, v_pet.happiness, v_pet.health, v_inv.quantity; return;
  end if;

  -- 读取商品的 recovery_value
  select * into v_item from public.pet_shop_items where id = p_item_id;
  if found and v_item.recovery_value is not null then
    v_recovery := v_item.recovery_value;
  end if;

  -- 扣减背包物品
  v_inv.quantity := v_inv.quantity - 1;
  if v_inv.quantity <= 0 then
    delete from public.pet_inventory where id = v_inv.id;
  else
    update public.pet_inventory set quantity = v_inv.quantity where id = v_inv.id;
  end if;

  -- 更新宠物状态（用 recovery_value）
  if p_action = 'feed' then
    v_pet.hunger := least(100, v_pet.hunger + v_recovery);
    v_msg := '喂食成功，体力+' || v_recovery;
  elsif p_action = 'clean' then
    v_pet.clean := least(100, v_pet.clean + v_recovery);
    v_msg := '清洁成功，清洁+' || v_recovery;
  elsif p_action = 'play' then
    v_pet.happiness := least(100, v_pet.happiness + v_recovery);
    v_msg := '玩耍成功，心情+' || v_recovery;
  elsif p_action = 'heal' then
    v_pet.is_sick := false;
    v_pet.health := least(100, v_pet.health + v_recovery);
    v_pet.hunger := 50;
    v_pet.clean := 50;
    v_pet.happiness := 50;
    v_msg := '治疗成功，健康+' || v_recovery;
  end if;

  update public.pets set
    hunger = v_pet.hunger, clean = v_pet.clean, happiness = v_pet.happiness,
    health = v_pet.health, is_sick = v_pet.is_sick
  where id = p_pet_id;

  return query select true, v_msg, v_pet.hunger, v_pet.clean, v_pet.happiness, v_pet.health, v_inv.quantity;
end;
$$;

grant execute on function public.interact_with_pet(uuid, uuid, text, uuid) to anon, authenticated;

-- 3. 生成基础用品商品（需替换 'FAMILY_ID_HERE' 为实际 family_id）
-- 家长需在执行前替换 FAMILY_ID_HERE 为自己的 family_id
-- 食品
INSERT INTO public.pet_shop_items (family_id, type, subcategory, name, emoji, price_star, recovery_value, status, base_coin_per_day)
VALUES
  ('FAMILY_ID_HERE', 'supply', 'food', '狗粮', '🍖', 5, 25, 'active', 0),
  ('FAMILY_ID_HERE', 'supply', 'food', '罐头', '🥫', 10, 35, 'active', 0),
  ('FAMILY_ID_HERE', 'supply', 'food', '鸡腿', '🍗', 8, 30, 'active', 0),
  ('FAMILY_ID_HERE', 'supply', 'food', '牛奶', '🥛', 5, 20, 'active', 0),
  ('FAMILY_ID_HERE', 'supply', 'food', '饼干', '🍪', 3, 15, 'active', 0);

-- 清洁用品
INSERT INTO public.pet_shop_items (family_id, type, subcategory, name, emoji, price_star, recovery_value, status, base_coin_per_day)
VALUES
  ('FAMILY_ID_HERE', 'supply', 'clean', '香皂', '🧼', 5, 25, 'active', 0),
  ('FAMILY_ID_HERE', 'supply', 'clean', '沐浴露', '🧴', 10, 35, 'active', 0),
  ('FAMILY_ID_HERE', 'supply', 'clean', '毛巾', '🧖', 5, 20, 'active', 0);

-- 玩具
INSERT INTO public.pet_shop_items (family_id, type, subcategory, name, emoji, price_star, recovery_value, status, base_coin_per_day)
VALUES
  ('FAMILY_ID_HERE', 'supply', 'toy', '网球', '🎾', 5, 25, 'active', 0),
  ('FAMILY_ID_HERE', 'supply', 'toy', '飞盘', '🥏', 10, 35, 'active', 0),
  ('FAMILY_ID_HERE', 'supply', 'toy', '毛绒玩具', '🧸', 8, 30, 'active', 0),
  ('FAMILY_ID_HERE', 'supply', 'toy', '拉绳', '🪀', 5, 20, 'active', 0);

-- 药品
INSERT INTO public.pet_shop_items (family_id, type, subcategory, name, emoji, price_star, recovery_value, status, base_coin_per_day)
VALUES
  ('FAMILY_ID_HERE', 'supply', 'medicine', '感冒药', '💊', 15, 50, 'active', 0),
  ('FAMILY_ID_HERE', 'supply', 'medicine', '维生素', '💉', 10, 30, 'active', 0),
  ('FAMILY_ID_HERE', 'supply', 'medicine', '急救包', '🩹', 25, 80, 'active', 0);
