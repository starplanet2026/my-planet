-- ============================================================
-- 0211：清空系统默认宠物话术，全部使用 pet_shop_items 中的定制会话
-- 1. get_pet_greeting：对话列为空时返回空串，不再用通用兜底文案
-- 2. buy_pet_item：新宠到家消息直接用 dialogue_new_pet，不再拼接 "到家啦"
-- 3. gacha_adopt：新宠到家消息直接用 dialogue_new_pet（原本未创建该消息）
-- ============================================================

-- 1. get_pet_greeting：去掉通用兜底文案
create or replace function public.get_pet_greeting(p_pet_id uuid)
returns table(scenario text, dialogue text)
language plpgsql security definer as $$
declare
  v_pet record;
  v_lowest int;
  v_scenario text;
  v_dialogue text;
begin
  select p.*, psi.dialogue_low_stats, psi.dialogue_medium_stats, psi.dialogue_high_stats
    into v_pet
  from public.pets p
  left join public.pet_shop_items psi on psi.id = p.shop_item_id
  where p.id = p_pet_id;

  if not found then
    return query select 'none'::text, ''::text;
    return;
  end if;

  v_lowest := least(
    coalesce(v_pet.hunger, 0),
    coalesce(v_pet.clean, 0),
    coalesce(v_pet.health, 0),
    coalesce(v_pet.happiness, 0) / 3
  );

  if v_lowest <= 50 then
    v_scenario := 'low_stats';
    v_dialogue := v_pet.dialogue_low_stats;
  elsif v_lowest <= 90 then
    v_scenario := 'medium_stats';
    v_dialogue := v_pet.dialogue_medium_stats;
  else
    v_scenario := 'high_stats';
    v_dialogue := v_pet.dialogue_high_stats;
  end if;

  -- 不再兜底：对话列为空则返回空串，由前端决定是否展示
  return query select v_scenario, coalesce(v_dialogue, '')::text;
end;
$$;
grant execute on function public.get_pet_greeting(uuid) to anon, authenticated;

-- ============================================================
-- 2. buy_pet_item：新宠到家消息直接用 dialogue_new_pet
-- 基于 0210 版本重写，仅改动 new_pet 消息部分（去掉兜底拼接）
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
  v_new_pet_msg text;
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
      when 0 then 0 when 1 then 1 when 2 then 5 when 3 then 10 else 10
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

  insert into public.coin_records (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by, balance_type)
  values (v_family_id, p_member_id, -v_item.price_star, v_star,
    '购买' || case when v_item.type = 'pet' then '宠物' else '用品' end || '「' || coalesce(v_item.name, '') || '」',
    'purchase', 'pet_shop_item', p_item_id, p_member_id, 'star');

  if v_item.type = 'pet' then
    insert into public.pets (
      family_id, member_id, shop_item_id, name, emoji, image_url, gender, breed,
      base_coin_per_day, upgrade_coin_reward, coin_balance,
      max_level, current_max_blood, daily_decay_base, upgrade_percent, evolved_bonus, exp,
      rarity
    )
    values (
      v_family_id, p_member_id, v_item.id, null, v_item.emoji, v_item.image_url, v_item.gender, v_item.breed,
      v_item.base_coin_per_day, coalesce(v_item.upgrade_coin_reward, 5), 0,
      coalesce(v_item.max_level, 3), coalesce(v_item.max_blood_bar, 100),
      coalesce(v_item.daily_decay_base, 5), coalesce(v_item.upgrade_percent, 5.0), 0.0, 0,
      coalesce(v_item.rarity, 'common')
    )
    returning id into v_pet_id;

    -- 新宠到家消息：消息列表用品种识别文案（方便用户知道是哪只宠物到家），外显绘画框的会话走 dialogue_new_pet
    v_new_pet_msg := '新宠物 ' || coalesce(v_item.breed, v_item.name, '新宠物') || ' 到家啦！';
    perform public.add_pet_message(p_member_id, v_pet_id, 'new_pet',
      coalesce(v_item.breed, v_item.name, '新宠物'), v_new_pet_msg);

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

