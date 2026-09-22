-- 0082: 修复 buy_pet_item 表名错误 + gacha_adopt 添加容量检查

-- ============================================================
-- 一、修复 buy_pet_item: dog_houses → dog_house
-- ============================================================
drop function if exists public.buy_pet_item(uuid, uuid);

create function public.buy_pet_item(
  p_member_id uuid,
  p_item_id uuid
)
returns table(success boolean, message text, new_star int, new_coin int, pet_id uuid, inv_qty int)
language plpgsql security definer as $$
declare
  v_member record;
  v_item public.pet_shop_items%rowtype;
  v_doghouse record;
  v_star int;
  v_coin int;
  v_family_id uuid;
  v_pet_id uuid;
  v_inv_qty int;
  v_capacity int;
  v_current_count int;
begin
  select * into v_member from public.members where id = p_member_id;
  if not found then
    return query select false, '用户不存在', 0, 0, null::uuid, 0;
    return;
  end if;
  v_star := coalesce(v_member.star_value, 0);
  v_coin := coalesce(v_member.coin_balance, 0);
  v_family_id := v_member.family_id;

  select * into v_item from public.pet_shop_items where id = p_item_id;
  if not found then
    return query select false, '物品不存在', v_star, v_coin, null::uuid, 0;
    return;
  end if;

  -- 容量检查（购买宠物时检查狗屋容量）
  if v_item.type = 'pet' then
    -- 修复：表名 dog_house（单数）
    select * into v_doghouse from public.dog_house where member_id = p_member_id;
    if not found or coalesce(v_doghouse.level, 0) = 0 then
      return query select false, '需要先购买狗屋', v_star, v_coin, null::uuid, 0;
      return;
    end if;
    v_capacity := case coalesce(v_doghouse.level, 0)
      when 1 then 1
      when 2 then 5
      when 3 then 10
      else 0
    end;
    select count(*) into v_current_count from public.pets
      where member_id = p_member_id and coalesce(is_boarding, false) = false;
    if v_current_count >= v_capacity then
      return query select false, '需要先购买「豪华小屋」，解锁更多饲养位', v_star, v_coin, null::uuid, 0;
      return;
    end if;
  end if;

  -- 星光值检查
  if v_star < coalesce(v_item.price_star, 0) then
    return query select false, '星光值不足', v_star, v_coin, null::uuid, 0;
    return;
  end if;

  v_star := v_star - coalesce(v_item.price_star, 0);
  update public.members set star_value = v_star, updated_at = now() where public.members.id = p_member_id;

  if v_item.type = 'pet' then
    insert into public.pets (
      family_id, member_id, shop_item_id, name, emoji, image_url, gender, rarity,
      base_coin_per_day, upgrade_coin_reward, coin_balance,
      max_level, current_max_blood, daily_decay_base, upgrade_percent, evolved_bonus, exp,
      hunger, clean, happiness, health
    )
    values (
      v_family_id, p_member_id, v_item.id, '新宠物', v_item.emoji, v_item.image_url, v_item.gender, coalesce(v_item.rarity, 'common'),
      coalesce(v_item.base_coin_per_day, 2), coalesce(v_item.upgrade_coin_reward, 5), 0,
      coalesce(v_item.max_level, 3), coalesce(v_item.max_blood_bar, 100),
      coalesce(v_item.daily_decay_base, 5), coalesce(v_item.upgrade_percent, 5.0), 0.0, 0,
      0, 0, 0, 100
    )
    returning id into v_pet_id;
    return query select true, '购买成功！请给宠物取个名字', v_star, v_coin, v_pet_id, 0;
  else
    insert into public.pet_inventory (family_id, member_id, item_id, item_name_snapshot, item_emoji, item_image_url, subcategory, quantity)
    values (v_family_id, p_member_id, p_item_id, coalesce(v_item.name, '用品'), v_item.emoji, v_item.image_url, v_item.subcategory, 1)
    on conflict (member_id, item_id) do update set quantity = pet_inventory.quantity + 1
    returning quantity into v_inv_qty;
    return query select true, '已购买并存入背包', v_star, v_coin, null::uuid, v_inv_qty;
  end if;
end;
$$;

grant execute on function public.buy_pet_item(uuid, uuid) to anon, authenticated;

-- ============================================================
-- 二、修复 gacha_adopt: 添加狗屋容量检查
-- ============================================================
drop function if exists public.gacha_adopt(uuid, uuid);

create function public.gacha_adopt(p_member_id uuid, p_shop_item_id uuid)
returns table(success boolean, message text, pet_id uuid, remaining_star int)
language plpgsql security definer as $$
declare
  v_member record;
  v_item public.pet_shop_items%rowtype;
  v_doghouse record;
  v_star int;
  v_pet_id uuid;
  v_capacity int;
  v_current_count int;
begin
  select * into v_member from public.members where id = p_member_id;
  if not found then
    return query select false, '用户不存在', null::uuid, 0;
    return;
  end if;

  select * into v_item from public.pet_shop_items where id = p_shop_item_id;
  if not found then
    return query select false, '宠物不存在', null::uuid, v_member.star_value;
    return;
  end if;

  -- 容量检查：必须有狗屋
  select * into v_doghouse from public.dog_house where member_id = p_member_id;
  if not found or coalesce(v_doghouse.level, 0) = 0 then
    return query select false, '需要先购买狗屋', null::uuid, v_member.star_value;
    return;
  end if;
  v_capacity := case coalesce(v_doghouse.level, 0)
    when 1 then 1
    when 2 then 5
    when 3 then 10
    else 0
  end;
  select count(*) into v_current_count from public.pets
    where member_id = p_member_id and coalesce(is_boarding, false) = false;
  if v_current_count >= v_capacity then
    return query select false, '需要先购买「豪华小屋」，解锁更多饲养位', null::uuid, v_member.star_value;
    return;
  end if;

  -- 扣150星光
  if v_member.star_value < 150 then
    return query select false, '星光值不足，需要150星光值领养', null::uuid, v_member.star_value;
    return;
  end if;

  v_star := v_member.star_value - 150;
  update public.members set star_value = v_star, updated_at = now() where public.members.id = p_member_id;

  insert into public.pets (
    family_id, member_id, shop_item_id, name, emoji, image_url, gender, rarity,
    base_coin_per_day, upgrade_coin_reward, coin_balance,
    max_level, current_max_blood, daily_decay_base, upgrade_percent, evolved_bonus, exp,
    hunger, clean, happiness, health
  )
  values (
    v_member.family_id, p_member_id, v_item.id, '新宠物', v_item.emoji, v_item.image_url, v_item.gender, coalesce(v_item.rarity, 'common'),
    coalesce(v_item.base_coin_per_day, 2), coalesce(v_item.upgrade_coin_reward, 5), 0,
    coalesce(v_item.max_level, 3), coalesce(v_item.max_blood_bar, 100),
    coalesce(v_item.daily_decay_base, 5), coalesce(v_item.upgrade_percent, 5.0), 0.0, 0,
    0, 0, 0, 100
  )
  returning id into v_pet_id;

  return query select true, '领养成功', v_pet_id, v_star;
end;
$$;

grant execute on function public.gacha_adopt(uuid, uuid) to anon, authenticated;
