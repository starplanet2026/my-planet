-- 0041: 彻底清理并重建所有宠物相关函数
-- 解决 "structure of query does not match function result type" 持续报错

-- ============================================================
-- 第一步：确保所有列存在
-- ============================================================
alter table public.pet_shop_items add column if not exists max_level int default 3;
alter table public.pet_shop_items add column if not exists max_blood_bar int default 100;
alter table public.pet_shop_items add column if not exists daily_decay_base int default 5;
alter table public.pet_shop_items add column if not exists upgrade_coin_reward int default 5;
alter table public.pet_shop_items add column if not exists upgrade_percent numeric(5,2) default 5.0;
alter table public.pet_shop_items add column if not exists recovery_value int default 20;

alter table public.pets add column if not exists exp int default 0;
alter table public.pets add column if not exists current_max_blood int default 100;
alter table public.pets add column if not exists daily_decay_base int default 5;
alter table public.pets add column if not exists upgrade_percent numeric(5,2) default 5.0;
alter table public.pets add column if not exists evolved_bonus numeric(5,2) default 0.0;
alter table public.pets add column if not exists upgrade_coin_reward int default 5;

-- 同步已有宠物默认值
update public.pets set
  current_max_blood = 100,
  daily_decay_base = 5,
  upgrade_percent = 5.0,
  upgrade_coin_reward = 5
where current_max_blood is null or current_max_blood = 0;

-- ============================================================
-- 第二步：DROP 所有函数（先删依赖再删主体）
-- ============================================================
drop function if exists public.study_reward(uuid, int, int);
drop function if exists public.study_reward(uuid, int, int, uuid);
drop function if exists public.evolve_pet(uuid, text);
drop function if exists public.check_pet(uuid);
drop function if exists public.interact_with_pet(uuid, text, uuid);
drop function if exists public.buy_pet_item(uuid, uuid);
drop function if exists public.buy_doghouse_upgrade(uuid, uuid);
drop function if exists public.exp_needed(int);
drop function if exists public.gacha_start(uuid);
drop function if exists public.gacha_adopt(uuid, uuid);
drop function if exists public.gacha_cancel(uuid);
drop function if exists public.gacha_draw_pet(uuid);
drop function if exists public.gacha_draw_3x(uuid);

-- ============================================================
-- 第三步：重建 exp_needed
-- ============================================================
create function public.exp_needed(p_level int)
returns int
language sql as $$
  select case
    when p_level <= 1 then 100
    when p_level = 2 then 150
    when p_level = 3 then 200
    when p_level = 4 then 350
    when p_level = 5 then 500
    when p_level = 6 then 700
    when p_level >= 7 then 900
    else 100
  end;
$$;

-- ============================================================
-- 第四步：重建 interact_with_pet
-- ============================================================
create function public.interact_with_pet(
  p_pet_id uuid,
  p_action text,
  p_item_id uuid default null
)
returns table(success boolean, message text, pet_id uuid, level int, exp int, exp_needed int, hunger int, clean int, happiness int, health int, coin_earned int, level_up boolean)
language plpgsql security definer as $$
declare
  v_pet record;
  v_member record;
  v_item record;
  v_new_hunger int;
  v_new_clean int;
  v_new_happiness int;
  v_new_health int;
  v_recovery int;
  v_exp_gain int;
  v_new_exp int;
  v_exp_needed int;
  v_level_up boolean := false;
  v_coin_earned int := 0;
  v_new_max_blood int;
  v_new_level int;
  v_evolved_bonus numeric(5,2);
