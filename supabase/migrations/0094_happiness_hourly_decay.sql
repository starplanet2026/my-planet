-- 0094: Happiness decay - reset to 0 after 1 hour, max 2 times per day

-- Add columns for happiness decay tracking
alter table public.pets add column if not exists last_happiness_fill_at timestamptz;
alter table public.pets add column if not exists happiness_decay_count int default 0;

-- ============================================================
-- check_pet: daily reset + hourly happiness decay (max 2/day)
-- ============================================================
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
  v_hours_since_fill float;
  v_need_happiness_decay boolean;
begin
  select * into v_pet from public.pets where public.pets.id = p_pet_id for update;
  if not found then return; end if;

  v_today_cn := (now() at time zone 'Asia/Shanghai')::date;
  v_days := (v_today_cn - coalesce((v_pet.last_check_at at time zone 'Asia/Shanghai')::date, v_today_cn - 1))::int;

  if v_days >= 1 then
    -- Daily reset: hunger, clean, happiness, AND happiness_decay_count
    v_hunger_mult := public.trait_hunger_multiplier(coalesce(v_pet.trait, 'pingpingwuqi'));
    v_clean_mult := public.trait_clean_multiplier(coalesce(v_pet.trait, 'pingpingwuqi'));

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
      happiness_decay_count = 0,
      last_check_at = now()
    where public.pets.id = p_pet_id;

    -- Reload v_pet after daily update
    select * into v_pet from public.pets where public.pets.id = p_pet_id;
  end if;

  -- ============================================================
  -- Hourly happiness decay: if filled > 1 hour ago and decay_count < 2
  -- ============================================================
  v_need_happiness_decay := false;

  if coalesce(v_pet.happiness, 0) > 0
     and coalesce(v_pet.happiness_decay_count, 0) < 2
     and v_pet.last_happiness_fill_at is not null then

    v_hours_since_fill := extract(epoch from now() - v_pet.last_happiness_fill_at) / 3600.0;

    if v_hours_since_fill >= 1.0 then
      v_need_happiness_decay := true;
    end if;
  end if;

  if v_need_happiness_decay then
    update public.pets set
      happiness = 0,
      happiness_rounds = 0,
      happiness_decay_count = coalesce(happiness_decay_count, 0) + 1
    where public.pets.id = p_pet_id;

    select * into v_pet from public.pets where public.pets.id = p_pet_id;
  end if;

  return query select * from public.pets where public.pets.id = p_pet_id;
end;
$$;

grant execute on function public.check_pet(uuid) to anon, authenticated;

