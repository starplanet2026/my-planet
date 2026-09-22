-- 0077: 批量修复多个问题
-- 问题5: 心情值到90后无法到100 → 所有属性上限改为100
-- 问题6: 属性满值后重复使用物品未拦截 → 满值时直接返回不消耗
-- 问题9: 星光值扣除时机错误 → 抽卡开始不扣,领养扣150,放弃扣45
-- 问题10: 容量不足提示错误 → 容量检查移到星光值检查之前
-- 问题13: end_date is ambiguous → 使用表名限定
-- 问题16: 领养池剔除已拥有宠物 → gacha排除已拥有

-- ============================================================
-- 一、重写 interact_with_pet：属性上限100 + 满值拦截
-- ============================================================
drop function if exists public.interact_with_pet(uuid, uuid, text, uuid);
drop function if exists public.interact_with_pet(uuid, text, uuid);

create function public.interact_with_pet(
  p_member_id uuid,
  p_pet_id uuid,
  p_action text,
  p_item_id uuid default null
)
returns setof public.pets
language plpgsql security definer as $$
declare
  v_pet public.pets%rowtype;
  v_item public.pet_shop_items%rowtype;
  v_inv public.pet_inventory%rowtype;
  v_required_sub text;
  v_recovery int := 20;
  v_exp_gain int := 20;
  v_new_exp int;
  v_exp_needed int;
  v_level_up boolean := false;
  v_coin_earned int := 0;
  v_new_max_blood int;
  v_evolved_bonus numeric(5,2);
  v_stat_max int := 100;
begin
  select * into v_pet from public.pets where public.pets.id = p_pet_id for update;
  if not found then return; end if;
  if v_pet.member_id <> p_member_id then
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;

  -- action → subcategory 映射
  if p_action = 'feed' then v_required_sub := 'food';
  elsif p_action = 'clean' then v_required_sub := 'clean';
  elsif p_action = 'play' then v_required_sub := 'toy';
  elsif p_action = 'heal' or p_action = 'medical' then v_required_sub := 'medicine';
  else
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;

  -- 治疗需宠物生病
  if (p_action = 'heal' or p_action = 'medical') and not v_pet.is_sick then
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;

  -- 问题6: 属性满值拦截（不消耗物品）
  if p_action = 'feed' and coalesce(v_pet.hunger, 0) >= v_stat_max then
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;
  if p_action = 'clean' and coalesce(v_pet.clean, 0) >= v_stat_max then
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;
  if p_action = 'play' and coalesce(v_pet.happiness, 0) >= v_stat_max then
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;
  if (p_action = 'heal' or p_action = 'medical') and coalesce(v_pet.health, 0) >= v_stat_max then
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;

  -- 校验背包物品
  select * into v_inv from public.pet_inventory
    where member_id = p_member_id and item_id = p_item_id for update;
  if not found or v_inv.quantity <= 0 then
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;
  if v_inv.subcategory <> v_required_sub then
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;

  -- 读取商品的 recovery_value
  select * into v_item from public.pet_shop_items where id = p_item_id;
  if found and v_item.recovery_value is not null and v_item.recovery_value > 0 then
    v_recovery := v_item.recovery_value;
  end if;

  -- 扣减背包物品
  if v_inv.quantity - 1 <= 0 then
    delete from public.pet_inventory where id = v_inv.id;
  else
    update public.pet_inventory set quantity = v_inv.quantity - 1 where id = v_inv.id;
  end if;

  -- 问题5: 所有属性上限统一为100
  if p_action = 'feed' then
    v_pet.hunger := least(v_stat_max, coalesce(v_pet.hunger, 0) + v_recovery);
  elsif p_action = 'clean' then
    v_pet.clean := least(v_stat_max, coalesce(v_pet.clean, 0) + v_recovery);
  elsif p_action = 'play' then
    v_pet.happiness := least(v_stat_max, coalesce(v_pet.happiness, 0) + v_recovery);
  elsif p_action = 'heal' or p_action = 'medical' then
    v_pet.is_sick := false;
    v_pet.health := least(v_stat_max, coalesce(v_pet.health, 0) + v_recovery);
  end if;

  -- 经验值 +20 XP
  v_new_exp := coalesce(v_pet.exp, 0) + v_exp_gain;
  v_exp_needed := public.exp_needed(v_pet.level);

  if v_new_exp >= v_exp_needed and v_pet.level < coalesce(v_pet.max_level, 3) then
    v_level_up := true;
    v_new_exp := v_new_exp - v_exp_needed;
    v_evolved_bonus := coalesce(v_pet.evolved_bonus, 0.0);
    v_coin_earned := round(coalesce(v_pet.level, 1) * 1.25)::int;
    v_new_max_blood := round(coalesce(v_pet.current_max_blood, 100) * (1.05 + v_evolved_bonus * 0.01))::int;

    update public.pets set
      level = v_pet.level + 1,
      exp = v_new_exp,
      hunger = v_pet.hunger,
      clean = v_pet.clean,
      happiness = v_pet.happiness,
      health = v_pet.health,
      is_sick = v_pet.is_sick,
      coin_balance = coalesce(v_pet.coin_balance, 0) + v_coin_earned,
      current_max_blood = v_new_max_blood,
      daily_decay_base = coalesce(v_pet.daily_decay_base, 5) + 1,
      pending_levelup = false
    where public.pets.id = p_pet_id;

    update public.members
      set coin_balance = coalesce(coin_balance, 0) + v_coin_earned, updated_at = now()
      where id = p_member_id;
  else
    update public.pets set
      exp = v_new_exp,
      hunger = v_pet.hunger,
      clean = v_pet.clean,
      happiness = v_pet.happiness,
      health = v_pet.health,
      is_sick = v_pet.is_sick
    where public.pets.id = p_pet_id;
  end if;

  return query select * from public.pets where public.pets.id = p_pet_id;
