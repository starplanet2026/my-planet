-- 0155: 宠物消息区分"升级奖励"和"今日产金"
-- 1. pet_messages.event_type 新增 'level_reward' 类型
-- 2. complete_pet_levelup 升级时写入"升级奖励"消息
-- 3. interact_with_pet / run_daily_boarding_care 的 coin_harvest 消息文案改为"今日产金"
-- 4. 矫正历史消息：将 coin_harvest 文案统一为"今日产金"

-- ============================================================
-- 一、扩展 event_type 约束，新增 level_reward
-- ============================================================
alter table public.pet_messages
  drop constraint if exists pet_messages_event_type_check;
alter table public.pet_messages
  add constraint pet_messages_event_type_check
  check (event_type in ('level_up','coin_harvest','sick','new_pet','level_reward'));

-- ============================================================
-- 二、complete_pet_levelup 增加升级奖励消息
-- ============================================================
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
  v_new_level int;
  v_new_exp_to_next int;
  v_carry_exp int;
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

  -- 升级奖励：(当前等级 + 1) × 1.25
  v_reward := (coalesce(v_pet.level, 1) + 1) * 1.25;

  v_evolved_bonus := coalesce(v_pet.evolved_bonus, 0.0);
  v_new_max_blood := round(coalesce(v_pet.current_max_blood, 100) * (1.05 + v_evolved_bonus * 0.01))::int;

  v_new_level := coalesce(v_pet.level, 1) + 1;
  v_new_exp_to_next := public.exp_needed(v_new_level, coalesce(v_pet.rarity, 'common'));

  v_carry_exp := greatest(0, coalesce(v_pet.exp, 0) - v_exp_needed);

  update public.pets set
    level = v_new_level,
    exp = v_carry_exp,
    exp_to_next = v_new_exp_to_next,
    current_max_blood = v_new_max_blood,
    daily_decay_base = coalesce(v_pet.daily_decay_base, 5) + 1,
    coin_balance = coalesce(v_pet.coin_balance, 0) + v_reward,
    pending_levelup = (v_carry_exp >= v_new_exp_to_next and v_new_level < coalesce(v_pet.max_level, 10))
  where public.pets.id = p_pet_id;

  update public.members
    set coin_balance = coalesce(coin_balance, 0) + v_reward, updated_at = now()
    where public.members.id = p_member_id;

  -- 写入升级奖励消息
  perform public.add_pet_message(p_member_id, p_pet_id, 'level_reward',
    v_pet.name, v_pet.name || ' 升级奖励 ' || round(v_reward)::int || ' 金币');

  return query select * from public.pets where public.pets.id = p_pet_id;
end;
$$;
grant execute on function public.complete_pet_levelup(uuid, uuid) to anon, authenticated;

