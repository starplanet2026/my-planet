-- 0119: 资产明细日志 - 补齐遗漏的 coin_records 写入 + 分页查询/清空 RPC
-- 为 buy_boarding_card / run_daily_boarding_care / buy_pet_item / buy_doghouse_upgrade
-- / evolve_pet / claim_study_starlight / finish_game_level 补充 coin_records 流水

-- ====== 1. 资产日志查询（分页 + 仅最近 30 天） ======
create or replace function public.get_asset_logs(
  p_member_id uuid,
  p_balance_type text,
  p_limit int default 20,
  p_offset int default 0
) returns setof public.coin_records language plpgsql security definer as $$
begin
  return query select * from public.coin_records
    where member_id = p_member_id
      and balance_type = p_balance_type
      and created_at >= now() - interval '30 days'
    order by created_at desc
    limit p_limit offset p_offset;
end;
$$;
grant execute on function public.get_asset_logs(uuid, text, int, int) to anon, authenticated;

-- ====== 2. 清空资产日志 ======
create or replace function public.clear_asset_logs(p_member_id uuid, p_balance_type text)
returns void language plpgsql security definer as $$
begin
  delete from public.coin_records
    where member_id = p_member_id and balance_type = p_balance_type;
end;
$$;
grant execute on function public.clear_asset_logs(uuid, text) to anon, authenticated;

-- ====== 3. buy_boarding_card：托管卡购买消耗星光，写流水 ======
create or replace function public.buy_boarding_card(
  p_member_id uuid,
  p_item_id uuid
)
returns table(success boolean, message text, new_star int, end_date date)
language plpgsql security definer as $$
declare
  v_member record;
  v_item record;
  v_family_id uuid;
  v_cost int;
  v_days int;
  v_last_end date;
  v_start date;
  v_new_end date;
  v_new_star int;
begin
  select * into v_member from public.members where id = p_member_id for update;
  if not found then
    return query select false, '用户不存在', 0, null::date;
    return;
  end if;
  v_family_id := v_member.family_id;

  select * into v_item from public.pet_shop_items
    where id = p_item_id and subcategory = 'foster' and status = 'active';
  if not found then
    return query select false, '托管卡不存在或已下架', v_member.star_value, null::date;
    return;
  end if;

  v_cost := coalesce(v_item.price_star, 0);
  v_days := coalesce(v_item.valid_days, 1);

  if v_member.star_value < v_cost then
    return query select false, '星光值不足', v_member.star_value, null::date;
    return;
  end if;

  v_new_star := v_member.star_value - v_cost;
  update public.members set star_value = v_new_star, updated_at = now() where id = p_member_id;

  -- 星光消耗流水
  insert into public.coin_records (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by, balance_type)
  values (v_family_id, p_member_id, -v_cost, v_new_star,
    '购买托管卡「' || coalesce(v_item.name, '托管卡') || '」', 'purchase', 'pet_shop_item', p_item_id, p_member_id::text, 'star');

  select max(pbc.end_date) into v_last_end
    from public.pet_boarding_cards pbc
    where pbc.member_id = p_member_id;

  if v_last_end is not null and v_last_end >= current_date then
    v_start := v_last_end + 1;
  else
    v_start := current_date;
  end if;
  v_new_end := v_start + v_days - 1;

  insert into public.pet_boarding_cards (family_id, member_id, card_type, item_id, start_date, end_date)
  values (v_family_id, p_member_id, coalesce(v_item.name, 'custom'), p_item_id, v_start, v_new_end);

  return query select true, '购买成功，有效期至 ' || v_new_end::text, v_new_star, v_new_end;
end;
$$;
revoke all on function public.buy_boarding_card(uuid, uuid) from public;
grant execute on function public.buy_boarding_card(uuid, uuid) to anon, authenticated;