end;
$$;

grant execute on function public.interact_with_pet(uuid, uuid, text, uuid) to anon, authenticated;

-- ============================================================
-- 二、重写 buy_pet_item：容量检查移到星光值检查之前
-- ============================================================
drop function if exists public.buy_pet_item(uuid, uuid);

create function public.buy_pet_item(
  p_member_id uuid,
  p_item_id uuid
)
returns table(success boolean, message text, new_star int, new_coin int, pet_id uuid, inventory_qty int)
language plpgsql security definer as $$
declare
  v_item record;
  v_member record;
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
  if not found then
    return query select false, '商品不存在或已下架', 0, 0, null::uuid, 0;
    return;
  end if;

  select * into v_member from public.members where public.members.id = p_member_id for update;
  v_family_id := v_member.family_id;
  v_star := v_member.star_value;
  v_coin := v_member.coin_balance;

  -- 问题10: 容量检查移到星光值检查之前
  if v_item.subcategory = 'doghouse' then
    return query select false, '请使用狗屋升级功能', v_star, v_coin, null::uuid, 0;
    return;
  end if;

  if v_item.type = 'pet' then
    select id into v_existing_pet_id from public.pets
    where member_id = p_member_id and shop_item_id = p_item_id
    limit 1;
    if found then
      return query select false, '已领养该宠物，不可重复购买', v_star, v_coin, null::uuid, 0;
      return;
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
        return query select false, '需要先购买「茅草小屋」，解锁更多饲养位', v_star, v_coin, null::uuid, 0;
      elsif v_doghouse_level = 1 then
        return query select false, '需要先购买「温馨小屋」，解锁更多饲养位', v_star, v_coin, null::uuid, 0;
      elsif v_doghouse_level = 2 then
        return query select false, '需要先购买「豪华小屋」，解锁更多饲养位', v_star, v_coin, null::uuid, 0;
      else
        return query select false, '饲养位已满', v_star, v_coin, null::uuid, 0;
      end if;
      return;
    end if;
  end if;

  -- 星光值检查（容量检查之后）
  if v_star < coalesce(v_item.price_star, 0) then
    return query select false, '星光值不足', v_star, v_coin, null::uuid, 0;
    return;
  end if;

  v_star := v_star - coalesce(v_item.price_star, 0);
  update public.members set star_value = v_star, updated_at = now() where public.members.id = p_member_id;

  if v_item.type = 'pet' then
    insert into public.pets (
      family_id, member_id, shop_item_id, name, emoji, image_url, gender,
      base_coin_per_day, upgrade_coin_reward, coin_balance,
      max_level, current_max_blood, daily_decay_base, upgrade_percent, evolved_bonus, exp
    )
    values (
      v_family_id, p_member_id, v_item.id, '新宠物', v_item.emoji, v_item.image_url, v_item.gender,
      coalesce(v_item.base_coin_per_day, 2), coalesce(v_item.upgrade_coin_reward, 5), 0,
      coalesce(v_item.max_level, 3), coalesce(v_item.max_blood_bar, 100),
      coalesce(v_item.daily_decay_base, 5), coalesce(v_item.upgrade_percent, 5.0), 0.0, 0
    )
    returning id into v_pet_id;
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
-- 三、重写抽卡函数：领养扣150,放弃扣45,开始不扣
-- ============================================================
drop function if exists public.gacha_start(uuid);
drop function if exists public.gacha_adopt(uuid, uuid);
drop function if exists public.gacha_adopt(uuid, uuid, uuid);
drop function if exists public.gacha_cancel(uuid);

