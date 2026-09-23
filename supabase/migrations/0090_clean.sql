-- 0090 FIX: pet upgrade path
drop function if exists public.interact_with_pet(uuid, uuid, text, uuid);

create function public.interact_with_pet(
  p_member_id uuid, p_pet_id uuid, p_action text, p_item_id uuid
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
  v_today date := (now() at time zone 'Asia/Shanghai')::date;
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
    where member_id = p_member_id and item_id = p_item_id for update;
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

create or replace function public.check_pet(p_pet_id uuid)
returns setof public.pets
language plpgsql security definer as $$
declare
  v_pet record;
  v_days int;
  v_i int;
  v_check_date date;
  v_hunger_mult numeric;
  v_clean_mult numeric;
  v_daily_decay int;
  v_fed boolean;
  v_cleaned boolean;
  v_cared boolean;
  v_sick boolean;
  v_today_cn date;
begin
  select * into v_pet from public.pets where public.pets.id = p_pet_id for update;
  if not found then return; end if;
  v_today_cn := (now() at time zone 'Asia/Shanghai')::date;
  v_days := (v_today_cn - coalesce((v_pet.last_check_at at time zone 'Asia/Shanghai')::date, v_today_cn - 1))::int;
  if v_days >= 1 then
    v_hunger_mult := public.trait_hunger_multiplier(coalesce(v_pet.trait, '平平无奇'));
    v_clean_mult := public.trait_clean_multiplier(coalesce(v_pet.trait, '平平无奇'));
    for v_i in 1..v_days loop
      v_check_date := (v_today_cn - (v_days - v_i + 1))::date;
      v_fed := coalesce(v_pet.last_feed_date, '2000-01-01'::date) >= v_check_date;
      v_cleaned := coalesce(v_pet.last_clean_date, '2000-01-01'::date) >= v_check_date;
      v_cared := coalesce(v_pet.last_care_date, '2000-01-01'::date) >= v_check_date;
      v_daily_decay := round(100 * v_hunger_mult)::int;
      v_pet.hunger := greatest(0, coalesce(v_pet.hunger, 0) - v_daily_decay);
      v_daily_decay := round(100 * v_clean_mult)::int;
      v_pet.clean := greatest(0, coalesce(v_pet.clean, 0) - v_daily_decay);
      v_pet.happiness := 0;
      v_pet.happiness_rounds := 0;
      if v_fed then v_pet.days_without_feed := 0;
      else v_pet.days_without_feed := coalesce(v_pet.days_without_feed, 0) + 1; end if;
      if v_cleaned then v_pet.days_without_clean := 0;
      else v_pet.days_without_clean := coalesce(v_pet.days_without_clean, 0) + 1; end if;
      if v_cared then v_pet.days_without_care := 0;
      else v_pet.days_without_care := coalesce(v_pet.days_without_care, 0) + 1; end if;
      if v_pet.days_without_feed >= 3 then v_pet.has_stomach_issue := true; end if;
      if v_pet.days_without_clean >= 3 then v_pet.has_skin_issue := true; end if;
      if v_pet.days_without_care >= 7 then v_pet.has_severe_illness := true; end if;
      v_sick := public.pet_is_sick(v_pet.has_stomach_issue, v_pet.has_skin_issue, v_pet.has_severe_illness);
      if v_sick then
        if v_pet.has_severe_illness then
          v_pet.health := greatest(0, coalesce(v_pet.health, 100) - 20);
        else
          v_pet.health := greatest(0, coalesce(v_pet.health, 100) - 10);
        end if;
      end if;
    end loop;
    v_sick := public.pet_is_sick(v_pet.has_stomach_issue, v_pet.has_skin_issue, v_pet.has_severe_illness);
    update public.pets set
      hunger = v_pet.hunger,
      clean = v_pet.clean,
      happiness = v_pet.happiness,
      health = v_pet.health,
      days_without_feed = v_pet.days_without_feed,
      days_without_clean = v_pet.days_without_clean,
      days_without_care = v_pet.days_without_care,
      has_stomach_issue = v_pet.has_stomach_issue,
      has_skin_issue = v_pet.has_skin_issue,
      has_severe_illness = v_pet.has_severe_illness,
      is_sick = v_sick,
      happiness_rounds = 0,
      last_check_at = now()
    where public.pets.id = p_pet_id;
  end if;
  return query select * from public.pets where public.pets.id = p_pet_id;
end;
$$;
grant execute on function public.check_pet(uuid) to anon, authenticated;

create or replace function public.complete_pet_levelup(p_member_id uuid, p_pet_id uuid)
returns setof public.pets
language plpgsql security definer as $$
declare
  v_pet record;
  v_reward numeric(10,2);
  v_exp_needed int;
  v_new_max_blood int;
  v_evolved_bonus numeric(5,2);
  v_new_level int;
  v_new_exp_to_next int;
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
  v_reward := (coalesce(v_pet.level, 1) + 1) * 1.25;
  v_evolved_bonus := coalesce(v_pet.evolved_bonus, 0.0);
  v_new_max_blood := round(coalesce(v_pet.current_max_blood, 100) * (1.05 + v_evolved_bonus * 0.01))::int;
  v_new_level := coalesce(v_pet.level, 1) + 1;
  v_new_exp_to_next := public.exp_needed(v_new_level, coalesce(v_pet.rarity, 'common'));
  update public.pets set
    level = v_new_level,
    exp = 0,
    exp_to_next = v_new_exp_to_next,
    current_max_blood = v_new_max_blood,
    daily_decay_base = coalesce(v_pet.daily_decay_base, 5) + 1,
    coin_balance = coalesce(v_pet.coin_balance, 0) + v_reward,
    pending_levelup = false
  where public.pets.id = p_pet_id;
  update public.members
    set coin_balance = coalesce(coin_balance, 0) + v_reward, updated_at = now()
    where public.members.id = p_member_id;
  return query select * from public.pets where public.pets.id = p_pet_id;
end;
$$;
grant execute on function public.complete_pet_levelup(uuid, uuid) to anon, authenticated;

update public.pets set happiness = 0, happiness_rounds = 0 where coalesce(happiness, 0) > 100;
update public.pets set exp_to_next = public.exp_needed(level, coalesce(rarity, 'common')) where level < coalesce(max_level, 10);

update public.pets
set level = 3, exp = 0, exp_to_next = public.exp_needed(3, 'rare'),
    current_max_blood = 100, daily_decay_base = 7, pending_levelup = false,
    hunger = 100, clean = 100, happiness = 0, health = 100, is_sick = false,
    last_check_at = now()
where name = '土地';
