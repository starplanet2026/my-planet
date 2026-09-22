-- ============================================================
-- 0079: 修复恢复值从物品读取 + 金币奖励机制
-- 1. 恢复值从 pet_shop_items.recovery_value 读取（不再硬编码20）
-- 2. 三项满值后给金币奖励（日产金币公式）
-- 3. 升级金币 = (新等级) * 1.25
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
  v_old_hunger int;
  v_old_clean int;
  v_old_happiness int;
  v_all_full boolean := false;
  v_daily_coin numeric(10,2);
begin
  select * into v_pet from public.pets where public.pets.id = p_pet_id for update;
  if not found then return; end if;
  if v_pet.member_id <> p_member_id then
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;

  -- 记录旧值（用于判断三项是否满值）
  v_old_hunger := coalesce(v_pet.hunger, 0);
  v_old_clean := coalesce(v_pet.clean, 0);
  v_old_happiness := coalesce(v_pet.happiness, 0);

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

  -- 需求1: 从 pet_shop_items 读取 recovery_value（不再硬编码20）
  select * into v_item from public.pet_shop_items where id = p_item_id;
  v_recovery := coalesce(v_item.recovery_value, 20);

  -- 扣除物品
  if v_inv.quantity = 1 then
    delete from public.pet_inventory where id = v_inv.id;
  else
    update public.pet_inventory set quantity = v_inv.quantity - 1 where id = v_inv.id;
  end if;

  -- 所有属性上限统一为100，恢复值=物品 recovery_value
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

  -- 需求2+3: 体力/清洁/玩耍三项都满值后才给金币奖励
  -- 仅在本次互动使三项达到满值时触发（之前不全满，现在全满）
  if coalesce(v_pet.hunger, 0) >= v_stat_max
     and coalesce(v_pet.clean, 0) >= v_stat_max
     and coalesce(v_pet.happiness, 0) >= v_stat_max
     and not (v_old_hunger >= v_stat_max and v_old_clean >= v_stat_max and v_old_happiness >= v_stat_max)
  then
    v_all_full := true;
    -- 日产金币 = base_coin_per_day * (1 + (level-1) * 0.1)
    v_daily_coin := coalesce(v_pet.base_coin_per_day, 1) * (1 + (coalesce(v_pet.level, 1) - 1) * 0.1);
    v_coin_earned := v_coin_earned + round(v_daily_coin)::int;
  end if;

  -- 经验值 +20 XP
  v_new_exp := coalesce(v_pet.exp, 0) + v_exp_gain;
  v_exp_needed := public.exp_needed(v_pet.level, coalesce(v_pet.rarity, 'common'));

  if v_new_exp >= v_exp_needed and v_pet.level < coalesce(v_pet.max_level, 3) then
    v_level_up := true;
    v_new_exp := v_new_exp - v_exp_needed;
    v_evolved_bonus := coalesce(v_pet.evolved_bonus, 0.0);
    -- 需求3: 升级金币 = 升级后等级 * 1.25
    v_coin_earned := v_coin_earned + round((coalesce(v_pet.level, 1) + 1) * 1.25)::int;
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
      is_sick = v_pet.is_sick,
      coin_balance = coalesce(v_pet.coin_balance, 0) + v_coin_earned
    where public.pets.id = p_pet_id;

    if v_coin_earned > 0 then
      update public.members
        set coin_balance = coalesce(coin_balance, 0) + v_coin_earned, updated_at = now()
        where id = p_member_id;
    end if;
  end if;

  return query select * from public.pets where public.pets.id = p_pet_id;
end;
$$;

grant execute on function public.interact_with_pet(uuid, uuid, text, uuid) to anon, authenticated;