-- gacha_start: 不扣星光,只随机抽一个未拥有的宠物商品
create function public.gacha_start(p_member_id uuid)
returns table(success boolean, message text, drawn_item_id uuid, drawn_item_name text, drawn_item_emoji text, drawn_item_image text, remaining_star int)
language plpgsql security definer as $$
declare
  v_member record;
  v_item record;
begin
  select * into v_member from public.members where public.members.id = p_member_id for update;
  if not found then
    return query select false, '用户不存在', null::uuid, null::text, null::text, null::text, 0;
    return;
  end if;

  -- 需至少150星光才能参与（领养需要150）
  if v_member.star_value < 150 then
    return query select false, '星光值不足，需要150星光值才能抽卡', null::uuid, null::text, null::text, null::text, v_member.star_value;
    return;
  end if;

  -- 问题16: 剔除已拥有的宠物
  select * into v_item from public.pet_shop_items
    where type = 'pet' and status = 'active' and price_star > 0
    and id not in (
      select coalesce(shop_item_id, '00000000-0000-0000-0000-000000000000'::uuid)
      from public.pets where member_id = p_member_id
    )
    order by random() limit 1;

  if not found then
    return query select false, '暂无可抽的宠物（已全部拥有）', null::uuid, null::text, null::text, null::text, v_member.star_value;
    return;
  end if;

  return query select true, '抽卡成功', v_item.id, v_item.name, v_item.emoji, v_item.image_url, v_member.star_value;
end;
$$;

