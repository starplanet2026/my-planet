-- ============================================================
-- 0215: 宠物解锁规则
-- 抽卡池与商店可购买宠物保持一致：
--   - 普通狗: 始终可抽/可买
--   - 稀有狗: 拥有宠物>=2 解锁
--   - 史诗狗: 拥有宠物>=5 解锁
--   - 猫(所有稀有度): 拥有宠物>=10 且 至少1只正在店内进修 解锁
-- 涉及 RPC: gacha_start, buy_pet_item, gacha_adopt
-- ============================================================

-- ------------------------------------------------------------
-- 1. gacha_start: 增加解锁规则过滤
-- ------------------------------------------------------------
drop function if exists public.gacha_start(uuid);
create function public.gacha_start(p_member_id uuid)
returns table(
  success boolean,
  message text,
  drawn_item_id uuid,
  drawn_item_name text,
  drawn_item_emoji text,
  drawn_item_image text,
  drawn_item_rarity text,
  drawn_item_coin_per_day numeric,
  drawn_item_trait_id uuid,
  remaining_star int
)
language plpgsql security definer as $$
declare
  v_member record;
  v_cfg public.gacha_config%rowtype;
  v_picked record;
  v_owned_count int;
  v_has_studying boolean;
begin
  select * into v_member from public.members where id = p_member_id for update;
  if not found then
    return query select false, '用户不存在', null::uuid, null::text, null::text, null::text, null::text, null::numeric, null::uuid, 0;
    return;
  end if;

  select * into v_cfg from public.gacha_config where id = 1;

  if v_member.star_value < v_cfg.adopt_cost then
    return query select false, '星光值不足，需要'||v_cfg.adopt_cost||'星光值才能抽卡',
      null::uuid, null::text, null::text, null::text, null::text, null::numeric, null::uuid, v_member.star_value;
    return;
  end if;

  -- 计算用户已拥有宠物数量和是否有正在进修的宠物
  select count(*) into v_owned_count from public.pets where member_id = p_member_id;
  select exists(select 1 from public.pets where member_id = p_member_id and is_studying = true) into v_has_studying;

  select psi.id, psi.name, psi.emoji, psi.image_url, psi.rarity, psi.base_coin_per_day, psi.trait_id into v_picked
  from public.pet_shop_items psi
  cross join lateral (
    select case psi.rarity
      when 'common' then v_cfg.rarity_common_prob
      when 'rare'   then v_cfg.rarity_rare_prob
      when 'epic'   then v_cfg.rarity_epic_prob
      else v_cfg.rarity_common_prob
    end as weight
  ) w
  where psi.type = 'pet'
    and psi.status = 'active'
    and psi.price_star > 0
    and w.weight > 0
    and psi.id not in (
      select coalesce(shop_item_id, '00000000-0000-0000-0000-000000000000'::uuid)
      from public.pets where member_id = p_member_id
    )
    -- 解锁规则过滤
    and (
      (psi.subcategory = 'dog' and psi.rarity = 'common')
      or (psi.subcategory = 'dog' and psi.rarity = 'rare'  and v_owned_count >= 2)
      or (psi.subcategory = 'dog' and psi.rarity = 'epic'  and v_owned_count >= 5)
      or (psi.subcategory = 'cat' and v_owned_count >= 10 and v_has_studying = true)
    )
  order by -log(random()) / w.weight
  limit 1;

  if v_picked.id is null then
    return query select false, '暂无可抽的宠物（已全部拥有或未解锁）',
      null::uuid, null::text, null::text, null::text, null::text, null::numeric, null::uuid, v_member.star_value;
    return;
  end if;

  return query select true, '抽卡成功',
    v_picked.id, v_picked.name, v_picked.emoji, v_picked.image_url, v_picked.rarity,
    v_picked.base_coin_per_day, v_picked.trait_id, v_member.star_value;
end;
$$;
grant execute on function public.gacha_start(uuid) to anon, authenticated;

-- ------------------------------------------------------------
-- 2. buy_pet_item: 增加解锁校验（基于 0211 版本 + 解锁判断）
-- ------------------------------------------------------------
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
  v_owned_count int;
  v_has_studying boolean;
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

    -- 解锁校验
    select count(*) into v_owned_count from public.pets where member_id = p_member_id;
    select exists(select 1 from public.pets where member_id = p_member_id and is_studying = true) into v_has_studying;

    if v_item.subcategory = 'dog' then
      if v_item.rarity = 'rare' and v_owned_count < 2 then
        return query select false, '领养2只宠物后可解锁稀有狗狗', v_star, v_coin, null::uuid, 0; return;
      end if;
      if v_item.rarity = 'epic' and v_owned_count < 5 then
        return query select false, '领养5只宠物后可解锁史诗狗狗', v_star, v_coin, null::uuid, 0; return;
      end if;
    elsif v_item.subcategory = 'cat' then
      if not (v_owned_count >= 10 and v_has_studying) then
        return query select false, '领养10只宠物且有宠物进修后可解锁猫咪', v_star, v_coin, null::uuid, 0; return;
      end if;
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

