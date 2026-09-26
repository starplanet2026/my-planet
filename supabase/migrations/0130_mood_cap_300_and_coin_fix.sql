-- 0130: 心情值上限改300 + 移除每小时衰减 + 稀有度日产金币修正
--
-- 1. base_coin_per_day 修正：普通1/稀有2/史诗5（原史诗6→5）
-- 2. check_pet: 移除每小时心情衰减逻辑（lines 102-126 of 0094）
-- 3. interact_with_pet: 心情上限100→300（体力/清洁/健康仍100不变）
-- 4. run_daily_boarding_care: 心情补满300，心情满额经验10→30，总经验50
-- 体力、清洁度、健康度属性规则不变。

-- ============================================================
-- 一、稀有度日产金币修正
-- ============================================================
update public.pet_shop_items set base_coin_per_day = 1 where rarity = 'common';
update public.pet_shop_items set base_coin_per_day = 2 where rarity = 'rare';
update public.pet_shop_items set base_coin_per_day = 5 where rarity = 'epic';

-- ============================================================
-- 二、check_pet: 移除每小时心情衰减，保留每日重置
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
begin
  select * into v_pet from public.pets where public.pets.id = p_pet_id for update;
  if not found then return; end if;

  v_today_cn := (now() at time zone 'Asia/Shanghai')::date;
  v_days := (v_today_cn - coalesce((v_pet.last_check_at at time zone 'Asia/Shanghai')::date, v_today_cn - 1))::int;

  if v_days >= 1 then
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
  end if;

  return query select * from public.pets where public.pets.id = p_pet_id;
end;
$$;
revoke all on function public.check_pet(uuid) from public;
grant execute on function public.check_pet(uuid) to anon, authenticated;

-- ============================================================
-- 三、interact_with_pet: 心情上限300（体力/清洁/健康仍100）
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
  v_stat_max int := 100;        -- 体力/清洁/健康上限
  v_happiness_max int := 300;  -- 心情上限
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

  -- 已满则不消耗道具
  if p_action = 'feed' and v_old_hunger >= v_stat_max then
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;
  if p_action = 'clean' and v_old_clean >= v_stat_max then
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;
  if p_action = 'play' and v_old_happiness >= v_happiness_max then
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;
  if (p_action = 'heal' or p_action = 'medical') and v_old_health >= v_stat_max then
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;

  select * into v_item from public.pet_shop_items
    where id = p_item_id and sub_type = v_required_sub limit 1;
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

  -- 恢复属性
  if p_action = 'feed' then
    v_pet.hunger := least(v_stat_max, v_old_hunger + v_recovery);
  elsif p_action = 'clean' then
    v_pet.clean := least(v_stat_max, v_old_clean + v_recovery);
  elsif p_action = 'play' then
    v_pet.happiness := least(v_happiness_max, v_old_happiness + v_recovery);
  elsif p_action = 'heal' or p_action = 'medical' then
    v_pet.health := least(v_stat_max, v_old_health + v_recovery);
  end if;

  -- 日期更新
  if p_action = 'feed' then v_pet.last_feed_date := v_today;
  elsif p_action = 'clean' then v_pet.last_clean_date := v_today;
  elsif p_action = 'play' then v_pet.last_play_date := v_today;
  elsif p_action = 'heal' or p_action = 'medical' then v_pet.last_care_date := v_today;
  end if;

  -- 每日经验日志
  select * into v_log from public.pet_daily_exp_log where pet_id = p_pet_id and log_date = v_today;
  if not found then
    insert into public.pet_daily_exp_log (pet_id, log_date) values (p_pet_id, v_today);
    select * into v_log from public.pet_daily_exp_log where pet_id = p_pet_id and log_date = v_today;
  end if;

  -- 满额经验：体力+10 / 清洁+10 / 心情+10（每次满额触发，happiness_rounds每日上限3）
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

  if p_action = 'play' and v_pet.happiness >= v_happiness_max and v_old_happiness < v_happiness_max then
    if coalesce(v_log.happiness_rounds, 0) < 3 then
      update public.pet_daily_exp_log set happiness_rounds = happiness_rounds + 1
        where pet_id = p_pet_id and log_date = v_today;
      v_exp_gain := v_exp_gain + 10;
    end if;
  end if;

  -- 每日经验上限50
  select * into v_log from public.pet_daily_exp_log where pet_id = p_pet_id and log_date = v_today;
  v_daily_total := coalesce(v_log.hunger_full_count, 0) * 10
    + coalesce(v_log.clean_full_count, 0) * 10
    + coalesce(v_log.happiness_rounds, 0) * 10;
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

  -- 玩耍金币
  if p_action = 'play' then
    v_daily_coin := coalesce(v_log.daily_coin_earned, 0);
    if v_daily_coin < 5 then
      v_coin_earned := least(5 - v_daily_coin, 1.00);
      v_pet.coin_balance := coalesce(v_pet.coin_balance, 0) + v_coin_earned;
      update public.pet_daily_exp_log set daily_coin_earned = coalesce(daily_coin_earned, 0) + v_coin_earned
        where pet_id = p_pet_id and log_date = v_today;
    end if;
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
    exp = v_pet.exp,
    pending_levelup = v_pet.pending_levelup,
    coin_balance = v_pet.coin_balance
  where public.pets.id = p_pet_id;

  return query select * from public.pets where public.pets.id = p_pet_id;
