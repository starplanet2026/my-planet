-- 0073: 修复茅草屋自动赠送问题
-- 1) get_dog_house 不再自动初始化狗窝，无记录返回 level=0
-- 2) gacha_adopt 去掉 pet_shop_items.family_id 引用（列已删除）+ 加狗窝容量检查
-- 3) buy_doghouse_upgrade 购买成功后写入 pet_inventory（背包显示）

-- ====== 1. 修复 get_dog_house ======
CREATE OR REPLACE FUNCTION public.get_dog_house(
  p_member_id uuid
)
RETURNS TABLE(level int, capacity int, current_pet_count int, upgrade_cost int)
LANGUAGE plpgsql SECURITY DEFINER AS $$
declare
  v_house public.dog_house%rowtype;
  v_count int;
begin
  select * into v_house from public.dog_house where member_id = p_member_id;
  -- 不再自动初始化，无记录则 level=0, capacity=0
  select count(*) into v_count from public.pets where member_id = p_member_id;

  if not found or v_house.level is null then
    return query select 0, 0, v_count, 10;
  else
    return query select v_house.level, v_house.capacity, v_count, 10 * v_house.level;
  end if;
end;
$$;

-- ====== 2. 修复 gacha_adopt ======
CREATE OR REPLACE FUNCTION public.gacha_adopt(p_member_id uuid, p_shop_item_id uuid)
RETURNS TABLE(success boolean, message text, pet_id uuid, pet_name text, pet_image text)
LANGUAGE plpgsql SECURITY DEFINER AS $$
declare
  v_member public.members%rowtype;
  v_pet_row public.pet_shop_items%rowtype;
  v_new_pet public.pets%rowtype;
  v_doghouse_level int;
  v_current_pet_count int;
  v_capacity int;
begin
  select * into v_member from public.members where id = p_member_id for update;
  if not found then
    return query select false, '成员不存在', null::uuid, null::text, null::text;
    return;
  end if;

  -- 查找宠物商品（pet_shop_items 已全局化，不再有 family_id）
  select * into v_pet_row from public.pet_shop_items
    where id = p_shop_item_id;

  if not found then
    return query select false, '宠物商品不存在', null::uuid, null::text, null::text;
    return;
  end if;

  -- 检查是否已拥有该宠物
  if exists (
    select 1 from public.pets
    where member_id = p_member_id and shop_item_id = p_shop_item_id
  ) then
    return query select false, '已拥有该宠物', null::uuid, null::text, null::text;
    return;
  end if;

  -- 狗窝容量检查
  select level into v_doghouse_level from public.dog_house
    where member_id = p_member_id limit 1;
  v_doghouse_level := coalesce(v_doghouse_level, 0);
  select count(*) into v_current_pet_count from public.pets
    where member_id = p_member_id;

  v_capacity := case v_doghouse_level
    when 0 then 0
    when 1 then 1
    when 2 then 5
    when 3 then 10
    else 10
  end;

  if v_current_pet_count >= v_capacity then
    if v_doghouse_level = 0 then
      return query select false, '请先购买「茅草屋」才能领养宠物', null::uuid, null::text, null::text;
      return;
    else
      return query select false, '狗屋容量不足', null::uuid, null::text, null::text;
      return;
    end if;
  end if;

  -- 创建宠物记录
  insert into public.pets (
    family_id, member_id, shop_item_id, name, image_url,
    hunger, clean, happiness, health,
    max_level, current_max_blood, daily_decay_base,
    upgrade_percent, upgrade_coin_reward, rarity, evolved_bonus,
    exp, last_check_at
  ) values (
    v_member.family_id, p_member_id, v_pet_row.id,
    v_pet_row.name, v_pet_row.image_url,
    0, 0, 0, 0,
    v_pet_row.max_level, v_pet_row.max_blood_bar, v_pet_row.daily_decay_base,
    v_pet_row.upgrade_percent, v_pet_row.upgrade_coin_reward, v_pet_row.rarity, 1.0,
    0, now()
  )
  returning * into v_new_pet;

  if not found then
    return query select false, '创建宠物失败', null::uuid, null::text, null::text;
    return;
  end if;

  -- 减库存
  update public.pet_shop_items set stock = case
    when stock is null then null
    else stock - 1
  end
    where id = v_pet_row.id;

  return query select true, '领养成功', v_new_pet.id, v_pet_row.name, v_pet_row.image_url;
end;
$$;

-- ====== 3. 修复 buy_doghouse_upgrade：购买后写入背包 ======
CREATE OR REPLACE FUNCTION public.buy_doghouse_upgrade(
  p_member_id uuid,
  p_item_id uuid
)
RETURNS TABLE(
  success boolean,
  message text,
  new_level int,
  new_capacity int,
  remaining_star int
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
declare
  v_item record;
  v_member record;
  v_dh record;
  v_star int;
  v_current_level int;
  v_target_level int;
  v_new_capacity int;
begin
  select * into v_item from public.pet_shop_items
    where id = p_item_id and status = 'active'
    for update;
  if not found then
    return query select false, '商品不存在或已下架', 0, 0, 0;
    return;
  end if;

  if v_item.subcategory != 'doghouse' then
    return query select false, '该商品不是狗屋', 0, 0, 0;
    return;
  end if;

  if v_item.doghouse_level is null or v_item.doghouse_level = 0 then
    return query select false, '该狗屋未配置等级', 0, 0, 0;
    return;
  end if;

  select * into v_member from public.members
    where id = p_member_id for update;
  if not found then
    return query select false, '会员不存在', 0, 0, 0;
    return;
  end if;

  v_star := v_member.star_value;

  if v_star < coalesce(v_item.price_star, 0) then
    return query select false, '星光值不足', 0, 0, v_star;
    return;
  end if;

  select * into v_dh from public.dog_house
    where member_id = p_member_id for update;
  v_current_level := coalesce(v_dh.level, 0);
  v_target_level := v_item.doghouse_level;

  if v_current_level >= v_target_level then
    return query select false, '已拥有该等级狗屋', v_current_level, 0, v_star;
    return;
  end if;

  if v_target_level != v_current_level + 1 then
    return query select false, '需要按顺序购买狗屋', v_current_level, 0, v_star;
    return;
  end if;

  v_new_capacity := case v_target_level
    when 1 then 1
    when 2 then 5
    when 3 then 10
    else 10
  end;

  -- 扣星光值
  v_star := v_star - coalesce(v_item.price_star, 0);
  update public.members
    set star_value = v_star, updated_at = now()
    where id = p_member_id;

  -- 创建或更新 dog_house 记录
  if v_current_level = 0 then
    insert into public.dog_house (member_id, family_id, level, capacity)
    values (p_member_id, v_member.family_id, v_target_level, v_new_capacity);
  else
    update public.dog_house
      set level = v_target_level, capacity = v_new_capacity, updated_at = now()
      where member_id = p_member_id;
  end if;

  -- 写入背包（让用户在背包中看到已购买的住所）
  insert into public.pet_inventory (family_id, member_id, item_id, item_name_snapshot, item_emoji, item_image_url, subcategory, quantity)
  values (v_member.family_id, p_member_id, p_item_id, coalesce(v_item.name, '住所'), v_item.emoji, v_item.image_url, 'doghouse', 1)
  on conflict (member_id, item_id) do update set quantity = 1;

  return query select true, '狗屋升级成功！', v_target_level, v_new_capacity, v_star;
end;
$$;