begin
  select * into v_pet from public.pets where public.pets.id = p_pet_id for update;
  if not found then
    return query select false, '宠物不存在', null::uuid, 0, 0, 0, 0, 0, 0, 0, 0, false;
    return;
  end if;

  select * into v_member from public.members where public.members.id = v_pet.member_id for update;

  v_recovery := 20;
  if p_item_id is not null then
    select * into v_item from public.pet_shop_items where public.pet_shop_items.id = p_item_id;
    if found and v_item.recovery_value is not null and v_item.recovery_value > 0 then
      v_recovery := v_item.recovery_value;
    end if;
  end if;

  v_new_hunger := v_pet.hunger;
  v_new_clean := v_pet.clean;
  v_new_happiness := v_pet.happiness;
  v_new_health := v_pet.health;

  if p_action = 'feed' then
    v_new_hunger := least(coalesce(v_pet.current_max_blood, 100), v_pet.hunger + v_recovery);
  elsif p_action = 'clean' then
    v_new_clean := least(coalesce(v_pet.current_max_blood, 100), v_pet.clean + v_recovery);
  elsif p_action = 'play' then
    v_new_happiness := least(coalesce(v_pet.current_max_blood, 100), v_pet.happiness + v_recovery);
  elsif p_action = 'medical' then
    v_new_health := least(coalesce(v_pet.current_max_blood, 100), v_pet.health + v_recovery);
  end if;

  v_exp_gain := 20;
  v_new_exp := coalesce(v_pet.exp, 0) + v_exp_gain;
  v_exp_needed := public.exp_needed(v_pet.level);
  v_new_level := v_pet.level;

  if v_new_exp >= v_exp_needed and v_pet.level < coalesce(v_pet.max_level, 3) then
    v_level_up := true;
    v_new_exp := v_new_exp - v_exp_needed;
    v_new_level := v_pet.level + 1;
    v_coin_earned := coalesce(v_pet.upgrade_coin_reward, 5);
    v_evolved_bonus := coalesce(v_pet.evolved_bonus, 0.0);
    v_new_max_blood := round(coalesce(v_pet.current_max_blood, 100) * (1.05 + v_evolved_bonus * 0.01))::int;

    update public.pets set
      level = v_new_level,
      exp = v_new_exp,
      hunger = v_new_hunger, clean = v_new_clean,
      happiness = v_new_happiness, health = v_new_health,
      coin_balance = coalesce(v_pet.coin_balance, 0) + v_coin_earned,
      current_max_blood = v_new_max_blood,
      daily_decay_base = coalesce(v_pet.daily_decay_base, 5) + 1
    where public.pets.id = p_pet_id;

    if v_member.id is not null then
      update public.members set coin_balance = coalesce(v_member.coin_balance, 0) + v_coin_earned, updated_at = now()
      where public.members.id = v_member.id;
    end if;
  else
    update public.pets set
      exp = v_new_exp,
      hunger = v_new_hunger, clean = v_new_clean,
      happiness = v_new_happiness, health = v_new_health
    where public.pets.id = p_pet_id;
  end if;

  return query select
    true,
    case when v_level_up then '升级！获得' || v_coin_earned || '金币' else '互动成功' end,
    p_pet_id,
    v_new_level,
    v_new_exp,
    public.exp_needed(v_new_level),
    v_new_hunger,
    v_new_clean,
    v_new_happiness,
    v_new_health,
    v_coin_earned,
    v_level_up;
end;
$$;

-- ============================================================
-- 第五步：重建 check_pet
-- ============================================================
create function public.check_pet(p_pet_id uuid)
returns table(
  id uuid, member_id uuid, family_id uuid, shop_item_id uuid, name text,
  emoji text, image_url text, gender text, level int, exp int, max_level int,
  hunger int, clean int, happiness int, health int, is_sick boolean,
  coin_balance numeric, base_coin_per_day numeric, upgrade_percent numeric,
  current_max_blood int, daily_decay_base int, evolved_bonus numeric,
  last_check_at timestamp, upgrade_coin_reward int
)
language plpgsql security definer as $$
declare
  v_pet record;
  v_member record;
  v_daily_production numeric;
  v_decay int;
  v_evolved_bonus numeric;
  v_new_hunger int;
  v_new_clean int;
  v_new_happiness int;
  v_new_health int;
  v_days_since int;