-- ====== 4. run_daily_boarding_care：托管消耗星光，写流水 ======
-- 基于 0115 版本，在扣减星光后追加 coin_records 写入
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
        + greatest(0, 100 - coalesce(v_pet.happiness, 0));
    end loop;

    v_stars_needed := ceil(coalesce(v_total_gap, 0)::numeric / 5.0)::int;

    if v_member.star_value < v_stars_needed then
      continue;
    end if;

    if v_stars_needed > 0 then
      v_new_star := v_member.star_value - v_stars_needed;
      update public.members set star_value = v_new_star, updated_at = now()
      where id = v_member.id;
      -- 托管消耗星光流水
      insert into public.coin_records (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by, balance_type)
      values (v_member.family_id, v_member.id, -v_stars_needed, v_new_star,
        '萌宠托管消耗星光值，产出金币', 'boarding', 'pet_boarding', null, v_member.id::text, 'star');
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
        happiness = 100,
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
      if v_old_happiness < 100 and coalesce(v_log.mood_full_count, 0) < 3 then
        update public.pet_daily_exp_log set mood_full_count = 3
          where pet_id = v_pet.id and log_date = v_today;
        v_exp_gain := v_exp_gain + 10;
      end if;

      select * into v_log from public.pet_daily_exp_log
        where pet_id = v_pet.id and log_date = v_today;
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
          update public.pets set exp = v_new_exp, pending_levelup = true where id = v_pet.id;
          perform public.add_pet_message(v_pet.member_id, v_pet.id, 'level_up',
            v_pet.name, v_pet.name || ' 升级了，可以去升级啦！');
        else
          update public.pets set exp = v_new_exp where id = v_pet.id;
        end if;
      end if;

      -- 三项属性补满 → 每日金币
      if v_pet.last_coin_date is null or v_pet.last_coin_date < v_today then
        v_daily_coin := coalesce(v_pet.base_coin_per_day, 0)
          * (1.0 + coalesce(v_pet.upgrade_percent, 10.0) / 100.0 * (coalesce(v_pet.level, 1) - 1));
        update public.pets set
          coin_balance = coalesce(coin_balance, 0) + v_daily_coin,
          last_coin_date = v_today
        where id = v_pet.id;
        perform public.add_pet_message(v_pet.member_id, v_pet.id, 'coin_harvest',
          v_pet.name, v_pet.name || ' 收获了 ' || round(v_daily_coin)::int || ' 金币');
      end if;

      insert into public.pet_boarding (family_id, member_id, pet_id, board_date)
      values (v_pet.family_id, v_member.id, v_pet.id, v_today)
      on conflict do nothing;
    end loop;
  end loop;
end;
$$;
grant execute on function public.run_daily_boarding_care(uuid) to anon, authenticated;

-- ====== 5. buy_pet_item：商店购买消耗星光，写流水 ======
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
    where member_id = p_member_id and shop_item_id = p_item_id limit 1;
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

  -- 星光消耗流水
  insert into public.coin_records (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by, balance_type)
  values (v_family_id, p_member_id, -v_item.price_star, v_star,
    '购买' || case when v_item.type = 'pet' then '宠物' else '用品' end || '「' || coalesce(v_item.name, '') || '」',
    'purchase', 'pet_shop_item', p_item_id, p_member_id::text, 'star');

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

-- ====== 6. buy_doghouse_upgrade：狗屋升级消耗星光，写流水 ======
drop function if exists public.buy_doghouse_upgrade(uuid, uuid);
create or replace function public.buy_doghouse_upgrade(
  p_member_id uuid,
  p_item_id uuid
)
returns table(success boolean, message text, new_level int, new_capacity int, remaining_star int)
language plpgsql security definer as $$
declare
  v_item public.pet_shop_items%rowtype;
  v_member public.members%rowtype;
  v_dh public.dog_house%rowtype;
  v_star int;
  v_current_level int;
  v_target_level int;
  v_new_capacity int;
  v_family_id uuid;
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
  v_family_id := v_member.family_id;

  if v_star < v_item.price_star then
    return query select false, '星光值不足', 0, 0, v_star;
    return;
  end if;

  select * into v_dh from public.dog_house where member_id = p_member_id for update;
  v_current_level := coalesce(v_dh.level, 0);
  v_target_level := v_item.doghouse_level;

  if v_target_level <= v_current_level then
    return query select false, '已拥有该等级或更高狗屋', v_current_level, v_current_level, v_star;
    return;
  end if;

  v_star := v_star - v_item.price_star;
  update public.members set star_value = v_star, updated_at = now() where public.members.id = p_member_id;

  -- 星光消耗流水
  insert into public.coin_records (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by, balance_type)
  values (v_family_id, p_member_id, -v_item.price_star, v_star,
    '购买住所「' || coalesce(v_item.name, '狗屋') || '」', 'purchase', 'pet_shop_item', p_item_id, p_member_id::text, 'star');

  v_new_capacity := case v_target_level
    when 1 then 1
    when 2 then 5
    when 3 then 10
    else 10
  end;

  if v_dh is null then
    insert into public.dog_house (family_id, member_id, level)
    values (v_family_id, p_member_id, v_target_level);
  else
    update public.dog_house set level = v_target_level where member_id = p_member_id;
  end if;

  return query select true, '升级成功', v_target_level, v_new_capacity, v_star;