end;
$$;
revoke all on function public.interact_with_pet(uuid, uuid, text, uuid) from public;
grant execute on function public.interact_with_pet(uuid, uuid, text, uuid) to anon, authenticated;

-- ============================================================
-- 四、run_daily_boarding_care: 心情补满300 + 心情经验30
-- ============================================================
create or replace function public.run_daily_boarding_care(p_member_id uuid default null)
returns void
language plpgsql security definer as $$
declare
  v_member record;
  v_pet record;
  v_selected_ids uuid[];
  v_total_gap int;
  v_stars_needed int;
  v_daily_coin numeric;
  v_today date := (now() at time zone 'Asia/Shanghai')::date;
  v_old_hunger int;
  v_old_clean int;
  v_old_happiness int;
  v_exp_gain int;
  v_new_exp int;
  v_exp_needed int;
  v_log record;
  v_daily_total int;
  v_new_star int;
  v_coin_gain numeric := 0;
begin
  for v_member in
    select m.id, m.family_id, m.star_value
    from public.members m
    where (p_member_id is null or m.id = p_member_id)
      and exists (
        select 1 from public.pet_boarding_cards c
        where c.member_id = m.id and c.end_date >= v_today
      )
  loop
    if exists (
      select 1 from public.pet_boarding b
      where b.member_id = v_member.id and b.board_date = v_today
    ) then
      continue;
    end if;

    select array_agg(pet_id) into v_selected_ids
    from public.pet_boarding_selection
    where member_id = v_member.id and selected = true;

    if v_selected_ids is null or array_length(v_selected_ids, 1) = 0 then
      continue;
    end if;

    v_total_gap := 0;
    for v_pet in
      select p.id, p.hunger, p.clean, p.happiness,
             public.pet_is_sick(p.has_stomach_issue, p.has_skin_issue, p.has_severe_illness) as sick
      from public.pets p
      where p.id = any(v_selected_ids)
    loop
      if v_pet.sick then continue; end if;
      v_total_gap := v_total_gap
        + greatest(0, 100 - coalesce(v_pet.hunger, 0))
        + greatest(0, 100 - coalesce(v_pet.clean, 0))
        + greatest(0, 300 - coalesce(v_pet.happiness, 0));
    end loop;

    v_stars_needed := ceil(coalesce(v_total_gap, 0)::numeric / 5.0)::int;

    if v_member.star_value < v_stars_needed then
      continue;
    end if;

    if v_stars_needed > 0 then
      v_new_star := v_member.star_value - v_stars_needed;
      update public.members set star_value = v_new_star, updated_at = now()
      where id = v_member.id;
      insert into public.coin_records (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by, balance_type)
      values (v_member.family_id, v_member.id, -v_stars_needed, v_new_star,
        '萌宠托管消耗星光值，产出金币', 'boarding', 'pet_boarding', null, v_member.id, 'star');
    end if;

    for v_pet in
      select p.*,
             public.pet_is_sick(p.has_stomach_issue, p.has_skin_issue, p.has_severe_illness) as sick
      from public.pets p
      where p.id = any(v_selected_ids)
    loop
      if v_pet.sick then continue; end if;

      v_old_hunger := coalesce(v_pet.hunger, 0);
      v_old_clean := coalesce(v_pet.clean, 0);
      v_old_happiness := coalesce(v_pet.happiness, 0);

      update public.pets set
        hunger = 100,
        clean = 100,
        happiness = 300,
        last_feed_date = v_today,
        last_clean_date = v_today,
        last_happiness_date = v_today,
        last_care_date = v_today,
        days_without_feed = 0,
        days_without_clean = 0,
        days_without_care = 0
      where id = v_pet.id;

      -- 经验值发放
      select * into v_log from public.pet_daily_exp_log
        where pet_id = v_pet.id and log_date = v_today;
      if not found then
        insert into public.pet_daily_exp_log (pet_id, log_date)
          values (v_pet.id, v_today)
          on conflict (pet_id, log_date) do nothing;
        select * into v_log from public.pet_daily_exp_log
          where pet_id = v_pet.id and log_date = v_today;
      end if;

      v_exp_gain := 0;

      -- 体力补满 +10
      if v_old_hunger < 100 and coalesce(v_log.hunger_full_count, 0) < 1 then
        update public.pet_daily_exp_log set hunger_full_count = 1
          where pet_id = v_pet.id and log_date = v_today;
        v_exp_gain := v_exp_gain + 10;
      end if;
      -- 清洁补满 +10
      if v_old_clean < 100 and coalesce(v_log.clean_full_count, 0) < 1 then
        update public.pet_daily_exp_log set clean_full_count = 1
          where pet_id = v_pet.id and log_date = v_today;
        v_exp_gain := v_exp_gain + 10;
      end if;
      -- 心情补满300 +30（托管一次性补满，经验30）
      if v_old_happiness < 300 and coalesce(v_log.mood_full_count, 0) < 1 then
        update public.pet_daily_exp_log set mood_full_count = 1
          where pet_id = v_pet.id and log_date = v_today;
        v_exp_gain := v_exp_gain + 30;
      end if;

      -- 每日经验上限50：10+10+30=50
      select * into v_log from public.pet_daily_exp_log
        where pet_id = v_pet.id and log_date = v_today;
      v_daily_total := coalesce(v_log.hunger_full_count, 0) * 10
        + coalesce(v_log.clean_full_count, 0) * 10
        + coalesce(v_log.mood_full_count, 0) * 30;
      if v_daily_total > 50 then
        v_exp_gain := 0;
      end if;

      if v_exp_gain > 0 then
        v_new_exp := coalesce(v_pet.exp, 0) + v_exp_gain;
        v_exp_needed := public.exp_needed(coalesce(v_pet.level, 1), coalesce(v_pet.rarity, 'common'));
        if v_new_exp >= v_exp_needed then
          update public.pets set exp = v_new_exp, pending_levelup = true where id = v_pet.id;
          perform public.add_pet_message(v_pet.member_id, v_pet.id, 'level_up',
            v_pet.name, v_pet.name || ' 升级了，可以去升级啦！');
        else
          update public.pets set exp = v_new_exp where id = v_pet.id;
        end if;
      end if;

      -- 三项属性补满 → 每日金币
      v_coin_gain := 0;
      if v_pet.last_coin_date is null or v_pet.last_coin_date < v_today then
        v_daily_coin := coalesce(v_pet.base_coin_per_day, 0)
          * (1.0 + coalesce(v_pet.upgrade_percent, 10.0) / 100.0 * (coalesce(v_pet.level, 1) - 1));
        update public.pets set
          coin_balance = coalesce(coin_balance, 0) + v_daily_coin,
          last_coin_date = v_today
        where id = v_pet.id;
        perform public.add_pet_message(v_pet.member_id, v_pet.id, 'coin_harvest',
          v_pet.name, v_pet.name || ' 收获了 ' || round(v_daily_coin)::int || ' 金币');
        v_coin_gain := coalesce(v_daily_coin, 0);
      end if;

      insert into public.pet_boarding (family_id, member_id, pet_id, board_date)
      values (v_pet.family_id, v_member.id, v_pet.id, v_today)
      on conflict do nothing;

      -- 记录当日托管收益明细（幂等）
      insert into public.pet_boarding_log
        (family_id, member_id, pet_id, board_date,
         hunger_gain, clean_gain, happiness_gain, exp_gain, coin_gain)
      values
        (v_pet.family_id, v_member.id, v_pet.id, v_today,
         greatest(0, 100 - v_old_hunger),
         greatest(0, 100 - v_old_clean),
         greatest(0, 300 - v_old_happiness),
         v_exp_gain,
         v_coin_gain)
      on conflict (member_id, pet_id, board_date) do nothing;
    end loop;
  end loop;
end;
$$;
revoke all on function public.run_daily_boarding_care(uuid) from public;
grant execute on function public.run_daily_boarding_care(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
