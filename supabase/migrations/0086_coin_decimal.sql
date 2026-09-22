-- 0086: 金币支持小数，升级奖励按附件数值
-- members.coin_balance: integer → numeric(10,2)
-- complete_pet_levelup: 去掉 round，保留小数
-- interact_with_pet: 日产金币去掉 round

-- 1. members.coin_balance 改为 numeric
alter table public.members alter column coin_balance type numeric(10,2) using coalesce(coin_balance, 0)::numeric(10,2);

-- 2. 修改 complete_pet_levelup: 升级金币 = (level+1) * 1.25，不取整
create or replace function public.complete_pet_levelup(
  p_member_id uuid,
  p_pet_id uuid
)
returns setof public.pets
language plpgsql security definer as $$
declare
  v_pet record;
  v_reward numeric(10,2);
  v_exp_needed int;
  v_new_max_blood int;
  v_evolved_bonus numeric(5,2);
begin
  select * into v_pet from public.pets where public.pets.id = p_pet_id for update;
  if not found then return; end if;

  if v_pet.member_id <> p_member_id then
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;

  if coalesce(v_pet.level, 1) >= coalesce(v_pet.max_level, 10) then
    update public.pets set pending_levelup = false where public.pets.id = p_pet_id;
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;

  v_exp_needed := public.exp_needed(coalesce(v_pet.level, 1), coalesce(v_pet.rarity, 'common'));
  if coalesce(v_pet.exp, 0) < v_exp_needed then
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;

  -- 升级奖励金币 = 升级后等级 * 1.25（附件数值：Lv2=2.5, Lv3=3.75, Lv4=5...）
  v_reward := (coalesce(v_pet.level, 1) + 1) * 1.25;

  -- 血量上限增长
  v_evolved_bonus := coalesce(v_pet.evolved_bonus, 0.0);
  v_new_max_blood := round(coalesce(v_pet.current_max_blood, 100) * (1.05 + v_evolved_bonus * 0.01))::int;

  -- 升级
  update public.pets set
    level = coalesce(v_pet.level, 1) + 1,
    exp = 0,
    current_max_blood = v_new_max_blood,
    daily_decay_base = coalesce(v_pet.daily_decay_base, 5) + 1,
    coin_balance = coalesce(v_pet.coin_balance, 0) + v_reward,
    pending_levelup = false
  where public.pets.id = p_pet_id;

  -- 给孩子加金币
  update public.members
    set coin_balance = coalesce(coin_balance, 0) + v_reward, updated_at = now()
    where public.members.id = p_member_id;

  return query select * from public.pets where public.pets.id = p_pet_id;
end;
$$;

grant execute on function public.complete_pet_levelup(uuid, uuid) to anon, authenticated;

-- 3. 修改 interact_with_pet: 日产金币不取整
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
  v_exp_gain int := 0;
  v_new_exp int;
  v_exp_needed int;
  v_coin_earned numeric(10,2) := 0;
  v_stat_max int := 100;
  v_old_hunger int;
  v_old_clean int;
  v_old_happiness int;
  v_old_health int;
  v_log record;
  v_today date := current_date;
  v_daily_total int := 0;
  v_daily_coin numeric(10,2);
