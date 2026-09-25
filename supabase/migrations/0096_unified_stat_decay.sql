-- 0096: Unified stat decay system
-- Hunger: 0-point daily reset OR 24h after fill (whichever first), max 1/day
-- Clean:  0-point daily reset OR 24h after fill (whichever first), max 1/day
-- Happiness: 1h after fill, max 3/day
-- Sickness logic preserved

-- Add new columns for hunger and clean decay tracking
alter table public.pets add column if not exists last_hunger_fill_at timestamptz;
alter table public.pets add column if not exists hunger_decay_count int default 0;
alter table public.pets add column if not exists last_clean_fill_at timestamptz;
alter table public.pets add column if not exists clean_decay_count int default 0;
-- (last_happiness_fill_at and happiness_decay_count already added in 0094)

-- ============================================================
-- check_pet: unified per-stat decay
-- ============================================================
create or replace function public.check_pet(p_pet_id uuid)
returns setof public.pets
language plpgsql security definer as $$
declare
  v_pet record;
  v_days int;
  v_i int;
  v_check_date date;
  v_fed boolean;
  v_cleaned boolean;
  v_cared boolean;
  v_sick boolean;
  v_today_cn date;
  v_hours_since_hunger_fill float;
  v_hours_since_clean_fill float;
  v_hours_since_happiness_fill float;
  v_need_update boolean := false;
begin
  select * into v_pet from public.pets where public.pets.id = p_pet_id for update;
  if not found then return; end if;

  v_today_cn := (now() at time zone 'Asia/Shanghai')::date;
  v_days := (v_today_cn - coalesce((v_pet.last_check_at at time zone 'Asia/Shanghai')::date, v_today_cn - 1))::int;

  -- ============================================================
  -- 1. Daily reset (v_days >= 1): reset all stats + sickness check
  -- ============================================================
  if v_days >= 1 then
    -- Track care dates for sickness logic
    for v_i in 1..v_days loop
      v_check_date := (v_today_cn - (v_days - v_i + 1))::date;

      v_fed := coalesce(v_pet.last_feed_date, '2000-01-01'::date) >= v_check_date;
      v_cleaned := coalesce(v_pet.last_clean_date, '2000-01-01'::date) >= v_check_date;
      v_cared := coalesce(v_pet.last_care_date, '2000-01-01'::date) >= v_check_date;

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

    -- Daily reset: all stats to 0, all decay counts to 0
    v_pet.hunger := 0;
    v_pet.clean := 0;
    v_pet.happiness := 0;
    v_pet.happiness_rounds := 0;
    v_pet.hunger_decay_count := 0;
    v_pet.clean_decay_count := 0;
    v_pet.happiness_decay_count := 0;

    v_sick := public.pet_is_sick(v_pet.has_stomach_issue, v_pet.has_skin_issue, v_pet.has_severe_illness);

    update public.pets set
      hunger = 0,
      clean = 0,
      happiness = 0,
      health = v_pet.health,
      days_without_feed = v_pet.days_without_feed,
      days_without_clean = v_pet.days_without_clean,
      days_without_care = v_pet.days_without_care,
      has_stomach_issue = v_pet.has_stomach_issue,
      has_skin_issue = v_pet.has_skin_issue,
      has_severe_illness = v_pet.has_severe_illness,
      is_sick = v_sick,
      happiness_rounds = 0,
      hunger_decay_count = 0,
      clean_decay_count = 0,
      happiness_decay_count = 0,
      last_check_at = now()
    where public.pets.id = p_pet_id;

    select * into v_pet from public.pets where public.pets.id = p_pet_id;
  end if;

  -- ============================================================
  -- 2. Per-stat decay (same day, time-based)
  -- ============================================================
  v_need_update := false;

  -- Hunger: 24h after fill, max 1/day
  if coalesce(v_pet.hunger, 0) > 0
     and coalesce(v_pet.hunger_decay_count, 0) < 1
     and v_pet.last_hunger_fill_at is not null then
    v_hours_since_hunger_fill := extract(epoch from now() - v_pet.last_hunger_fill_at) / 3600.0;
    if v_hours_since_hunger_fill >= 24.0 then
      v_pet.hunger := 0;
      v_pet.hunger_decay_count := coalesce(v_pet.hunger_decay_count, 0) + 1;
      v_need_update := true;
    end if;
  end if;

  -- Clean: 24h after fill, max 1/day
  if coalesce(v_pet.clean, 0) > 0
     and coalesce(v_pet.clean_decay_count, 0) < 1
     and v_pet.last_clean_fill_at is not null then
    v_hours_since_clean_fill := extract(epoch from now() - v_pet.last_clean_fill_at) / 3600.0;
    if v_hours_since_clean_fill >= 24.0 then
      v_pet.clean := 0;
      v_pet.clean_decay_count := coalesce(v_pet.clean_decay_count, 0) + 1;
      v_need_update := true;
    end if;
  end if;

  -- Happiness: 1h after fill, max 3/day
  if coalesce(v_pet.happiness, 0) > 0
     and coalesce(v_pet.happiness_decay_count, 0) < 3
     and v_pet.last_happiness_fill_at is not null then
    v_hours_since_happiness_fill := extract(epoch from now() - v_pet.last_happiness_fill_at) / 3600.0;
    if v_hours_since_happiness_fill >= 1.0 then
      v_pet.happiness := 0;
      v_pet.happiness_rounds := 0;
      v_pet.happiness_decay_count := coalesce(v_pet.happiness_decay_count, 0) + 1;
      v_need_update := true;
    end if;
  end if;

  if v_need_update then
    update public.pets set
      hunger = v_pet.hunger,
      clean = v_pet.clean,
      happiness = v_pet.happiness,
      happiness_rounds = v_pet.happiness_rounds,
      hunger_decay_count = v_pet.hunger_decay_count,
      clean_decay_count = v_pet.clean_decay_count,
      happiness_decay_count = v_pet.happiness_decay_count,
      last_check_at = now()
    where public.pets.id = p_pet_id;

    select * into v_pet from public.pets where public.pets.id = p_pet_id;
  end if;

  return query select * from public.pets where public.pets.id = p_pet_id;