end;
$$;
grant execute on function public.buy_doghouse_upgrade(uuid, uuid) to anon, authenticated;

-- ====== 7. evolve_pet：进化消耗星光，写流水（保持原始签名） ======
drop function if exists public.evolve_pet(uuid, text);
create or replace function public.evolve_pet(
  p_pet_id uuid,
  p_target_rarity text
)
returns table(success boolean, message text, new_rarity text, new_max_level int, new_price_star int)
language plpgsql security definer as $$
declare
  v_pet record;
  v_member record;
  v_current_rarity text;
  v_target_rarity text := p_target_rarity;
  v_cost int;
  v_new_max_level int;
  v_new_base_coin numeric;
  v_new_upgrade_reward int;
  v_new_upgrade_percent numeric;
  v_new_max_blood int;
  v_new_decay int;
  v_family_id uuid;
  v_new_star int;
begin
  select * into v_pet from public.pets where public.pets.id = p_pet_id for update;
  if not found then
    return query select false, '宠物不存在', null::text, 0, 0;
    return;
  end if;

  select * into v_member from public.members where id = v_pet.member_id for update;
  if not found then
    return query select false, '用户不存在', null::text, 0, 0;
    return;
  end if;
  v_family_id := v_member.family_id;

  select rarity into v_current_rarity from pet_shop_items where id = v_pet.shop_item_id;

  if v_current_rarity = 'common' and v_target_rarity = 'rare' then
    v_cost := 150; v_new_max_level := 5;
    v_new_base_coin := 2 + random();
    v_new_upgrade_reward := 8 + floor(random() * 8);
    v_new_upgrade_percent := 8.0;
    v_new_max_blood := 100 + floor(random() * 21);
    v_new_decay := 5 + floor(random() * 3);
  elsif v_current_rarity = 'rare' and v_target_rarity = 'epic' then
    v_cost := 400; v_new_max_level := 7;
    v_new_base_coin := 3 + random();
    v_new_upgrade_reward := 15 + floor(random() * 16);
    v_new_upgrade_percent := 12.0;
    v_new_max_blood := 120 + floor(random() * 31);
    v_new_decay := 8 + floor(random() * 3);
  else
    return query select false, '无法从' || v_current_rarity || '进化到' || v_target_rarity, null::text, 0, 0;
    return;
  end if;

  if v_pet.level < v_pet.max_level then
    return query select false, '宠物需要满级才能进化', null::text, 0, 0;
    return;
  end if;

  if v_member.star_value < v_cost then
    return query select false, '星光值不足，需要' || v_cost, null::text, 0, 0;
    return;
  end if;

  v_new_star := v_member.star_value - v_cost;
  update public.members set star_value = v_new_star, updated_at = now() where id = v_pet.member_id;

  -- 星光消耗流水
  insert into public.coin_records (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by, balance_type)
  values (v_family_id, v_pet.member_id, -v_cost, v_new_star,
    '宠物「' || coalesce(v_pet.name, '') || '」进化为' || case when v_target_rarity = 'rare' then '稀有' else '史诗' end,
    'evolve', 'pet', p_pet_id, v_pet.member_id::text, 'star');

  update public.pets set
    max_level = v_new_max_level,
    base_coin_per_day = v_new_base_coin,
    upgrade_coin_reward = v_new_upgrade_reward,
    upgrade_percent = v_new_upgrade_percent,
    current_max_blood = round(v_new_max_blood * 1.1)::int,
    daily_decay_base = v_new_decay,
    evolved_bonus = 10.0,
    rarity = v_target_rarity
  where public.pets.id = p_pet_id;

  return query select true, '进化成功！等级保留，后续升级属性+10%', v_target_rarity, v_new_max_level, v_cost;
end;
$$;
grant execute on function public.evolve_pet(uuid, text) to anon, authenticated;

-- ====== 8. claim_study_starlight：进修领取星光，写流水（保持原始签名） ======
drop function if exists public.claim_study_starlight(uuid);
create or replace function public.claim_study_starlight(
  p_member_id uuid
)
returns table(success boolean, message text, total_claimed numeric, new_star int)
language plpgsql security definer as $$
declare
  v_member record;
  v_pet record;
  v_daily int;
  v_days int;
  v_pending numeric;
  v_total numeric := 0;
  v_family_id uuid;
  v_new_star int;