begin
  select * into v_pet from public.pets where public.pets.id = p_pet_id for update;
  if not found then return; end if;

  v_days_since := extract(day from now() - coalesce(v_pet.last_check_at, now() - interval '1 day'))::int;

  if v_days_since < 1 then
    return query select
      v_pet.id, v_pet.member_id, v_pet.family_id, v_pet.shop_item_id, v_pet.name,
      v_pet.emoji, v_pet.image_url, v_pet.gender, v_pet.level, coalesce(v_pet.exp, 0), coalesce(v_pet.max_level, 3),
      v_pet.hunger, v_pet.clean, v_pet.happiness, v_pet.health, v_pet.is_sick,
      v_pet.coin_balance, v_pet.base_coin_per_day, coalesce(v_pet.upgrade_percent, 5.0),
      coalesce(v_pet.current_max_blood, 100), coalesce(v_pet.daily_decay_base, 5), coalesce(v_pet.evolved_bonus, 0.0),
      v_pet.last_check_at, coalesce(v_pet.upgrade_coin_reward, 5);
    return;
  end if;

  v_evolved_bonus := coalesce(v_pet.evolved_bonus, 0.0);
  v_daily_production := coalesce(v_pet.base_coin_per_day, 0)
    * (1.0 + (v_pet.level - 1) * coalesce(v_pet.upgrade_percent, 5.0) / 100.0)
    * (1.0 + v_evolved_bonus / 100.0);

  v_decay := coalesce(v_pet.daily_decay_base, 5) + round(coalesce(v_pet.daily_decay_base, 5) * 0.02 * v_days_since)::int;
  v_new_hunger := greatest(0, v_pet.hunger - v_decay);
  v_new_clean := greatest(0, v_pet.clean - v_decay);
  v_new_happiness := greatest(0, v_pet.happiness - v_decay);
  v_new_health := greatest(0, v_pet.health - v_decay);

  update public.pets set
    coin_balance = coalesce(v_pet.coin_balance, 0) + v_daily_production * v_days_since,
    hunger = v_new_hunger, clean = v_new_clean,
    happiness = v_new_happiness, health = v_new_health,
    is_sick = (v_new_health < 30),
    last_check_at = now()
  where public.pets.id = p_pet_id;

  return query select
    p_pet_id, v_pet.member_id, v_pet.family_id, v_pet.shop_item_id, v_pet.name,
    v_pet.emoji, v_pet.image_url, v_pet.gender, v_pet.level, coalesce(v_pet.exp, 0), coalesce(v_pet.max_level, 3),
    v_new_hunger, v_new_clean, v_new_happiness, v_new_health, (v_new_health < 30),
    coalesce(v_pet.coin_balance, 0) + v_daily_production * v_days_since,
    v_pet.base_coin_per_day, coalesce(v_pet.upgrade_percent, 5.0),
    coalesce(v_pet.current_max_blood, 100), coalesce(v_pet.daily_decay_base, 5), coalesce(v_pet.evolved_bonus, 0.0),
    now(), coalesce(v_pet.upgrade_coin_reward, 5);
end;
$$;

-- ============================================================
-- 第六步：重建 evolve_pet（不重置等级）
-- ============================================================
create function public.evolve_pet(
  p_pet_id uuid,
  p_target_rarity text
)
returns table(success boolean, message text, new_rarity text, new_max_level int, new_price_star int)
language plpgsql security definer as $$
declare
  v_pet record;
  v_member record;
  v_current_rarity text;
  v_cost int;
  v_new_max_level int;
  v_new_base_coin numeric;
  v_new_upgrade_reward int;
  v_new_upgrade_percent numeric;
  v_new_max_blood int;
  v_new_decay int;