-- ------------------------------------------------------------
-- 3. gacha_adopt: 增加解锁校验（基于 0211 版本 + 解锁判断）
-- ------------------------------------------------------------
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
  v_owned_count int;
  v_has_studying boolean;
begin
  select * into v_cfg from public.gacha_config where id = 1;

  select * into v_member from public.members where id = p_member_id for update;
  if not found then
    return query select false, '用户不存在', null::uuid, 0;
    return;
  end if;

  select * into v_item from public.pet_shop_items where id = p_shop_item_id;
  if not found then
    return query select false, '商品不存在', null::uuid, v_member.star_value;
    return;
  end if;

  if v_member.star_value < v_cfg.adopt_cost then
    return query select false, '星光值不足，需要'||v_cfg.adopt_cost||'星光值', null::uuid, v_member.star_value;
    return;
  end if;

  -- 解锁校验
  select count(*) into v_owned_count from public.pets where member_id = p_member_id;
  select exists(select 1 from public.pets where member_id = p_member_id and is_studying = true) into v_has_studying;

  if v_item.subcategory = 'dog' then
    if v_item.rarity = 'rare' and v_owned_count < 2 then
      return query select false, '领养2只宠物后可解锁稀有狗狗', null::uuid, v_member.star_value; return;
    end if;
    if v_item.rarity = 'epic' and v_owned_count < 5 then
      return query select false, '领养5只宠物后可解锁史诗狗狗', null::uuid, v_member.star_value; return;
    end if;
  elsif v_item.subcategory = 'cat' then
    if not (v_owned_count >= 10 and v_has_studying) then
      return query select false, '领养10只宠物且有宠物进修后可解锁猫咪', null::uuid, v_member.star_value; return;
    end if;
  end if;

  -- 检查是否已拥有
  select id into v_existing_pet_id from public.pets where member_id = p_member_id and shop_item_id = p_shop_item_id limit 1;
  if found then
    return query select false, '你已经领养了这只宠物', null::uuid, v_member.star_value;
    return;
  end if;

  -- 狗屋容量
  select level into v_doghouse_level from public.dog_house where member_id = p_member_id limit 1;
  v_doghouse_level := coalesce(v_doghouse_level, 0);
  select count(*) into v_current_pet_count from public.pets where member_id = p_member_id;
  v_capacity := case v_doghouse_level
    when 0 then 0 when 1 then 1 when 2 then 5 when 3 then 10 else 10
  end;
  if v_current_pet_count >= v_capacity then
    if v_doghouse_level = 0 then
      return query select false, '请先购买「茅草屋」才能领养宠物', null::uuid, v_member.star_value; return;
    elsif v_doghouse_level = 1 then
      return query select false, '狗屋容量不足，请先购买「温馨狗屋」', null::uuid, v_member.star_value; return;
    elsif v_doghouse_level = 2 then
      return query select false, '狗屋容量不足，请先购买「豪华狗屋」', null::uuid, v_member.star_value; return;
    else
      return query select false, '狗屋容量已满', null::uuid, v_member.star_value; return;
    end if;
  end if;

  -- 扣费
  v_star := v_member.star_value - v_cfg.adopt_cost;
  update public.members set star_value = v_star, updated_at = now() where id = p_member_id;

  -- 创建宠物
  insert into public.pets (
    family_id, member_id, shop_item_id, name, emoji, image_url, gender, breed,
    base_coin_per_day, upgrade_coin_reward, coin_balance,
    max_level, current_max_blood, daily_decay_base, upgrade_percent, evolved_bonus, exp,
    rarity
  ) values (
    v_member.family_id, p_member_id, v_item.id, null, v_item.emoji, v_item.image_url,
    v_item.gender, v_item.breed,
    v_item.base_coin_per_day, coalesce(v_item.upgrade_coin_reward, 5), 0,
    coalesce(v_item.max_level, 3), coalesce(v_item.max_blood_bar, 100),
    coalesce(v_item.daily_decay_base, 5), coalesce(v_item.upgrade_percent, 5.0), 0.0, 0,
    coalesce(v_item.rarity, 'common')
  ) returning id into v_pet_id;

  v_new_pet_msg := '新宠物 ' || coalesce(v_item.breed, v_item.name, '新宠物') || ' 到家啦！';
  perform public.add_pet_message(p_member_id, v_pet_id, 'new_pet',
    coalesce(v_item.breed, v_item.name, '新宠物'), v_new_pet_msg);

  return query select true, '领养成功', v_pet_id, v_star;
end;
$$;
grant execute on function public.gacha_adopt(uuid, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