begin
  select * into v_pet from public.pets where public.pets.id = p_pet_id for update;
  if not found then return; end if;
  if v_pet.member_id <> p_member_id then
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;

  v_old_hunger := coalesce(v_pet.hunger, 0);
  v_old_clean := coalesce(v_pet.clean, 0);
  v_old_happiness := coalesce(v_pet.happiness, 0);
  v_old_health := coalesce(v_pet.health, 0);

  if p_action = 'feed' then v_required_sub := 'food';
  elsif p_action = 'clean' then v_required_sub := 'clean';
  elsif p_action = 'play' then v_required_sub := 'toy';
  elsif p_action = 'heal' or p_action = 'medical' then v_required_sub := 'medicine';
  else
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;

  if (p_action = 'heal' or p_action = 'medical') and not v_pet.is_sick then
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;

  if p_action = 'feed' and v_old_hunger >= v_stat_max then
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;
  if p_action = 'clean' and v_old_clean >= v_stat_max then
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;
  if p_action = 'play' and v_old_happiness >= v_stat_max then
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;
  if (p_action = 'heal' or p_action = 'medical') and v_old_health >= v_stat_max then
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;

  select * into v_inv from public.pet_inventory
    where member_id = p_member_id and item_id = p_item_id
    for update;
  if not found or coalesce(v_inv.quantity, 0) < 1 then
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;

  if coalesce(v_inv.subcategory, '') <> v_required_sub then
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;

  select * into v_item from public.pet_shop_items where id = p_item_id;
  v_recovery := coalesce(v_item.recovery_value, 20);

  if v_inv.quantity = 1 then
    delete from public.pet_inventory where id = v_inv.id;
  else
    update public.pet_inventory set quantity = v_inv.quantity - 1 where id = v_inv.id;
  end if;

  if p_action = 'feed' then
    v_pet.hunger := least(v_stat_max, v_old_hunger + v_recovery);
  elsif p_action = 'clean' then
    v_pet.clean := least(v_stat_max, v_old_clean + v_recovery);
  elsif p_action = 'play' then
    v_pet.happiness := least(v_stat_max, v_old_happiness + v_recovery);
  elsif p_action = 'heal' or p_action = 'medical' then
    v_pet.is_sick := false;
    v_pet.health := least(v_stat_max, v_old_health + v_recovery);
  end if;

  select * into v_log from public.pet_daily_exp_log
    where pet_id = p_pet_id and log_date = v_today;
  if not found then
    insert into public.pet_daily_exp_log (pet_id, log_date)
      values (p_pet_id, v_today)
      on conflict (pet_id, log_date) do nothing;
    select * into v_log from public.pet_daily_exp_log
      where pet_id = p_pet_id and log_date = v_today;
  end if;

  if p_action = 'feed' and v_pet.hunger >= v_stat_max and v_old_hunger < v_stat_max then
    if coalesce(v_log.hunger_full_count, 0) < 1 then
      v_exp_gain := v_exp_gain + 10;
      update public.pet_daily_exp_log set hunger_full_count = hunger_full_count + 1
        where pet_id = p_pet_id and log_date = v_today;
    end if;
  end if;

  if p_action = 'clean' and v_pet.clean >= v_stat_max and v_old_clean < v_stat_max then
    if coalesce(v_log.clean_full_count, 0) < 1 then
      v_exp_gain := v_exp_gain + 10;
      update public.pet_daily_exp_log set clean_full_count = clean_full_count + 1
        where pet_id = p_pet_id and log_date = v_today;
    end if;
  end if;

  if p_action = 'play' and v_pet.happiness >= v_stat_max and v_old_happiness < v_stat_max then
    if coalesce(v_log.mood_full_count, 0) < 3 then
      v_exp_gain := v_exp_gain + 10;
      update public.pet_daily_exp_log set mood_full_count = mood_full_count + 1
        where pet_id = p_pet_id and log_date = v_today;
    end if;
  end if;

  v_daily_total := coalesce(v_log.hunger_full_count, 0) * 10
    + coalesce(v_log.clean_full_count, 0) * 10
    + coalesce(v_log.mood_full_count, 0) * 10;
  if v_daily_total + v_exp_gain > 50 then
    v_exp_gain := greatest(0, 50 - v_daily_total);
  end if;

  -- 四项全满 → 日产金币（每日1次），不取整
  if coalesce(v_pet.hunger, 0) >= v_stat_max
     and coalesce(v_pet.clean, 0) >= v_stat_max
     and coalesce(v_pet.happiness, 0) >= v_stat_max
     and coalesce(v_pet.health, 0) >= v_stat_max
     and not (v_old_hunger >= v_stat_max and v_old_clean >= v_stat_max
              and v_old_happiness >= v_stat_max and v_old_health >= v_stat_max)
     and coalesce(v_log.daily_coin_claimed, false) = false
  then
    v_daily_coin := coalesce(v_pet.base_coin_per_day, 1) * (1 + (coalesce(v_pet.level, 1) - 1) * 0.1);
    v_coin_earned := v_daily_coin;
    update public.pet_daily_exp_log set daily_coin_claimed = true
      where pet_id = p_pet_id and log_date = v_today;
  end if;

  v_new_exp := coalesce(v_pet.exp, 0) + v_exp_gain;
  v_exp_needed := public.exp_needed(v_pet.level, coalesce(v_pet.rarity, 'common'));

  if v_new_exp >= v_exp_needed and v_pet.level < coalesce(v_pet.max_level, 3) then
    update public.pets set
      exp = v_new_exp,
      hunger = v_pet.hunger,
      clean = v_pet.clean,
      happiness = v_pet.happiness,
      health = v_pet.health,
      is_sick = v_pet.is_sick,
      coin_balance = coalesce(v_pet.coin_balance, 0) + v_coin_earned,
      pending_levelup = true
    where public.pets.id = p_pet_id;
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
  end if;

  if v_coin_earned > 0 then
    update public.members
      set coin_balance = coalesce(coin_balance, 0) + v_coin_earned, updated_at = now()
      where id = p_member_id;
  end if;

  return query select * from public.pets where public.pets.id = p_pet_id;
end;
$$;

grant execute on function public.interact_with_pet(uuid, uuid, text, uuid) to anon, authenticated;
