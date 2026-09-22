-- ============================================================
-- 0078: 修复 exp_needed 函数缺失 + 宠物默认属性值
-- ============================================================

-- ============================================================
-- 一、创建 exp_needed(level, rarity) 函数
-- 与前端 EXP_TABLE 保持一致
-- ============================================================
create or replace function public.exp_needed(p_level int, p_rarity text default 'common')
returns int as $$
begin
  return case
    when p_level < 1 then 20
    when p_level <= 10 then p_level * 20
    when p_level = 11 then 310
    when p_level = 12 then 340
    when p_level = 13 then 360
    when p_level = 14 then 390
    when p_level = 15 then 420
    when p_level = 16 then 450
    when p_level = 17 then 480
    when p_level = 18 then 500
    when p_level = 19 then 530
    when p_level = 20 then 560
    when p_level = 21 then 590
    when p_level = 22 then 620
    when p_level = 23 then 640
    when p_level = 24 then 670
    else 999999
  end;
end;
$$ language plpgsql immutable;

grant execute on function public.exp_needed(int, text) to anon, authenticated;

-- ============================================================
-- 二、重写 interact_with_pet: 传 rarity 给 exp_needed
-- ============================================================
drop function if exists public.interact_with_pet(uuid, uuid, text, uuid);

create function public.interact_with_pet(
  p_member_id uuid,
  p_pet_id uuid,
  p_action text,
  p_item_id uuid
)
returns setof public.pets
language plpgsql security definer as $$
declare
  v_pet public.pets%rowtype;
  v_item public.pet_shop_items%rowtype;
  v_inv public.pet_inventory%rowtype;
  v_required_sub text;
  v_recovery int := 20;
  v_exp_gain int := 20;
  v_new_exp int;
  v_exp_needed int;
  v_level_up boolean := false;
  v_coin_earned int := 0;
  v_new_max_blood int;
  v_evolved_bonus numeric(5,2);
  v_stat_max int := 100;
begin
  select * into v_pet from public.pets where public.pets.id = p_pet_id for update;
  if not found then return; end if;
  if v_pet.member_id <> p_member_id then
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;

  -- action → subcategory 映射
  if p_action = 'feed' then v_required_sub := 'food';
  elsif p_action = 'clean' then v_required_sub := 'clean';
  elsif p_action = 'play' then v_required_sub := 'toy';
  elsif p_action = 'heal' or p_action = 'medical' then v_required_sub := 'medicine';
  else
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;

  -- 治疗需宠物生病
  if (p_action = 'heal' or p_action = 'medical') and not v_pet.is_sick then
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;

  -- 属性满值拦截（不消耗物品）
  if p_action = 'feed' and coalesce(v_pet.hunger, 0) >= v_stat_max then
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;
  if p_action = 'clean' and coalesce(v_pet.clean, 0) >= v_stat_max then
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;
  if p_action = 'play' and coalesce(v_pet.happiness, 0) >= v_stat_max then
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;
  if (p_action = 'heal' or p_action = 'medical') and coalesce(v_pet.health, 0) >= v_stat_max then
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;

  -- 校验背包物品
  select * into v_inv from public.pet_inventory
    where member_id = p_member_id and item_id = p_item_id
    for update;
  if not found or coalesce(v_inv.quantity, 0) < 1 then
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;

  -- 校验物品子类别匹配
  if coalesce(v_inv.subcategory, '') <> v_required_sub then
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;

  -- 扣除物品
  if v_inv.quantity = 1 then
    delete from public.pet_inventory where id = v_inv.id;
  else
    update public.pet_inventory set quantity = v_inv.quantity - 1 where id = v_inv.id;
  end if;

  -- 所有属性上限统一为100
  if p_action = 'feed' then
    v_pet.hunger := least(v_stat_max, coalesce(v_pet.hunger, 0) + v_recovery);
  elsif p_action = 'clean' then
    v_pet.clean := least(v_stat_max, coalesce(v_pet.clean, 0) + v_recovery);
  elsif p_action = 'play' then
    v_pet.happiness := least(v_stat_max, coalesce(v_pet.happiness, 0) + v_recovery);
  elsif p_action = 'heal' or p_action = 'medical' then
    v_pet.is_sick := false;
    v_pet.health := least(v_stat_max, coalesce(v_pet.health, 0) + v_recovery);
  end if;

  -- 经验值 +20 XP
  v_new_exp := coalesce(v_pet.exp, 0) + v_exp_gain;
  v_exp_needed := public.exp_needed(v_pet.level, coalesce(v_pet.rarity, 'common'));

  if v_new_exp >= v_exp_needed and v_pet.level < coalesce(v_pet.max_level, 3) then
    v_level_up := true;
    v_new_exp := v_new_exp - v_exp_needed;
    v_evolved_bonus := coalesce(v_pet.evolved_bonus, 0.0);
    v_coin_earned := round(coalesce(v_pet.level, 1) * 1.25)::int;
    v_new_max_blood := round(coalesce(v_pet.current_max_blood, 100) * (1.05 + v_evolved_bonus * 0.01))::int;

    update public.pets set
      level = v_pet.level + 1,
      exp = v_new_exp,
      hunger = v_pet.hunger,
      clean = v_pet.clean,
      happiness = v_pet.happiness,
      health = v_pet.health,
      is_sick = v_pet.is_sick,
      coin_balance = coalesce(v_pet.coin_balance, 0) + v_coin_earned,
      current_max_blood = v_new_max_blood,
      daily_decay_base = coalesce(v_pet.daily_decay_base, 5) + 1,
      pending_levelup = false
    where public.pets.id = p_pet_id;

    update public.members
      set coin_balance = coalesce(coin_balance, 0) + v_coin_earned, updated_at = now()
      where id = p_member_id;
  else
    update public.pets set
      exp = v_new_exp,
      hunger = v_pet.hunger,
      clean = v_pet.clean,
      happiness = v_pet.happiness,
      health = v_pet.health,
      is_sick = v_pet.is_sick
    where public.pets.id = p_pet_id;
  end if;

  return query select * from public.pets where public.pets.id = p_pet_id;
end;
$$;

grant execute on function public.interact_with_pet(uuid, uuid, text, uuid) to anon, authenticated;

-- ============================================================
-- 三、重写 buy_pet_item: 宠物默认属性值 hunger=0,clean=0,happiness=0,health=100
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

  -- 问题10: 容量检查前置（购买宠物时检查狗屋容量）
  if v_item.type = 'pet' then
    select * into v_doghouse from public.dog_houses where member_id = p_member_id;
    if not found or coalesce(v_doghouse.level, 0) = 0 then
      return query select false, '需要先购买狗屋', v_star, v_coin, null::uuid, 0;
      return;
    end if;
    declare
      v_capacity int;
      v_current_count int;
    begin
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
    end;
  end if;

  -- 星光值检查（容量检查之后）
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
-- 四、重写 gacha_adopt: 宠物默认属性值 hunger=0,clean=0,happiness=0,health=100
-- ============================================================
drop function if exists public.gacha_adopt(uuid, uuid);

create function public.gacha_adopt(p_member_id uuid, p_shop_item_id uuid)
returns table(success boolean, message text, pet_id uuid, remaining_star int)
language plpgsql security definer as $$
declare
  v_member record;
  v_item public.pet_shop_items%rowtype;
  v_star int;
  v_pet_id uuid;
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