begin
  select * into v_member from public.members where id = p_member_id for update;
  if not found then
    return query select false, '用户不存在', 0, 0;
    return;
  end if;
  v_family_id := v_member.family_id;

  for v_pet in
    select * from public.pets
    where member_id = p_member_id and is_studying = true
    for update
  loop
    v_daily := public.study_daily_star(v_pet.rarity);
    v_days := (current_date - coalesce(v_pet.study_last_claim_date, v_pet.study_start_date))::int;
    if v_days < 0 then v_days := 0; end if;
    v_pending := v_days * v_daily;

    if v_pending > 0 then
      v_total := v_total + v_pending;
      update public.pets set
        study_total_star = coalesce(study_total_star, 0) + v_pending,
        study_last_claim_date = current_date
      where id = v_pet.id;
    end if;
  end loop;

  if v_total > 0 then
    v_new_star := v_member.star_value + v_total;
    update public.members set star_value = v_new_star, updated_at = now() where id = p_member_id;

    -- 星光获得流水
    insert into public.coin_records (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by, balance_type)
    values (v_family_id, p_member_id, v_total::int, v_new_star,
      '宠物进修产出星光值', 'study', 'pet_study', null, p_member_id::text, 'star');

    return query select true, '领取成功，获得 ' || v_total || ' 星光值', v_total, v_new_star;
  else
    return query select false, '暂无可领取的星光值', 0, v_member.star_value;
  end if;
end;
$$;
grant execute on function public.claim_study_starlight(uuid) to anon, authenticated;

-- ====== 9. finish_game_level：小游戏通关奖励星光，写流水 ======
drop function if exists public.finish_game_level(uuid, uuid, int, int, jsonb, jsonb, jsonb);

create or replace function public.finish_game_level(
  p_member_id uuid,
  p_family_id uuid,
  p_level integer,
  p_stars integer,
  p_word_ids jsonb,
  p_wrong_word_ids jsonb,
  p_last_selected_word_ids jsonb
)
returns table(success boolean, reward_star integer, new_star integer, new_unlocked_level integer)
language plpgsql security definer as $$
declare
  v_member public.members%rowtype;
  v_base_reward int;
  v_reward int;
  v_star int;
  v_new_unlocked int;
  v_word_id uuid;
  v_word_ids_arr text[];
  v_wrong_ids_arr text[];
  v_last_ids_arr text[];
  v_review_ids_arr text[];
  v_correct_ids_arr text[];
  v_old_order int;
  v_target int;
  v_review_row record;
  v_correct_review_row record;
  v_max_order int;
  v_shifted_count int;
  v_correct_row record;