-- ============================================================
-- interact_with_pet: record last_happiness_fill_at when playing
-- ============================================================
create or replace function public.interact_with_pet(
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

  -- Find item
  select * into v_item from public.pet_shop_items
    where id = p_item_id and sub_type = v_required_sub limit 1;
  if not found then
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;

  -- Check inventory
  select * into v_inv from public.pet_inventory
    where pet_id = p_pet_id and item_id = p_item_id and quantity > 0 limit 1;
  if not found then
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;

  -- Consume item
  update public.pet_inventory set quantity = quantity - 1
    where pet_id = p_pet_id and item_id = p_item_id;
  delete from public.pet_inventory
    where pet_id = p_pet_id and item_id = p_item_id and quantity <= 0;

  -- Apply recovery
  if p_action = 'feed' then
    v_pet.hunger := least(v_stat_max, v_old_hunger + v_recovery);
  elsif p_action = 'clean' then
    v_pet.clean := least(v_stat_max, v_old_clean + v_recovery);
  elsif p_action = 'play' then
    v_pet.happiness := least(v_stat_max, v_old_happiness + v_recovery);
    -- Record fill time for hourly decay
    v_pet.last_happiness_fill_at := now();
  elsif p_action = 'heal' or p_action = 'medical' then
    v_pet.health := least(v_stat_max, v_old_health + v_recovery);
  end if;

  -- Update dates
  if p_action = 'feed' then v_pet.last_feed_date := v_today;
  elsif p_action = 'clean' then v_pet.last_clean_date := v_today;
  elsif p_action = 'play' then v_pet.last_play_date := v_today;
  elsif p_action = 'heal' or p_action = 'medical' then v_pet.last_care_date := v_today;
  end if;

  -- Daily exp log
  select * into v_log from public.pet_daily_exp_log where pet_id = p_pet_id and log_date = v_today;
  if not found then
    insert into public.pet_daily_exp_log (pet_id, log_date) values (p_pet_id, v_today);
    select * into v_log from public.pet_daily_exp_log where pet_id = p_pet_id and log_date = v_today;
  end if;

  -- Exp gain: +10 when stat reaches full (once per stat per day)
  if p_action = 'feed' and v_pet.hunger >= v_stat_max and v_old_hunger < v_stat_max then
    if coalesce(v_log.hunger_full_count, 0) < 1 then
      update public.pet_daily_exp_log set hunger_full_count = hunger_full_count + 1
        where pet_id = p_pet_id and log_date = v_today;
      v_exp_gain := v_exp_gain + 10;
    end if;
  end if;

  if p_action = 'clean' and v_pet.clean >= v_stat_max and v_old_clean < v_stat_max then
    if coalesce(v_log.clean_full_count, 0) < 1 then
      update public.pet_daily_exp_log set clean_full_count = clean_full_count + 1
        where pet_id = p_pet_id and log_date = v_today;
      v_exp_gain := v_exp_gain + 10;
    end if;
  end if;

  if p_action = 'play' and v_pet.happiness >= v_stat_max and v_old_happiness < v_stat_max then
    if coalesce(v_log.happiness_rounds, 0) < 3 then
      update public.pet_daily_exp_log set happiness_rounds = happiness_rounds + 1
        where pet_id = p_pet_id and log_date = v_today;
      v_exp_gain := v_exp_gain + 10;
    end if;
  end if;

  -- Calculate daily total exp
  select * into v_log from public.pet_daily_exp_log where pet_id = p_pet_id and log_date = v_today;
  v_daily_total := coalesce(v_log.hunger_full_count, 0) * 10
    + coalesce(v_log.clean_full_count, 0) * 10
    + coalesce(v_log.happiness_rounds, 0) * 10;

  -- Cap at 50 per day
  if v_daily_total > 50 then
    v_exp_gain := 0;
  end if;

  -- Apply exp
  if v_exp_gain > 0 then
    v_new_exp := coalesce(v_pet.exp, 0) + v_exp_gain;
    v_exp_needed := public.exp_needed(coalesce(v_pet.level, 1), coalesce(v_pet.rarity, 'common'));
    if v_new_exp >= v_exp_needed then
      v_pet.pending_levelup := true;
      v_pet.exp := v_new_exp;
    else
      v_pet.exp := v_new_exp;
    end if;
  end if;

  -- Coin earning (play action)
  if p_action = 'play' then
    v_daily_coin := coalesce(v_log.daily_coin_earned, 0);
    if v_daily_coin < 5 then
      v_coin_earned := least(5 - v_daily_coin, 1.00);
      v_pet.coin_balance := coalesce(v_pet.coin_balance, 0) + v_coin_earned;
      update public.pet_daily_exp_log set daily_coin_earned = coalesce(daily_coin_earned, 0) + v_coin_earned
        where pet_id = p_pet_id and log_date = v_today;
    end if;
  end if;

  -- Update pet
  update public.pets set
    hunger = v_pet.hunger,
    clean = v_pet.clean,
    happiness = v_pet.happiness,
    health = v_pet.health,
    last_feed_date = v_pet.last_feed_date,
    last_clean_date = v_pet.last_clean_date,
    last_play_date = v_pet.last_play_date,
    last_care_date = v_pet.last_care_date,
    last_happiness_fill_at = v_pet.last_happiness_fill_at,
    exp = v_pet.exp,
    pending_levelup = v_pet.pending_levelup,
    coin_balance = v_pet.coin_balance
  where public.pets.id = p_pet_id;

  return query select * from public.pets where public.pets.id = p_pet_id;
end;
$$;

grant execute on function public.interact_with_pet(uuid, uuid, text, uuid) to anon, authenticated;

-- Reload schema cache
notify pgrst, 'reload schema';