begin
  select * into v_pet from public.pets where public.pets.id = p_pet_id for update;
  if not found then
    return query select false, '宠物不存在', null::text, 0, 0;
    return;
  end if;

  v_current_rarity := coalesce(v_pet.rarity, 'common');

  if v_current_rarity = 'common' and p_target_rarity = 'rare' then
    v_cost := 150;
    v_new_max_level := 5;
    v_new_base_coin := 3 + random() * 1;
    v_new_upgrade_reward := 10 + floor(random() * 6)::int;
    v_new_upgrade_percent := 8.0;
    v_new_max_blood := 100 + floor(random() * 21)::int;
    v_new_decay := 6;
  elsif v_current_rarity = 'rare' and p_target_rarity = 'epic' then
    v_cost := 350;
    v_new_max_level := 7;
    v_new_base_coin := 4 + random() * 1;
    v_new_upgrade_reward := 20 + floor(random() * 11)::int;
    v_new_upgrade_percent := 12.0;
    v_new_max_blood := 120 + floor(random() * 31)::int;
    v_new_decay := 9;
  else
    return query select false, '无法进化到该等级', v_current_rarity, 0, 0;
    return;
  end if;

  if v_pet.level < v_pet.max_level then
    return query select false, '宠物需要满级才能进化', v_current_rarity, coalesce(v_pet.max_level, 3), 0;
    return;
  end if;

  select * into v_member from public.members where public.members.id = v_pet.member_id for update;
  if v_member.star_value < v_cost then
    return query select false, '星光值不足', v_current_rarity, v_new_max_level, v_cost;
    return;
  end if;

  update public.members set star_value = star_value - v_cost, updated_at = now() where public.members.id = v_member.id;

  update public.pets set
    rarity = p_target_rarity,
    max_level = v_new_max_level,
    base_coin_per_day = v_new_base_coin,
    upgrade_coin_reward = v_new_upgrade_reward,
    upgrade_percent = v_new_upgrade_percent,
    current_max_blood = round(v_new_max_blood * 1.1)::int,
    daily_decay_base = v_new_decay,
    evolved_bonus = 10.0
  where public.pets.id = p_pet_id;

  return query select true, '进化成功！属性大幅提升！', p_target_rarity, v_new_max_level, v_cost;
end;
$$;

-- ============================================================
-- 第七步：重建 study_reward
-- ============================================================
create function public.study_reward(
  p_member_id uuid,
  p_minutes int,
  p_reward int,
  p_pet_id uuid default null
)
returns table(success boolean, message text)
language plpgsql security definer as $$
declare
  v_pet record;
  v_exp_gain int;
  v_happiness_gain int;
  v_new_exp int;
  v_exp_needed int;
  v_level_up boolean := false;
  v_coin_earned int := 0;
begin
  update public.members set star_value = star_value + p_reward, updated_at = now()
  where public.members.id = p_member_id;

  if p_pet_id is not null then
    select * into v_pet from public.pets where public.pets.id = p_pet_id for update;
    if found then
      v_exp_gain := (p_minutes / 10) * 10;
      v_happiness_gain := (p_minutes / 10) * 10;
      v_new_exp := coalesce(v_pet.exp, 0) + v_exp_gain;
      v_exp_needed := public.exp_needed(v_pet.level);

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

  return query select true,
    case
      when v_level_up then '学习完成！获得' || p_reward || '星光值，宠物升级！+' || v_coin_earned || '金币'
      when p_pet_id is not null then '学习完成！获得' || p_reward || '星光值，宠物获得' || v_exp_gain || '经验'
      else '学习完成！获得' || p_reward || '星光值'
    end;
end;
$$;

-- ============================================================
-- 第八步：重建 buy_pet_item
-- ============================================================
create function public.buy_pet_item(
  p_member_id uuid,
  p_item_id uuid
)
returns table(success boolean, message text, new_star int, new_coin int, pet_id uuid, inventory_qty int)
language plpgsql security definer as $$
declare
  v_item record;
  v_member record;
  v_star int;
  v_coin int;
  v_family_id uuid;
  v_pet_id uuid := null;
  v_inv_qty int := 0;
  v_existing_pet_id uuid;
  v_doghouse_level int;
  v_current_pet_count int;
  v_capacity int;