begin
  v_base_reward := case
    when p_level between 1 and 20 then 5
    when p_level between 21 and 40 then 8
    when p_level between 41 and 60 then 10
    when p_level between 61 and 80 then 12
    when p_level between 81 and 100 then 15
    else 0
  end;
  v_reward := v_base_reward;

  -- 已通关关卡重做：不发星光值，保留原始通关奖励记录
  if exists (select 1 from public.game_level_results where member_id = p_member_id and level = p_level) then
    v_reward := 0;
  end if;

  if v_reward > 0 then
    select * into v_member from public.members where id = p_member_id for update;
    v_star := coalesce(v_member.star_value, 0) + v_reward;
    update public.members set star_value = v_star, updated_at = now() where id = p_member_id;

    -- 星光获得流水
    insert into public.coin_records (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by, balance_type)
    values (p_family_id, p_member_id, v_reward, v_star,
      '宠物小游戏第' || p_level || '关通关，获得星光值+' || v_reward,
      'upgrade', 'game_level', p_level::text, p_member_id::text, 'star');
  else
    select star_value into v_star from public.members where id = p_member_id;
  end if;

  -- 记录关卡结果：重做时不覆盖原 reward_star
  insert into public.game_level_results (family_id, member_id, level, stars, reward_star, word_ids, wrong_word_ids, last_selected_word_ids)
  values (p_family_id, p_member_id, p_level, 3, v_reward, p_word_ids, p_wrong_word_ids, p_last_selected_word_ids)
  on conflict (member_id, level) do update set
    stars = 3,
    word_ids = p_word_ids,
    wrong_word_ids = p_wrong_word_ids,
    last_selected_word_ids = p_last_selected_word_ids,
    completed_at = now();

  select array_agg(x::text) into v_word_ids_arr from jsonb_array_elements_text(p_word_ids) as x;
  select array_agg(x::text) into v_wrong_ids_arr from jsonb_array_elements_text(p_wrong_word_ids) as x;
  select array_agg(x::text) into v_last_ids_arr from jsonb_array_elements_text(p_last_selected_word_ids) as x;

  select array_agg(distinct x) into v_review_ids_arr
  from unnest(array_cat(coalesce(v_wrong_ids_arr, ARRAY[]::text[]), coalesce(v_last_ids_arr, ARRAY[]::text[]))) as x;

  select array_agg(distinct x) into v_correct_ids_arr
  from unnest(array_cat(coalesce(v_word_ids_arr, ARRAY[]::text[]), ARRAY[]::text[])) as x
  where x <> all(coalesce(v_review_ids_arr, ARRAY[]::text[]));

  if v_word_ids_arr is not null then
    foreach v_word_id in array v_word_ids_arr loop
      insert into public.game_word_stats (family_id, member_id, word_id, challenge_count, wrong_count, last_played_at)
      values (p_family_id, p_member_id, v_word_id, 1, 0, now())
      on conflict (member_id, word_id) do update set challenge_count = game_word_stats.challenge_count + 1, last_played_at = now();
    end loop;
  end if;

  if v_wrong_ids_arr is not null then
    foreach v_word_id in array v_wrong_ids_arr loop
      update public.game_word_stats set wrong_count = wrong_count + 1
      where member_id = p_member_id and word_id = v_word_id;
    end loop;
  end if;

  -- 复习成功的词回原位
  if v_word_ids_arr is not null then
    for v_correct_review_row in
      select id::text as wid, original_display_order as orig_order
      from public.pet_words
      where needs_review = true
        and id = any(v_word_ids_arr::uuid[])
        and (v_review_ids_arr is null or id <> all(v_review_ids_arr::uuid[]))
    loop
      if v_correct_review_row.orig_order is not null then
        update public.pet_words
        set display_order = display_order + 1
        where display_order >= v_correct_review_row.orig_order
          and id <> v_correct_review_row.wid::uuid;
        update public.pet_words
        set display_order = v_correct_review_row.orig_order, needs_review = false, original_display_order = null
        where id = v_correct_review_row.wid::uuid;
      else
        update public.pet_words set needs_review = false where id = v_correct_review_row.wid::uuid;
      end if;
    end loop;
  end if;

  select coalesce(max(display_order), 0) into v_max_order from public.pet_words;

  -- 错词 + 最后消除词 往后移 20 位
  if v_review_ids_arr is not null then
    for v_review_row in
      select id::text as wid, display_order as old_order, needs_review as already_review, original_display_order as orig_order
      from public.pet_words
      where id = any(v_review_ids_arr::uuid[])
      order by display_order desc
    loop
      v_old_order := v_review_row.old_order;
      v_target := v_old_order + 20;

      update public.pet_words
      set display_order = display_order - 1
      where display_order > v_old_order and display_order <= v_target;

      update public.pet_words
      set display_order = v_target
      where id = v_review_row.wid::uuid;

      if v_review_row.already_review = false or v_review_row.already_review is null then
        update public.pet_words
        set needs_review = true, original_display_order = coalesce(v_review_row.orig_order, v_old_order)
        where id = v_review_row.wid::uuid;
      end if;
    end loop;
  end if;

  select coalesce(max(display_order), 0) into v_max_order from public.pet_words;

  -- 正确消除的词移到词库末尾
  if v_correct_ids_arr is not null then
    for v_correct_row in
      select id::text as wid, display_order as old_order
      from public.pet_words
      where id = any(v_correct_ids_arr::uuid[])
        and (v_review_ids_arr is null or id <> all(v_review_ids_arr::uuid[]))
      order by display_order asc
    loop
      v_max_order := v_max_order + 1;
      update public.pet_words set display_order = v_max_order where id = v_correct_row.wid::uuid;
    end loop;
  end if;

  v_new_unlocked := p_level + 1;
  insert into public.pet_word_progress (family_id, member_id, total_rounds, total_matched, best_score, last_played_at, unlocked_level)
  values (p_family_id, p_member_id, 1, 0, 0, now(), v_new_unlocked)
  on conflict (member_id) do update set
    unlocked_level = greatest(pet_word_progress.unlocked_level, v_new_unlocked),
    last_played_at = now(),
    total_rounds = pet_word_progress.total_rounds + 1;

  return query select true, v_reward, v_star, v_new_unlocked;
end;
$$;

revoke all on function public.finish_game_level(uuid, uuid, int, int, jsonb, jsonb, jsonb) from public;
grant execute on function public.finish_game_level(uuid, uuid, int, int, jsonb, jsonb, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
