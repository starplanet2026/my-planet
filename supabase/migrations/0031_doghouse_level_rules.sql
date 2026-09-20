-- 0031: 狗屋分级容量规则
-- 1) pet_shop_items 新增 doghouse_level 字段（1=茅草屋, 2=温馨狗屋, 3=豪华狗屋）
-- 2) 重写 buy_doghouse_upgrade：必须按级别顺序购买，容量 1→1, 2→5, 3→10
-- 3) 重写 buy_pet_item：宠物类型购买前校验狗屋容量，不足则提示购买下一级狗屋
-- 4) 迁移现有 dog_house 数据到新容量映射
-- ============================================================

-- 1. 新增 doghouse_level 字段
alter table public.pet_shop_items add column if not exists doghouse_level int;

-- 4. 迁移现有 dog_house 数据到新容量映射
update public.dog_house set capacity = case level
  when 1 then 1
  when 2 then 5
  when 3 then 10
  else capacity
end;

-- 2. 重写 buy_doghouse_upgrade
drop function if exists public.buy_doghouse_upgrade(uuid, uuid);
create or replace function public.buy_doghouse_upgrade(
  p_member_id uuid,
  p_item_id uuid
)
returns table(success boolean, message text, new_level int, new_capacity int, new_star int, new_coin int)
language plpgsql security definer as $$
declare
  v_member public.members%rowtype;
  v_item public.pet_shop_items%rowtype;
  v_star int;
  v_coin int;
  v_need_star int;
  v_need_coin int;
  v_current_level int := 0;
  v_target_level int;
  v_new_capacity int;
  v_family_id uuid;
begin
  -- 锁定会员
  select * into v_member from public.members where id = p_member_id for update;
  if not found then
    return query select false, '会员不存在', 0, 0, 0, 0;
    return;
  end if;
  v_family_id := v_member.family_id;

  -- 锁定商品
  select * into v_item from public.pet_shop_items where id = p_item_id for update;
  if not found then
    return query select false, '商品不存在', 0, 0, 0, 0;
    return;
  end if;

  -- 校验：必须是 supply + doghouse + active + 配置了 doghouse_level
  if v_item.type <> 'supply' or v_item.subcategory <> 'doghouse' then
    return query select false, '该商品不是狗屋', 0, 0, 0, 0;
    return;
  end if;
  if v_item.status <> 'active' then
    return query select false, '商品已下架', 0, 0, 0, 0;
    return;
  end if;
  if v_item.doghouse_level is null then
    return query select false, '该狗屋未配置等级', 0, 0, 0, 0;
    return;
  end if;

  -- 库存校验
  if v_item.stock is not null and v_item.stock <= 0 then
    return query select false, '已售罄', 0, 0, 0, 0;
    return;
  end if;

  -- 当前狗屋等级（无记录=0）
  select level into v_current_level from public.dog_house where member_id = p_member_id;
  if not found then v_current_level := 0; end if;

  v_target_level := v_item.doghouse_level;

  -- 必须按顺序购买：level 1 → 2 → 3
  if v_target_level <= v_current_level then
    return query select false, '已拥有该级别或更高狗屋', v_current_level, 0, v_member.star_value, v_member.coin_balance;
    return;
  elsif v_target_level <> v_current_level + 1 then
    return query select false, '请先购买上一级狗屋', v_current_level, 0, v_member.star_value, v_member.coin_balance;
    return;
  end if;

  -- 扣费校验
  v_need_star := v_item.price_star;
  v_need_coin := v_item.price_coin;
  v_star := v_member.star_value;
  v_coin := v_member.coin_balance;

  if v_need_star > 0 and v_star < v_need_star then
    return query select false, '星光值不足', v_current_level, 0, v_star, v_coin;
    return;
  end if;
  if v_need_coin > 0 and v_coin < v_need_coin then
    return query select false, '金币不足', v_current_level, 0, v_star, v_coin;
    return;
  end if;

  -- 扣费
  if v_need_star > 0 then
    update public.members set star_value = star_value - v_need_star where id = p_member_id;
    v_star := v_star - v_need_star;
  end if;
  if v_need_coin > 0 then
    update public.members set coin_balance = coin_balance - v_need_coin where id = p_member_id;
    v_coin := v_coin - v_need_coin;
  end if;

  -- 容量映射：1→1, 2→5, 3→10
  v_new_capacity := case v_target_level
    when 1 then 1
    when 2 then 5
    when 3 then 10
    else 0
  end;

  -- 升级或创建狗屋
  if v_current_level = 0 then
    insert into public.dog_house (family_id, member_id, level, capacity)
    values (v_family_id, p_member_id, v_target_level, v_new_capacity);
  else
    update public.dog_house
      set level = v_target_level, capacity = v_new_capacity, updated_at = now()
      where member_id = p_member_id;
  end if;

  -- 库存 -1
  if v_item.stock is not null then
    update public.pet_shop_items set stock = stock - 1 where id = p_item_id;
  end if;

  return query select true, '狗屋升级成功！', v_target_level, v_new_capacity, v_star, v_coin;
