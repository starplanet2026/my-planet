-- 0117: 宠物消息面板
-- 新增 pet_messages 表，记录宠物关键动态：升级 / 收获金币 / 生病 / 新宠物到家
-- 修改 interact_with_pet、check_pet、buy_pet_item、run_daily_boarding_care 插入消息
-- 提供 get_pet_messages（分页+30天）和 clear_pet_messages RPC

-- ====== 1. 消息表 ======
create table if not exists public.pet_messages (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  pet_id uuid references public.pets(id) on delete set null,
  event_type text not null check (event_type in ('level_up','coin_harvest','sick','new_pet')),
  pet_name text,
  message text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_pet_messages_member_created
  on public.pet_messages(member_id, created_at desc);

-- 自动清理超过 90 天的消息（性能兜底）
create or replace function public.cleanup_old_pet_messages()
returns void language plpgsql security definer as $$
begin
  delete from public.pet_messages where created_at < now() - interval '90 days';
end;
$$;

-- ====== 2. 写入消息辅助函数 ======
create or replace function public.add_pet_message(
  p_member_id uuid,
  p_pet_id uuid,
  p_event_type text,
  p_pet_name text,
  p_message text
) returns void language plpgsql security definer as $$
declare
  v_family_id uuid;
begin
  select family_id into v_family_id from public.members where id = p_member_id;
  if v_family_id is null then return; end if;
  insert into public.pet_messages (family_id, member_id, pet_id, event_type, pet_name, message)
  values (v_family_id, p_member_id, p_pet_id, p_event_type, coalesce(p_pet_name, '宠物'), p_message);
end;
$$;
grant execute on function public.add_pet_message(uuid, uuid, text, text, text) to anon, authenticated;

-- ====== 3. 查询消息（分页 + 仅最近 30 天） ======
create or replace function public.get_pet_messages(
  p_member_id uuid,
  p_limit int default 50,
  p_offset int default 0
) returns setof public.pet_messages language plpgsql security definer as $$
begin
  return query select * from public.pet_messages
    where member_id = p_member_id
      and created_at >= now() - interval '30 days'
    order by created_at desc
    limit p_limit offset p_offset;
end;
$$;
grant execute on function public.get_pet_messages(uuid, int, int) to anon, authenticated;

-- ====== 4. 清空消息 ======
create or replace function public.clear_pet_messages(p_member_id uuid)
returns void language plpgsql security definer as $$
begin
  delete from public.pet_messages where member_id = p_member_id;
end;
$$;
grant execute on function public.clear_pet_messages(uuid) to anon, authenticated;

-- ====== 5. 修改 interact_with_pet：升级 + 收获金币 时写消息 ======
-- 基于 0097 版本，在升级判定和金币发放处追加 add_pet_message 调用
drop function if exists public.interact_with_pet(uuid, uuid, text, uuid);

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
  v_coin_earned int := 0;
  v_stat_max int := 100;
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
  if p_action = 'play' and v_old_happiness >= v_stat_max then
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;
  if (p_action = 'heal' or p_action = 'medical') and v_old_health >= v_stat_max then
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;

  select * into v_item from public.pet_shop_items
    where id = p_item_id and subcategory = v_required_sub limit 1;
  if not found then
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;

  v_recovery := coalesce(v_item.recovery_value, 20);

  select * into v_inv from public.pet_inventory
    where member_id = p_member_id and item_id = p_item_id and quantity > 0 limit 1;
  if not found then
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;

  update public.pet_inventory set quantity = quantity - 1
    where member_id = p_member_id and item_id = p_item_id;
  delete from public.pet_inventory
    where member_id = p_member_id and item_id = p_item_id and quantity <= 0;

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
  elsif p_action = 'play' then v_pet.last_happiness_date := v_today;
  elsif p_action = 'heal' or p_action = 'medical' then v_pet.last_care_date := v_today;
  end if;

  -- Daily exp log
  select * into v_log from public.pet_daily_exp_log where pet_id = p_pet_id and log_date = v_today;
  if not found then
    insert into public.pet_daily_exp_log (pet_id, log_date) values (p_pet_id, v_today)
      on conflict (pet_id, log_date) do nothing;
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

  if p_action = 'play' and v_pet.happiness >= v_stat_max and v_old_happiness < v_stat_max then
    if coalesce(v_log.mood_full_count, 0) < 3 then
      update public.pet_daily_exp_log set mood_full_count = mood_full_count + 1
        where pet_id = p_pet_id and log_date = v_today;
      v_exp_gain := v_exp_gain + 10;
    end if;
  end if;

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
      -- 升级消息（仅从非待升级变为待升级时写入）
      if not v_was_pending then
        perform public.add_pet_message(p_member_id, p_pet_id, 'level_up',
          v_pet.name, v_pet.name || ' 升级了，可以去升级啦！');
      end if;
    else
      v_pet.exp := v_new_exp;
    end if;
  end if;

  -- 金币：4 项满 → 每日金币（1 次/天）
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
    -- 收获金币消息
    perform public.add_pet_message(p_member_id, p_pet_id, 'coin_harvest',
      v_pet.name, v_pet.name || ' 收获了 ' || v_coin_earned || ' 金币');
  end if;

  update public.pets set
    hunger = v_pet.hunger,
    clean = v_pet.clean,
    happiness = v_pet.happiness,
    health = v_pet.health,
    last_feed_date = v_pet.last_feed_date,
    last_clean_date = v_pet.last_clean_date,
    last_happiness_date = v_pet.last_happiness_date,
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

-- ====== 6. 修改 check_pet：宠物生病时写消息 ======
drop function if exists public.check_pet(uuid);

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
  v_was_sick boolean;
  v_today_cn date;
  v_hours_since_fill float;
  v_need_update boolean := false;
begin
  select * into v_pet from public.pets where public.pets.id = p_pet_id for update;
  if not found then return; end if;

  v_today_cn := (now() at time zone 'Asia/Shanghai')::date;
  v_days := (v_today_cn - coalesce((v_pet.last_check_at at time zone 'Asia/Shanghai')::date, v_today_cn - 1))::int;
  v_was_sick := public.pet_is_sick(v_pet.has_stomach_issue, v_pet.has_skin_issue, v_pet.has_severe_illness);

  if v_days >= 1 then
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

    v_sick := public.pet_is_sick(v_pet.has_stomach_issue, v_pet.has_skin_issue, v_pet.has_severe_illness);
    -- 生病消息：从未生病变为生病时写入
    if v_sick and not v_was_sick then
      perform public.add_pet_message(v_pet.member_id, p_pet_id, 'sick',
        v_pet.name, v_pet.name || ' 生病了，快去治疗吧！');
    end if;

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

  -- Per-stat decay
  v_need_update := false;

  if coalesce(v_pet.hunger, 0) > 0
     and coalesce(v_pet.hunger_decay_count, 0) < 1
     and v_pet.last_hunger_fill_at is not null then
    v_hours_since_fill := extract(epoch from now() - v_pet.last_hunger_fill_at) / 3600.0;
    if v_hours_since_fill >= 24.0 then
      v_pet.hunger := 0;
      v_pet.hunger_decay_count := coalesce(v_pet.hunger_decay_count, 0) + 1;
      v_need_update := true;
    end if;
  end if;

  if coalesce(v_pet.clean, 0) > 0
     and coalesce(v_pet.clean_decay_count, 0) < 1
     and v_pet.last_clean_fill_at is not null then
    v_hours_since_fill := extract(epoch from now() - v_pet.last_clean_fill_at) / 3600.0;
    if v_hours_since_fill >= 24.0 then
      v_pet.clean := 0;
      v_pet.clean_decay_count := coalesce(v_pet.clean_decay_count, 0) + 1;
      v_need_update := true;
    end if;
  end if;

  if coalesce(v_pet.happiness, 0) > 0
     and coalesce(v_pet.happiness_decay_count, 0) < 3
     and v_pet.last_happiness_fill_at is not null then
    v_hours_since_fill := extract(epoch from now() - v_pet.last_happiness_fill_at) / 3600.0;
    if v_hours_since_fill >= 1.0 then
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

-- ====== 7. 修改 buy_pet_item：新宠物到家时写消息 ======
drop function if exists public.buy_pet_item(uuid, uuid);

create or replace function public.buy_pet_item(
  p_member_id uuid,
  p_item_id uuid
)
returns table(success boolean, message text, new_star int, new_coin int, pet_id uuid, inventory_qty int)
language plpgsql security definer as $$
declare
  v_item public.pet_shop_items%rowtype;
  v_member public.members%rowtype;
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
  if not found then return query select false, '商品不存在或已下架', 0, 0, null::uuid, 0; return; end if;

  select * into v_member from public.members where public.members.id = p_member_id for update;
  v_family_id := v_member.family_id;
  v_star := v_member.star_value;
  v_coin := v_member.coin_balance;

  if v_star < v_item.price_star then
    return query select false, '星光值不足', v_star, v_coin, null::uuid, 0; return;
  end if;

  if v_item.subcategory = 'doghouse' then
    return query select false, '请使用狗屋升级功能', v_star, v_coin, null::uuid, 0; return;
  end if;

  if v_item.type = 'pet' then
    select id into v_existing_pet_id from public.pets
    where member_id = p_member_id and shop_item_id = p_item_id
    limit 1;
    if found then
      return query select false, '已领养该宠物，不可重复购买', v_star, v_coin, null::uuid, 0; return;
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
        return query select false, '请先购买「茅草屋」才能领养宠物', v_star, v_coin, null::uuid, 0; return;
      elsif v_doghouse_level = 1 then
        return query select false, '狗屋容量不足，请先购买「温馨狗屋」', v_star, v_coin, null::uuid, 0; return;
      elsif v_doghouse_level = 2 then
        return query select false, '狗屋容量不足，请先购买「豪华狗屋」', v_star, v_coin, null::uuid, 0; return;
      else
        return query select false, '狗屋容量已满', v_star, v_coin, null::uuid, 0; return;
      end if;
    end if;
  end if;

  v_star := v_star - v_item.price_star;
  update public.members set star_value = v_star, updated_at = now() where public.members.id = p_member_id;

  if v_item.type = 'pet' then
    insert into public.pets (
      family_id, member_id, shop_item_id, name, emoji, image_url, gender,
      base_coin_per_day, upgrade_coin_reward, coin_balance,
      max_level, current_max_blood, daily_decay_base, upgrade_percent, evolved_bonus, exp
    )
    values (
      v_family_id, p_member_id, v_item.id, '新宠物', v_item.emoji, v_item.image_url, v_item.gender,
      v_item.base_coin_per_day, coalesce(v_item.upgrade_coin_reward, 5), 0,
      coalesce(v_item.max_level, 3), coalesce(v_item.max_blood_bar, 100),
      coalesce(v_item.daily_decay_base, 5), coalesce(v_item.upgrade_percent, 5.0), 0.0, 0
    )
    returning id into v_pet_id;

    -- 新宠物到家消息
    perform public.add_pet_message(p_member_id, v_pet_id, 'new_pet',
      coalesce(v_item.name, '新宠物'), '新宠物 ' || coalesce(v_item.name, '新宠物') || ' 到家啦！');

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

notify pgrst, 'reload schema';