-- ============================================================
-- 三、修改 interact_with_pet：coin_harvest 文案改为"今日产金"
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
  v_happiness_max int := 300;
  v_old_hunger int;
  v_old_clean int;
  v_old_happiness int;
  v_old_health int;
  v_log record;
  v_today date := (now() at time zone 'Asia/Shanghai')::date;
  v_daily_total int := 0;
  v_daily_coin numeric(10,2);
  v_was_pending boolean;
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
  v_was_pending := coalesce(v_pet.pending_levelup, false);

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

  if p_action = 'feed' then
    v_pet.hunger := least(v_stat_max, v_old_hunger + v_recovery);
  elsif p_action = 'clean' then
    v_pet.clean := least(v_stat_max, v_old_clean + v_recovery);
  elsif p_action = 'play' then
    v_pet.happiness := least(v_happiness_max, v_old_happiness + v_recovery);
  elsif p_action = 'heal' or p_action = 'medical' then
    v_pet.health := least(v_stat_max, v_old_health + v_recovery);
  end if;

  if p_action = 'feed' then v_pet.last_feed_date := v_today;
  elsif p_action = 'clean' then v_pet.last_clean_date := v_today;
  elsif p_action = 'play' then v_pet.last_play_date := v_today;
  elsif p_action = 'heal' or p_action = 'medical' then v_pet.last_care_date := v_today;
  end if;

  select * into v_log from public.pet_daily_exp_log where pet_id = p_pet_id and log_date = v_today;
  if not found then
    insert into public.pet_daily_exp_log (pet_id, log_date) values (p_pet_id, v_today);
    select * into v_log from public.pet_daily_exp_log where pet_id = p_pet_id and log_date = v_today;
  end if;

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
      if not v_was_pending then
        perform public.add_pet_message(p_member_id, p_pet_id, 'level_up',
          v_pet.name, v_pet.name || ' 升级了，可以去升级啦！');
      end if;
    else
      v_pet.exp := v_new_exp;
    end if;
  end if;

  -- 玩耍金币（每日上限5）
  if p_action = 'play' then
    v_daily_coin := coalesce(v_log.daily_coin_earned, 0);
    if v_daily_coin < 5 then
      v_coin_earned := least(5 - v_daily_coin, 1.00);
      v_pet.coin_balance := coalesce(v_pet.coin_balance, 0) + v_coin_earned;
      update public.pet_daily_exp_log set daily_coin_earned = coalesce(daily_coin_earned, 0) + v_coin_earned
        where pet_id = p_pet_id and log_date = v_today;
    end if;
  end if;

  -- 4项满 → 每日产金（1次/天）
  if coalesce(v_pet.hunger, 0) >= v_stat_max
     and coalesce(v_pet.clean, 0) >= v_stat_max
     and coalesce(v_pet.happiness, 0) >= v_happiness_max
     and coalesce(v_pet.health, 0) >= v_stat_max
     and not (v_old_hunger >= v_stat_max and v_old_clean >= v_stat_max
              and v_old_happiness >= v_happiness_max and v_old_health >= v_stat_max)
     and coalesce(v_log.daily_coin_claimed, false) = false
  then
    v_daily_coin := coalesce(v_pet.base_coin_per_day, 1) * (1 + (coalesce(v_pet.level, 1) - 1) * 0.1);
    v_coin_earned := round(v_daily_coin)::int;
    v_pet.coin_balance := coalesce(v_pet.coin_balance, 0) + v_coin_earned;
    update public.pet_daily_exp_log set daily_coin_claimed = true
      where pet_id = p_pet_id and log_date = v_today;
    perform public.add_pet_message(p_member_id, p_pet_id, 'coin_harvest',
      v_pet.name, v_pet.name || ' 今日产金 ' || v_coin_earned || ' 金币');
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
-- 四、修改 run_daily_boarding_care：coin_harvest 文案改为"今日产金"
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

      if v_old_hunger < 100 and coalesce(v_log.hunger_full_count, 0) < 1 then
        update public.pet_daily_exp_log set hunger_full_count = 1
          where pet_id = v_pet.id and log_date = v_today;
        v_exp_gain := v_exp_gain + 10;
      end if;
      if v_old_clean < 100 and coalesce(v_log.clean_full_count, 0) < 1 then
        update public.pet_daily_exp_log set clean_full_count = 1
          where pet_id = v_pet.id and log_date = v_today;
        v_exp_gain := v_exp_gain + 10;
      end if;
      if v_old_happiness < 300 and coalesce(v_log.mood_full_count, 0) < 1 then
        update public.pet_daily_exp_log set mood_full_count = 1
          where pet_id = v_pet.id and log_date = v_today;
        v_exp_gain := v_exp_gain + 30;
      end if;

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

      -- 今日产金
      v_coin_gain := 0;
      if v_pet.last_coin_date is null or v_pet.last_coin_date < v_today then
        v_daily_coin := coalesce(v_pet.base_coin_per_day, 0)
          * (1.0 + coalesce(v_pet.upgrade_percent, 10.0) / 100.0 * (coalesce(v_pet.level, 1) - 1));
        update public.pets set
          coin_balance = coalesce(coin_balance, 0) + v_daily_coin,
          last_coin_date = v_today
        where id = v_pet.id;
        perform public.add_pet_message(v_pet.member_id, v_pet.id, 'coin_harvest',
          v_pet.name, v_pet.name || ' 今日产金 ' || round(v_daily_coin)::int || ' 金币');
        v_coin_gain := coalesce(v_daily_coin, 0);
      end if;

      insert into public.pet_boarding (family_id, member_id, pet_id, board_date)
      values (v_pet.family_id, v_member.id, v_pet.id, v_today)
      on conflict do nothing;

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

-- ============================================================
-- 五、矫正历史消息数据
-- ============================================================

-- 5.1 将旧的 coin_harvest 消息文案统一为"今日产金"格式
-- 原文："XXX 收获了 N 金币" → 新："XXX 今日产金 N 金币"
update public.pet_messages
  set message = regexp_replace(message, '^(.+?)\s+收获了\s+(\d+)\s+金币$', '\1 今日产金 \2 金币')
  where event_type = 'coin_harvest'
    and message ~ '\s+收获了\s+\d+\s+金币$';

-- 5.2 对已经是"今日产金"格式的跳过（幂等）
-- 5.3 level_up 消息保持不变（"XXX 升级了，可以去升级啦！"）

notify pgrst, 'reload schema';