end;
$$;

grant execute on function public.buy_doghouse_upgrade(uuid, uuid) to anon, authenticated;


-- 3. 重写 buy_pet_item：宠物类型购买前校验狗屋容量
create or replace function public.buy_pet_item(
  p_member_id uuid,
  p_item_id uuid
)
returns table(success boolean, message text, new_star int, new_coin int, pet_id uuid, inventory_qty int)
language plpgsql security definer as $$
declare
  v_item public.pet_shop_items%rowtype;
  v_member public.members%rowtype;
  v_star int;
  v_coin int;
  v_family_id uuid;
  v_pet_id uuid := null;
  v_inv_qty int := 0;
  v_existing_pet_id uuid;
  v_capacity int := 0;
  v_current_level int := 0;
  v_pet_count int;
  v_next_house_name text;
begin
  select * into v_item from public.pet_shop_items where id = p_item_id and status = 'active';
  if not found then return query select false, '商品不存在或已下架', 0, 0, null, 0; return; end if;

  select * into v_member from public.members where id = p_member_id for update;
  v_family_id := v_member.family_id;
  v_star := v_member.star_value;
  v_coin := v_member.coin_balance;

  if v_star < v_item.price_star then
    return query select false, '星光值不足', v_star, v_coin, null, 0; return;
  end if;

  -- 宠物类型：重复领养 + 狗屋容量校验
  if v_item.type = 'pet' then
    -- 重复领养校验
    select id into v_existing_pet_id from public.pets
    where member_id = p_member_id and shop_item_id = p_item_id
    limit 1;
    if found then
      return query select false, '已领养该宠物，不可重复购买', v_star, v_coin, null, 0; return;
    end if;

    -- 狗屋容量校验
    select level, capacity into v_current_level, v_capacity
    from public.dog_house where member_id = p_member_id;
    if not found then
      v_current_level := 0;
      v_capacity := 0;
    end if;

    select count(*) into v_pet_count from public.pets where member_id = p_member_id;

    if v_pet_count >= v_capacity then
      -- 查找下一级狗屋名称
      select name into v_next_house_name
      from public.pet_shop_items
      where subcategory = 'doghouse'
        and doghouse_level = v_current_level + 1
        and status = 'active'
        and family_id = v_family_id
      limit 1;

      if v_next_house_name is null then
        return query select false, '狗屋容量不足，请联系家长上架更高级狗屋', v_star, v_coin, null, 0;
      else
        return query select false, '请先购买「' || v_next_house_name || '」', v_star, v_coin, null, 0;
      end if;
      return;
    end if;
  end if;

  -- 扣星光值
  v_star := v_star - v_item.price_star;
  update public.members set star_value = v_star, updated_at = now() where id = p_member_id;

  if v_item.type = 'pet' then
    -- 创建宠物记录（gender 来自商品）
    insert into public.pets (family_id, member_id, shop_item_id, name, emoji, image_url, gender, base_coin_per_day, upgrade_coin_reward, coin_balance)
    values (v_family_id, p_member_id, v_item.id, '新宠物', v_item.emoji, v_item.image_url, v_item.gender, v_item.base_coin_per_day, v_item.price_coin, 0)
    returning id into v_pet_id;
    return query select true, '购买成功！请给宠物取个名字', v_star, v_coin, v_pet_id, 0;
  else
    -- 用品存入背包
    insert into public.pet_inventory (family_id, member_id, item_id, item_name_snapshot, item_emoji, item_image_url, subcategory, quantity)
    values (v_family_id, p_member_id, p_item_id, coalesce(v_item.name, '用品'), v_item.emoji, v_item.image_url, v_item.subcategory, 1)
    on conflict (member_id, item_id) do update set quantity = pet_inventory.quantity + 1
    returning quantity into v_inv_qty;
    return query select true, '已购买并存入背包', v_star, v_coin, null, v_inv_qty;
  end if;
end;
$$;

grant execute on function public.buy_pet_item(uuid, uuid) to anon, authenticated;