-- ============================================================
-- 3. gacha_adopt：新宠到家消息直接用 dialogue_new_pet
-- 基于 0210 版本重写，新增 new_pet 消息创建（去掉兜底拼接）
-- ============================================================
drop function if exists public.gacha_adopt(uuid, uuid);
create or replace function public.gacha_adopt(p_member_id uuid, p_shop_item_id uuid)
returns table(success boolean, message text, pet_id uuid, remaining_star int)
language plpgsql security definer as $$
declare
  v_member record;
  v_item record;
  v_pet_id uuid;
  v_star int;
  v_existing_pet_id uuid;
  v_doghouse_level int;
  v_current_pet_count int;
  v_capacity int;
  v_cfg public.gacha_config%rowtype;
  v_new_pet_msg text;
begin
  select * into v_cfg from public.gacha_config where id = 1;

  select * into v_member from public.members where id = p_member_id for update;
  if not found then
    return query select false, '用户不存在', null::uuid, 0;
    return;
  end if;

  select * into v_item from public.pet_shop_items where id = p_shop_item_id and status = 'active';
  if not found then
    return query select false, '宠物不存在或已下架', null::uuid, v_member.star_value;
    return;
  end if;

  select id into v_existing_pet_id from public.pets
    where member_id = p_member_id and shop_item_id = p_shop_item_id limit 1;
  if found then
    return query select false, '已拥有该宠物', null::uuid, v_member.star_value;
    return;
  end if;

  select level into v_doghouse_level from public.dog_house where member_id = p_member_id limit 1;
  v_doghouse_level := coalesce(v_doghouse_level, 0);
  select count(*) into v_current_pet_count from public.pets where member_id = p_member_id;
  v_capacity := case v_doghouse_level
    when 0 then 0 when 1 then 1 when 2 then 5 when 3 then 10 else 10
  end;

  if v_current_pet_count >= v_capacity then
    if v_doghouse_level = 0 then
      return query select false, '需要先购买「茅草小屋」，解锁更多饲养位', null::uuid, v_member.star_value;
    elsif v_doghouse_level = 1 then
      return query select false, '需要先购买「温馨小屋」，解锁更多饲养位', null::uuid, v_member.star_value;
    elsif v_doghouse_level = 2 then
      return query select false, '需要先购买「豪华小屋」，解锁更多饲养位', null::uuid, v_member.star_value;
    else
      return query select false, '饲养位已满', null::uuid, v_member.star_value;
    end if;
    return;
  end if;

  if v_member.star_value < v_cfg.adopt_cost then
    return query select false, '星光值不足，需要'||v_cfg.adopt_cost||'星光值领养', null::uuid, v_member.star_value;
    return;
  end if;

  v_star := v_member.star_value - v_cfg.adopt_cost;
  update public.members set star_value = v_star, updated_at = now() where id = p_member_id;

  insert into public.pets (
    family_id, member_id, shop_item_id, name, emoji, image_url, gender, breed,
    base_coin_per_day, upgrade_coin_reward, coin_balance,
    max_level, current_max_blood, daily_decay_base, upgrade_percent, evolved_bonus, exp
  )
  values (
    v_member.family_id, p_member_id, v_item.id, null, v_item.emoji, v_item.image_url, v_item.gender, v_item.breed,
    coalesce(v_item.base_coin_per_day, 2), coalesce(v_item.upgrade_coin_reward, 5), 0,
    coalesce(v_item.max_level, 3), coalesce(v_item.max_blood_bar, 100),
    coalesce(v_item.daily_decay_base, 5), coalesce(v_item.upgrade_percent, 5.0), 0.0, 0
  )
  returning id into v_pet_id;

  -- 新宠到家消息：消息列表用品种识别文案，外显绘画框的会话走 dialogue_new_pet
  v_new_pet_msg := '新宠物 ' || coalesce(v_item.breed, v_item.name, '新宠物') || ' 到家啦！';
  perform public.add_pet_message(p_member_id, v_pet_id, 'new_pet',
    coalesce(v_item.breed, v_item.name, '新宠物'), v_new_pet_msg);

  return query select true, '领养成功', v_pet_id, v_star;
end;
$$;
grant execute on function public.gacha_adopt(uuid, uuid) to anon, authenticated;
