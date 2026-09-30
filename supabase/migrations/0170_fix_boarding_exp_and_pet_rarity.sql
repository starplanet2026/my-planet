-- 0170: 修复托管经验值发放 + 宠物稀有度数据不一致
-- Bug1: 托管补满属性时经验值未发放（属性已满时 v_old_hunger>=100 不触发经验条件）
-- Bug2: buy_pet_item INSERT 时未写入 rarity 字段，导致部分宠物 rarity 与 shop_item 不一致

-- ============================================================
-- 一、Bug1 修复：重写 run_daily_boarding_care
--    去掉 v_old_hunger < 100 等前置条件
--    只要当天该属性未发过经验（hunger_full_count < 1），托管就发放经验
--    这样即使属性之前已满，托管执行时也会发放当日经验
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
  v_mood_exp int;
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

      -- 设满属性同时更新 last_check_at
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
        days_without_care = 0,
        last_check_at = now()
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

      -- 关键修复：去掉 v_old_hunger < 100 前置条件
      -- 只要当天没发过体力满经验，托管就发放
      if coalesce(v_log.hunger_full_count, 0) < 1 then
        update public.pet_daily_exp_log set hunger_full_count = 1
          where pet_id = v_pet.id and log_date = v_today;
        v_exp_gain := v_exp_gain + 10;
      end if;
      if coalesce(v_log.clean_full_count, 0) < 1 then
        update public.pet_daily_exp_log set clean_full_count = 1
          where pet_id = v_pet.id and log_date = v_today;
        v_exp_gain := v_exp_gain + 10;
      end if;
      if coalesce(v_log.mood_full_count, 0) < 3 then
        v_mood_exp := (3 - coalesce(v_log.mood_full_count, 0)) * 10;
        update public.pet_daily_exp_log set mood_full_count = 3
          where pet_id = v_pet.id and log_date = v_today;
        v_exp_gain := v_exp_gain + v_mood_exp;
      end if;

      -- 每日经验上限50
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
-- 二、Bug1 数据补全：回溯历史托管记录，补发未发放的经验值
--    对 pet_boarding_log 中 exp_gain=0 的记录，检查当天 exp_log 状态
--    如果当天该属性未发过经验，补发对应经验值
-- ============================================================

-- 使用 DO 块批量补发
do $$
declare
  v_bl record;
  v_log record;
  v_exp_to_add int;
  v_new_exp int;
  v_exp_needed int;
  v_pet record;
begin
  for v_bl in
    select bl.id, bl.pet_id, bl.board_date, bl.exp_gain
    from public.pet_boarding_log bl
    where bl.exp_gain = 0
    order by bl.board_date
  loop
    -- 查询当天的 exp_log
    select * into v_log from public.pet_daily_exp_log
      where pet_id = v_bl.pet_id and log_date = v_bl.board_date;
    if not found then
      -- 创建记录
      insert into public.pet_daily_exp_log (pet_id, log_date)
        values (v_bl.pet_id, v_bl.board_date)
        on conflict do nothing;
      select * into v_log from public.pet_daily_exp_log
        where pet_id = v_bl.pet_id and log_date = v_bl.board_date;
    end if;

    v_exp_to_add := 0;

    -- 体力满经验 +10
    if coalesce(v_log.hunger_full_count, 0) < 1 then
      update public.pet_daily_exp_log set hunger_full_count = 1
        where pet_id = v_bl.pet_id and log_date = v_bl.board_date;
      v_exp_to_add := v_exp_to_add + 10;
    end if;
    -- 清洁满经验 +10
    if coalesce(v_log.clean_full_count, 0) < 1 then
      update public.pet_daily_exp_log set clean_full_count = 1
        where pet_id = v_bl.pet_id and log_date = v_bl.board_date;
      v_exp_to_add := v_exp_to_add + 10;
    end if;
    -- 心情满经验 +30
    if coalesce(v_log.mood_full_count, 0) < 3 then
      update public.pet_daily_exp_log set mood_full_count = 3
        where pet_id = v_bl.pet_id and log_date = v_bl.board_date;
      v_exp_to_add := v_exp_to_add + (3 - coalesce(v_log.mood_full_count, 0)) * 10;
    end if;

    if v_exp_to_add > 0 then
      -- 更新宠物经验值
      select * into v_pet from public.pets where id = v_bl.pet_id;
      if found then
        v_new_exp := coalesce(v_pet.exp, 0) + v_exp_to_add;
        v_exp_needed := public.exp_needed(coalesce(v_pet.level, 1), coalesce(v_pet.rarity, 'common'));
        if v_new_exp >= v_exp_needed then
          update public.pets set exp = v_new_exp, pending_levelup = true where id = v_bl.pet_id;
        else
          update public.pets set exp = v_new_exp where id = v_bl.pet_id;
        end if;
      end if;

      -- 更新 boarding_log 的 exp_gain
      update public.pet_boarding_log set exp_gain = v_exp_to_add
        where id = v_bl.id;
    end if;
  end loop;
end;
$$;

-- ============================================================
-- 三、Bug2 数据修正：修正 pets.rarity 与 pet_shop_items.rarity 不一致的记录
-- ============================================================
update public.pets p
set rarity = psi.rarity
from public.pet_shop_items psi
where p.shop_item_id = psi.id
  and p.rarity is distinct from psi.rarity;

-- ============================================================
-- 四、Bug2 函数修复：重写 buy_pet_item，INSERT 时加入 rarity 字段
-- ============================================================
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
    'purchase', 'pet_shop_item', p_item_id, p_member_id, 'star');

  if v_item.type = 'pet' then
    -- 关键修复：INSERT 时加入 rarity 字段
    insert into public.pets (
      family_id, member_id, shop_item_id, name, emoji, image_url, gender,
      base_coin_per_day, upgrade_coin_reward, coin_balance,
      max_level, current_max_blood, daily_decay_base, upgrade_percent, evolved_bonus, exp,
      rarity
    )
    values (
      v_family_id, p_member_id, v_item.id, '新宠物', v_item.emoji, v_item.image_url, v_item.gender,
      v_item.base_coin_per_day, coalesce(v_item.upgrade_coin_reward, 5), 0,
      coalesce(v_item.max_level, 3), coalesce(v_item.max_blood_bar, 100),
      coalesce(v_item.daily_decay_base, 5), coalesce(v_item.upgrade_percent, 5.0), 0.0, 0,
      coalesce(v_item.rarity, 'common')
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

notify pgrst, 'reload schema';