begin
  select * into v_item from public.pet_shop_items where public.pet_shop_items.id = p_item_id and status = 'active';
  if not found then
    return query select false, '商品不存在或已下架', 0, 0, null::uuid, 0;
    return;
  end if;

  select * into v_member from public.members where public.members.id = p_member_id for update;
  v_family_id := v_member.family_id;
  v_star := v_member.star_value;
  v_coin := v_member.coin_balance;

  if v_star < coalesce(v_item.price_star, 0) then
    return query select false, '星光值不足', v_star, v_coin, null::uuid, 0;
    return;
  end if;

  if v_item.subcategory = 'doghouse' then
    return query select false, '请使用狗屋升级功能', v_star, v_coin, null::uuid, 0;
    return;
  end if;

  if v_item.type = 'pet' then
    select id into v_existing_pet_id from public.pets
    where member_id = p_member_id and shop_item_id = p_item_id
    limit 1;
    if found then
      return query select false, '已领养该宠物，不可重复购买', v_star, v_coin, null::uuid, 0;
      return;
    end if;

    select level into v_doghouse_level from public.dog_house where member_id = p_member_id limit 1;
    v_doghouse_level := coalesce(v_doghouse_level, 0);
    select count(*) into v_current_pet_count from public.pets where member_id = p_member_id;

    v_capacity := case v_doghouse_level
      when 0 then 0
      when 1 then 1
      when 2 then 5
      when 3 then 10
      else 10
    end;

    if v_current_pet_count >= v_capacity then
      if v_doghouse_level = 0 then
        return query select false, '请先购买「茅草屋」才能领养宠物', v_star, v_coin, null::uuid, 0;
      elsif v_doghouse_level = 1 then
        return query select false, '狗屋容量不足，请先购买「温馨狗屋」', v_star, v_coin, null::uuid, 0;
      elsif v_doghouse_level = 2 then
        return query select false, '狗屋容量不足，请先购买「豪华狗屋」', v_star, v_coin, null::uuid, 0;
      else
        return query select false, '狗屋容量已满', v_star, v_coin, null::uuid, 0;
      end if;
      return;
    end if;
  end if;

  v_star := v_star - coalesce(v_item.price_star, 0);
  update public.members set star_value = v_star, updated_at = now() where public.members.id = p_member_id;

  if v_item.type = 'pet' then
    insert into public.pets (
      family_id, member_id, shop_item_id, name, emoji, image_url, gender,
      base_coin_per_day, upgrade_coin_reward, coin_balance,
      max_level, current_max_blood, daily_decay_base, upgrade_percent, evolved_bonus, exp
    )
    values (
      v_family_id, p_member_id, v_item.id, '新宠物', v_item.emoji, v_item.image_url, v_item.gender,
      coalesce(v_item.base_coin_per_day, 2), coalesce(v_item.upgrade_coin_reward, 5), 0,
      coalesce(v_item.max_level, 3), coalesce(v_item.max_blood_bar, 100),
      coalesce(v_item.daily_decay_base, 5), coalesce(v_item.upgrade_percent, 5.0), 0.0, 0
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

-- ============================================================
-- 第九步：重建 buy_doghouse_upgrade
-- ============================================================
create function public.buy_doghouse_upgrade(
  p_member_id uuid,
  p_item_id uuid
)
returns table(success boolean, message text, new_level int, new_capacity int, remaining_star int)
language plpgsql security definer as $$
declare
  v_item record;
  v_member record;
  v_dh record;
  v_star int;
  v_current_level int;
  v_target_level int;
  v_new_capacity int;
  v_new_upgrade_cost int;
begin
  select * into v_item from public.pet_shop_items where public.pet_shop_items.id = p_item_id and status = 'active';
  if not found then
    return query select false, '商品不存在或已下架', 0, 0, 0;
    return;
  end if;

  if v_item.subcategory != 'doghouse' or v_item.doghouse_level is null or v_item.doghouse_level = 0 then
    return query select false, '该商品不是狗屋或未配置等级', 0, 0, 0;
    return;
  end if;

  select * into v_member from public.members where public.members.id = p_member_id for update;
  v_star := v_member.star_value;

  if v_star < coalesce(v_item.price_star, 0) then
    return query select false, '星光值不足', 0, 0, v_star;
    return;
  end if;

  select * into v_dh from public.dog_house where member_id = p_member_id for update;
  v_current_level := coalesce(v_dh.level, 0);
  v_target_level := v_item.doghouse_level;

  if v_current_level >= v_target_level then
    return query select false, '已拥有该等级或更高等级的狗屋', v_current_level, 0, v_star;
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
  v_new_upgrade_cost := case v_target_level
    when 1 then 100
    when 2 then 300
    when 3 then 500
    else 500
  end;

  v_star := v_star - coalesce(v_item.price_star, 0);
  update public.members set star_value = v_star, updated_at = now() where public.members.id = p_member_id;

  if v_current_level = 0 then
    insert into public.dog_house (member_id, family_id, level, capacity, upgrade_cost)
    values (p_member_id, v_member.family_id, v_target_level, v_new_capacity, v_new_upgrade_cost);
  else
    update public.dog_house set level = v_target_level, capacity = v_new_capacity, upgrade_cost = v_new_upgrade_cost
    where member_id = p_member_id;
  end if;

  return query select true, '狗屋升级成功！', v_target_level, v_new_capacity, v_star;
end;
$$;

-- ============================================================
-- 第十步：重建抽卡函数
-- ============================================================
create function public.gacha_start(p_member_id uuid)
returns table(success boolean, message text, drawn_pet_id uuid, drawn_pet_name text, drawn_pet_emoji text, drawn_pet_image text, remaining_star int, draw_count int)
language plpgsql security definer as $$
declare
  v_member record;
  v_item record;
  v_pet_id uuid;
  v_star int;
begin
  select * into v_member from public.members where public.members.id = p_member_id for update;
  if not found then
    return query select false, '用户不存在', null::uuid, null::text, null::text, null::text, 0, 0;
    return;
  end if;

  if v_member.star_value < 500 then
    return query select false, '需要500星光值才能抽卡', null::uuid, null::text, null::text, null::text, v_member.star_value, 0;
    return;
  end if;

  v_star := v_member.star_value - 500;
  update public.members set star_value = v_star, updated_at = now() where public.members.id = p_member_id;

  select * into v_item from public.pet_shop_items
  where type = 'pet' and status = 'active' and price_star > 0
  order by random() limit 1;

  if not found then
    update public.members set star_value = star_value + 500 where id = p_member_id;
    return query select false, '暂无可抽的宠物', null::uuid, null::text, null::text, null::text, v_member.star_value, 0;
    return;
  end if;

  insert into public.pets (
    family_id, member_id, shop_item_id, name, emoji, image_url, gender,
    base_coin_per_day, upgrade_coin_reward, coin_balance,
    max_level, current_max_blood, daily_decay_base, upgrade_percent, evolved_bonus, exp
  )
  values (
    v_member.family_id, p_member_id, v_item.id, '新宠物', v_item.emoji, v_item.image_url, v_item.gender,
    coalesce(v_item.base_coin_per_day, 2), coalesce(v_item.upgrade_coin_reward, 5), 0,
    coalesce(v_item.max_level, 3), coalesce(v_item.max_blood_bar, 100),
    coalesce(v_item.daily_decay_base, 5), coalesce(v_item.upgrade_percent, 5.0), 0.0, 0
  )
  returning id into v_pet_id;

  return query select true, '抽卡成功', v_pet_id, v_item.name, v_item.emoji, v_item.image_url, v_star, 1;
end;
$$;

create function public.gacha_adopt(p_member_id uuid, p_pet_id uuid)
returns table(success boolean, message text)
language plpgsql security definer as $$
begin
  -- 宠物已创建，无需额外操作
  return query select true, '领养成功';
end;
$$;

create function public.gacha_cancel(p_member_id uuid)
returns table(success boolean, message text, remaining_star int)
language plpgsql security definer as $$
declare
  v_star int;
begin
  update public.members set star_value = star_value + 150, updated_at = now()
  where id = p_member_id
  returning star_value into v_star;

  return query select true, '取消抽卡，退回150星光值', v_star;
end;
$$;

-- ============================================================
-- 权限
-- ============================================================
grant execute on function public.exp_needed(int) to anon, authenticated;
grant execute on function public.interact_with_pet(uuid, text, uuid) to anon, authenticated;
grant execute on function public.check_pet(uuid) to anon, authenticated;
grant execute on function public.evolve_pet(uuid, text) to anon, authenticated;
grant execute on function public.study_reward(uuid, int, int, uuid) to anon, authenticated;
grant execute on function public.buy_pet_item(uuid, uuid) to anon, authenticated;
grant execute on function public.buy_doghouse_upgrade(uuid, uuid) to anon, authenticated;
grant execute on function public.gacha_start(uuid) to anon, authenticated;
grant execute on function public.gacha_adopt(uuid, uuid) to anon, authenticated;
grant execute on function public.gacha_cancel(uuid) to anon, authenticated;