end;
$$;

grant execute on function public.check_pet(uuid) to anon, authenticated;

-- ============================================================
-- interact_with_pet: record fill times for all three stats
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
  v_stat_max int := 100;
  v_old_hunger int;
  v_old_clean int;
  v_old_happiness int;
  v_old_health int;
  v_log record;
  v_today date := (now() at time zone 'Asia/Shanghai')::date;
  v_daily_total int := 0;
  v_daily_coin numeric(10,2);
  v_coin_earned int := 0;
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

  select * into v_item from public.pet_shop_items
    where id = p_item_id and type = v_required_sub limit 1;
  if not found then
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;

  select * into v_inv from public.pet_inventory
    where pet_id = p_pet_id and item_id = p_item_id and quantity > 0 limit 1;
  if not found then
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;

  update public.pet_inventory set quantity = quantity - 1
    where pet_id = p_pet_id and item_id = p_item_id;
  delete from public.pet_inventory
    where pet_id = p_pet_id and item_id = p_item_id and quantity <= 0;

  -- Apply recovery + record fill time when stat reaches max
  if p_action = 'feed' then
    v_pet.hunger := least(v_stat_max, v_old_hunger + v_recovery);
    if v_pet.hunger >= v_stat_max then
      v_pet.last_hunger_fill_at := now();
    end if;
  elsif p_action = 'clean' then
    v_pet.clean := least(v_stat_max, v_old_clean + v_recovery);
    if v_pet.clean >= v_stat_max then
      v_pet.last_clean_fill_at := now();
    end if;
  elsif p_action = 'play' then
    v_pet.happiness := least(v_stat_max, v_old_happiness + v_recovery);
    if v_pet.happiness >= v_stat_max then
      v_pet.last_happiness_fill_at := now();
    end if;
  elsif p_action = 'heal' or p_action = 'medical' then
    v_pet.health := least(v_stat_max, v_old_health + v_recovery);
  end if;

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

  -- Exp: +10 when stat reaches full
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
    if coalesce(v_log.mood_full_count, 0) < 3 then
      update public.pet_daily_exp_log set mood_full_count = mood_full_count + 1
        where pet_id = p_pet_id and log_date = v_today;
      v_exp_gain := v_exp_gain + 10;
    end if;
  end if;

  -- Daily total cap: 50
  select * into v_log from public.pet_daily_exp_log where pet_id = p_pet_id and log_date = v_today;
  v_daily_total := coalesce(v_log.hunger_full_count, 0) * 10
    + coalesce(v_log.clean_full_count, 0) * 10
    + coalesce(v_log.mood_full_count, 0) * 10;

  if v_daily_total > 50 then
    v_exp_gain := 0;
  end if;

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

  -- Coin earning: 4 stats all full -> daily coin (1x/day)
  if coalesce(v_pet.hunger, 0) >= v_stat_max
     and coalesce(v_pet.clean, 0) >= v_stat_max
     and coalesce(v_pet.happiness, 0) >= v_stat_max
     and coalesce(v_pet.health, 0) >= v_stat_max
     and not (v_old_hunger >= v_stat_max and v_old_clean >= v_stat_max
              and v_old_happiness >= v_stat_max and v_old_health >= v_stat_max)
     and coalesce(v_log.daily_coin_claimed, false) = false
  then
    v_daily_coin := coalesce(v_pet.base_coin_per_day, 1) * (1 + (coalesce(v_pet.level, 1) - 1) * 0.1);
    v_coin_earned := round(v_daily_coin)::int;
    v_pet.coin_balance := coalesce(v_pet.coin_balance, 0) + v_coin_earned;
    update public.pet_daily_exp_log set daily_coin_claimed = true
      where pet_id = p_pet_id and log_date = v_today;
  end if;

  update public.pets set
    hunger = v_pet.hunger,
    clean = v_pet.clean,
    happiness = v_pet.happiness,
    health = v_pet.health,
    last_feed_date = v_pet.last_feed_date,
    last_clean_date = v_pet.last_clean_date,
    last_play_date = v_pet.last_play_date,
    last_care_date = v_pet.last_care_date,
    last_hunger_fill_at = v_pet.last_hunger_fill_at,
    last_clean_fill_at = v_pet.last_clean_fill_at,
    last_happiness_fill_at = v_pet.last_happiness_fill_at,
    exp = v_pet.exp,
    pending_levelup = v_pet.pending_levelup,
    coin_balance = v_pet.coin_balance
  where public.pets.id = p_pet_id;

  return query select * from public.pets where public.pets.id = p_pet_id;
end;
$$;

grant execute on function public.interact_with_pet(uuid, uuid, text, uuid) to anon, authenticated;

-- ============================================================
-- Reset "tudi" pet: hunger=0, clean=0, happiness=0
-- ============================================================
update public.pets set
  hunger = 0,
  clean = 0,
  happiness = 0,
  happiness_rounds = 0,
  hunger_decay_count = 0,
  clean_decay_count = 0,
  happiness_decay_count = 0,
  last_hunger_fill_at = null,
  last_clean_fill_at = null,
  last_happiness_fill_at = null,
  last_check_at = now()
where name = '土地';

notify pgrst, 'reload schema';