-- gacha_adopt: 扣150星光,创建宠物
create function public.gacha_adopt(p_member_id uuid, p_shop_item_id uuid)
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
begin
  select * into v_member from public.members where public.members.id = p_member_id for update;
  if not found then
    return query select false, '用户不存在', null::uuid, 0;
    return;
  end if;

  select * into v_item from public.pet_shop_items where public.pet_shop_items.id = p_shop_item_id and status = 'active';
  if not found then
    return query select false, '宠物不存在或已下架', null::uuid, v_member.star_value;
    return;
  end if;

  -- 检查是否已拥有
  select id into v_existing_pet_id from public.pets
    where member_id = p_member_id and shop_item_id = p_shop_item_id limit 1;
  if found then
    return query select false, '已拥有该宠物', null::uuid, v_member.star_value;
    return;
  end if;

  -- 容量检查
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

  -- 扣150星光
  if v_member.star_value < 150 then
    return query select false, '星光值不足，需要150星光值领养', null::uuid, v_member.star_value;
    return;
  end if;

  v_star := v_member.star_value - 150;
  update public.members set star_value = v_star, updated_at = now() where public.members.id = p_member_id;

  insert into public.pets (
    family_id, member_id, shop_item_id, name, emoji, image_url, gender,
    base_coin_per_day, upgrade_coin_reward, coin_balance,
    max_level, current_max_blood, daily_decay_base, upgrade_percent, evolved_bonus, exp
  )
  values (
    v_member.family_id, p_member_id, v_item.id, '新宠物', v_item.emoji, v_item.image_url, v_item.gender,
    coalesce(v_item.base_coin_per_day, 2), coalesce(v_item.upgrade_coin_reward, 5), 0,
    coalesce(v_item.max_level, 3), coalesce(v_item.max_blood_bar, 100),
    coalesce(v_item.daily_decay_base, 5), coalesce(v_item.upgrade_percent, 5.0), 0.0, 0
  )
  returning id into v_pet_id;

  return query select true, '领养成功', v_pet_id, v_star;
end;
$$;

-- gacha_cancel: 扣45星光（原价30%）
create function public.gacha_cancel(p_member_id uuid)
returns table(success boolean, message text, remaining_star int)
language plpgsql security definer as $$
declare
  v_star int;
begin
  update public.members set star_value = greatest(0, star_value - 45), updated_at = now()
    where id = p_member_id
    returning star_value into v_star;

  return query select true, '放弃抽卡，扣除45星光值', v_star;
end;
$$;

grant execute on function public.gacha_start(uuid) to anon, authenticated;
grant execute on function public.gacha_adopt(uuid, uuid) to anon, authenticated;
grant execute on function public.gacha_cancel(uuid) to anon, authenticated;

-- ============================================================
-- 四、修复 buy_boarding_card: 限定表名避免 end_date 歧义
-- ============================================================
drop function if exists public.buy_boarding_card(uuid, text);

create function public.buy_boarding_card(
  p_member_id uuid,
  p_card_type text
)
returns table(success boolean, message text, new_star int, end_date date)
language plpgsql security definer as $$
declare
  v_member record;
  v_family_id uuid;
  v_cost int;
  v_days int;
  v_existing_end date;
  v_new_end date;
begin
  select * into v_member from public.members where public.members.id = p_member_id for update;
  if not found then
    return query select false, '用户不存在', 0, null::date;
    return;
  end if;
  v_family_id := v_member.family_id;

  if p_card_type = 'daily' then v_cost := 1; v_days := 1;
  elsif p_card_type = 'weekly' then v_cost := 6; v_days := 7;
  elsif p_card_type = 'monthly' then v_cost := 25; v_days := 30;
  else
    return query select false, '未知卡类型', v_member.star_value, null::date;
    return;
  end if;

  if v_member.star_value < v_cost then
    return query select false, '星光值不足', v_member.star_value, null::date;
    return;
  end if;

  update public.members set star_value = star_value - v_cost, updated_at = now() where public.members.id = p_member_id;

  -- 使用表名限定 end_date 避免歧义
  select pbc.end_date into v_existing_end from public.pet_boarding_cards pbc
    where pbc.member_id = p_member_id and pbc.end_date >= current_date
    order by pbc.end_date desc limit 1;

  if v_existing_end is not null then
    v_new_end := v_existing_end + v_days;
    update public.pet_boarding_cards set end_date = v_new_end
      where member_id = p_member_id and end_date = v_existing_end;
  else
    v_new_end := current_date + v_days - 1;
    insert into public.pet_boarding_cards (family_id, member_id, card_type, start_date, end_date)
    values (v_family_id, p_member_id, p_card_type, current_date, v_new_end);
  end if;

  return query select true, '购买成功，有效期至 ' || v_new_end::text, v_member.star_value - v_cost, v_new_end;
end;
$$;

grant execute on function public.buy_boarding_card(uuid, text) to anon, authenticated;
