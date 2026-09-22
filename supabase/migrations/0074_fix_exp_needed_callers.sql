-- 0074: 修复 exp_needed 调用方
-- 0067 将 exp_needed(int) 改为 exp_needed(int, text)，
-- 但 interact_with_pet / study_reward 仍用单参调用，运行时报错
-- 导致经验计算失败（血条始终100等异常）
-- 本迁移重建这两个函数，改为 exp_needed(level, rarity)

-- ============================================================
-- 一、重建 interact_with_pet：exp_needed(level) → exp_needed(level, rarity)
--    其余逻辑与 0046 完全一致
-- ============================================================
create or replace function public.interact_with_pet(
  p_member_id uuid,
  p_pet_id uuid,
  p_action text,
  p_item_id uuid default null
)
returns setof public.pets
language plpgsql security definer as $$
declare
  v_pet record;
  v_item record;
  v_inv record;
  v_required_sub text;
  v_recovery int := 20;
  v_exp_gain int := 20;
  v_new_exp int;
  v_exp_needed int;
  v_all_max boolean := false;
begin
  select * into v_pet from public.pets where public.pets.id = p_pet_id for update;
  if not found then return; end if;

  -- 跨用户：直接返回当前宠物行
  if v_pet.member_id <> p_member_id then
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;

  -- action → subcategory 映射（兼容 heal / medical）
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

  -- 校验背包物品
  select * into v_inv from public.pet_inventory
    where public.pet_inventory.member_id = p_member_id
      and public.pet_inventory.item_id = p_item_id
    for update;
  if not found or v_inv.quantity <= 0 then
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;
  if v_inv.subcategory <> v_required_sub then
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;

  -- 读取商品 recovery_value
  select * into v_item from public.pet_shop_items where public.pet_shop_items.id = p_item_id;
  if found and v_item.recovery_value is not null and v_item.recovery_value > 0 then
    v_recovery := v_item.recovery_value;
  end if;

  -- 扣减背包物品
  if v_inv.quantity - 1 <= 0 then
    delete from public.pet_inventory where public.pet_inventory.id = v_inv.id;
  else
    update public.pet_inventory
      set quantity = v_inv.quantity - 1
      where public.pet_inventory.id = v_inv.id;
  end if;

  -- 应用恢复值（封顶 100）
  if p_action = 'feed' then
    v_pet.hunger := least(100, coalesce(v_pet.hunger, 0) + v_recovery);
  elsif p_action = 'clean' then
    v_pet.clean := least(100, coalesce(v_pet.clean, 0) + v_recovery);
  elsif p_action = 'play' then
    v_pet.happiness := least(100, coalesce(v_pet.happiness, 0) + v_recovery);
  elsif p_action = 'heal' or p_action = 'medical' then
    v_pet.is_sick := false;
    v_pet.health := least(100, coalesce(v_pet.health, 0) + v_recovery);
  end if;

  -- 判定 4 项是否全部 ≥ 100
  if coalesce(v_pet.hunger, 0) >= 100
     and coalesce(v_pet.clean, 0) >= 100
     and coalesce(v_pet.happiness, 0) >= 100
     and coalesce(v_pet.health, 0) >= 100 then
    v_all_max := true;
  end if;

  if v_all_max then
    -- 加经验
    v_new_exp := coalesce(v_pet.exp, 0) + v_exp_gain;
    v_exp_needed := public.exp_needed(coalesce(v_pet.level, 1), coalesce(v_pet.rarity, 'common'));

    -- 是否触发 pending_levelup
    if v_new_exp >= v_exp_needed and v_pet.level < coalesce(v_pet.max_level, 10) then
      update public.pets set
        hunger = 0,
        clean = 0,
        happiness = 0,
        health = 0,
        is_sick = v_pet.is_sick,
        exp = v_new_exp,
        pending_levelup = true
      where public.pets.id = p_pet_id;
    else
      update public.pets set
        hunger = 0,
        clean = 0,
        happiness = 0,
        health = 0,
        is_sick = v_pet.is_sick,
        exp = v_new_exp
      where public.pets.id = p_pet_id;
    end if;
  else
    -- 未满 100，仅更新属性
    update public.pets set
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

-- ============================================================
-- 二、重建 study_reward：exp_needed(level) → exp_needed(level, rarity)
--    其余逻辑与 0050 完全一致
-- ============================================================
create or replace function public.study_reward(
  p_member_id uuid,
  p_minutes int,
  p_reward int default 0,
  p_pet_id uuid default null,
  p_tasks jsonb default null,
  p_star_earned int default 0
)
returns table(success boolean, message text, happiness_gain int)
language plpgsql security definer as $$
declare
  v_pet record;
  v_exp_gain int;
  v_happiness_gain int;
  v_new_exp int;
  v_exp_needed int;
  v_level_up boolean := false;
  v_coin_earned int := 0;
  v_pet_name text := null;
begin
  v_happiness_gain := greatest(0, p_minutes);

  if p_pet_id is not null then
    select * into v_pet from public.pets where public.pets.id = p_pet_id for update;
    if found then
      v_pet_name := v_pet.name;
      v_exp_gain := (p_minutes / 10) * 10;
      v_new_exp := coalesce(v_pet.exp, 0) + v_exp_gain;
      v_exp_needed := public.exp_needed(v_pet.level, coalesce(v_pet.rarity, 'common'));

      if v_new_exp >= v_exp_needed and v_pet.level < coalesce(v_pet.max_level, 3) then
        v_level_up := true;
        v_new_exp := v_new_exp - v_exp_needed;
        v_coin_earned := coalesce(v_pet.upgrade_coin_reward, 5);

        update public.pets set
          level = v_pet.level + 1,
          exp = v_new_exp,
          happiness = least(coalesce(v_pet.current_max_blood, 100), v_pet.happiness + v_happiness_gain),
          current_max_blood = round(coalesce(v_pet.current_max_blood, 100) * 1.05)::int,
          daily_decay_base = coalesce(v_pet.daily_decay_base, 5) + 1,
          coin_balance = coalesce(v_pet.coin_balance, 0) + v_coin_earned
        where public.pets.id = p_pet_id;

        update public.members set coin_balance = coin_balance + v_coin_earned, updated_at = now()
        where public.members.id = p_member_id;
      else
        update public.pets set
          exp = v_new_exp,
          happiness = least(coalesce(v_pet.current_max_blood, 100), v_pet.happiness + v_happiness_gain)
        where public.pets.id = p_pet_id;
      end if;
    end if;
  end if;

  -- 插入学习记录
  insert into public.study_records (member_id, pet_id, pet_name, minutes, happiness_gain, star_earned, tasks)
  values (p_member_id, p_pet_id, v_pet_name, p_minutes, v_happiness_gain, p_star_earned, p_tasks);

  return query select true,
    case
      when v_level_up then '学习完成！宠物心情恢复' || v_happiness_gain || '点，升级啦！+' || v_coin_earned || '金币'
      when p_pet_id is not null then '学习完成！宠物心情恢复' || v_happiness_gain || '点，获得' || coalesce(v_exp_gain, 0) || '经验'
      else '学习完成！'
    end,
    v_happiness_gain;
end;
$$;
