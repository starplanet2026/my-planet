-- 0046: 宠物等级系统重设计
-- ============================================================
-- 新规则：
--   1) 宠物初始 4 项属性 (hunger/clean/happiness/health) 全部为 0，
--      通过互动道具增长。当 4 项全部 ≥ 100 时，宠物获得 20 XP，
--      随后 4 项属性重置为 0，循环开始下一轮。
--   2) 稀有度 → 满级映射：common=10, rare=20, epic=50。
--   3) 升级奖励：每级 +10 金币；日产金按 base + base*0.05*(level-1)
--      简单 5% 累加（非复利）。
--   4) 经验满了不会自动升级，而是把 pending_levelup 置为 true；
--      孩子需通过错题本挑战 (≥80% 正确率) 才能完成升级。
--   5) exp_needed(level) = level * 100
-- ============================================================

-- ============================================================
-- 一、表结构变更
-- ============================================================

-- pets 新增 pending_levelup 列
alter table public.pets
  add column if not exists pending_levelup boolean not null default false;

-- ============================================================
-- 二、按稀有度对齐 pet_shop_items.max_level 与 pets.max_level
--    common=10, rare=20, epic=50
-- ============================================================

update public.pet_shop_items set max_level = 10
  where type = 'pet' and rarity = 'common';

update public.pet_shop_items set max_level = 20
  where type = 'pet' and rarity = 'rare';

update public.pet_shop_items set max_level = 50
  where type = 'pet' and rarity = 'epic';

update public.pets set max_level = 10 where rarity = 'common';
update public.pets set max_level = 20 where rarity = 'rare';
update public.pets set max_level = 50 where rarity = 'epic';

-- ============================================================
-- 三、把所有现有宠物的 4 项属性重置为 0（新初始状态）
-- ============================================================
update public.pets set
  hunger = 0,
  clean = 0,
  happiness = 0,
  health = 0,
  pending_levelup = false;

-- ============================================================
-- 四、重建 exp_needed：level * 100
-- ============================================================
drop function if exists public.exp_needed(int);

create function public.exp_needed(p_level int)
returns int
language sql immutable
as $$
  select greatest(p_level, 1) * 100;
$$;

grant execute on function public.exp_needed(int) to anon, authenticated;

-- ============================================================
-- 五、重建 interact_with_pet
--    签名：(p_member_id uuid, p_pet_id uuid, p_action text, p_item_id uuid)
--    返回 setof public.pets
--    行为：
--      - 校验宠物存在 / 跨用户 / 物品类型
--      - 应用 recovery_value 到对应属性，上限 100
--      - 若 4 项全部 ≥ 100：+20 XP，重置 4 项为 0
--      - 若 exp >= exp_needed(level) 且未满级：置 pending_levelup = true
--      - 不自动升级
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
  v_pet record;
  v_item record;
  v_inv record;
  v_required_sub text;
  v_recovery int := 20;
  v_exp_gain int := 20;
  v_new_exp int;
  v_exp_needed int;
  v_all_max boolean := false;
begin
  select * into v_pet from public.pets where public.pets.id = p_pet_id for update;
  if not found then return; end if;

  -- 跨用户：直接返回当前宠物行
  if v_pet.member_id <> p_member_id then
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;

  -- action → subcategory 映射（兼容 heal / medical）
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

  -- 校验背包物品
  select * into v_inv from public.pet_inventory
    where public.pet_inventory.member_id = p_member_id
      and public.pet_inventory.item_id = p_item_id
    for update;
  if not found or v_inv.quantity <= 0 then
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;
  if v_inv.subcategory <> v_required_sub then
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;

  -- 读取商品 recovery_value
  select * into v_item from public.pet_shop_items where public.pet_shop_items.id = p_item_id;
  if found and v_item.recovery_value is not null and v_item.recovery_value > 0 then
    v_recovery := v_item.recovery_value;
  end if;

  -- 扣减背包物品
  if v_inv.quantity - 1 <= 0 then
    delete from public.pet_inventory where public.pet_inventory.id = v_inv.id;
  else
    update public.pet_inventory
      set quantity = v_inv.quantity - 1
      where public.pet_inventory.id = v_inv.id;
  end if;

  -- 应用恢复值（封顶 100）
  if p_action = 'feed' then
    v_pet.hunger := least(100, coalesce(v_pet.hunger, 0) + v_recovery);
  elsif p_action = 'clean' then
    v_pet.clean := least(100, coalesce(v_pet.clean, 0) + v_recovery);
  elsif p_action = 'play' then
    v_pet.happiness := least(100, coalesce(v_pet.happiness, 0) + v_recovery);
  elsif p_action = 'heal' or p_action = 'medical' then
    v_pet.is_sick := false;
    v_pet.health := least(100, coalesce(v_pet.health, 0) + v_recovery);
  end if;

  -- 判定 4 项是否全部 ≥ 100
  if coalesce(v_pet.hunger, 0) >= 100
     and coalesce(v_pet.clean, 0) >= 100
     and coalesce(v_pet.happiness, 0) >= 100
     and coalesce(v_pet.health, 0) >= 100 then
    v_all_max := true;
  end if;

  if v_all_max then
    -- 加经验
    v_new_exp := coalesce(v_pet.exp, 0) + v_exp_gain;
    v_exp_needed := public.exp_needed(coalesce(v_pet.level, 1));

    -- 是否触发 pending_levelup
    if v_new_exp >= v_exp_needed and v_pet.level < coalesce(v_pet.max_level, 10) then
      update public.pets set
        hunger = 0,
        clean = 0,
        happiness = 0,
        health = 0,
        is_sick = v_pet.is_sick,
        exp = v_new_exp,
        pending_levelup = true
      where public.pets.id = p_pet_id;
    else
      update public.pets set
        hunger = 0,
        clean = 0,
        happiness = 0,
        health = 0,
        is_sick = v_pet.is_sick,
        exp = v_new_exp
      where public.pets.id = p_pet_id;
    end if;
  else
    -- 未满 100，仅更新属性
    update public.pets set
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
-- 六、重建 check_pet
--    新日产金公式：base_daily_coins + base_daily_coins * 0.05 * (level - 1)
--    简单 5% of base per level，非复利
-- ============================================================
drop function if exists public.check_pet(uuid);

create function public.check_pet(p_pet_id uuid)
returns setof public.pets
language plpgsql security definer as $$
declare
  v_pet record;
  v_daily_production numeric;
  v_decay int;
  v_new_hunger int;
  v_new_clean int;
  v_new_happiness int;
  v_new_health int;
  v_days_since int;
  v_base numeric;
  v_level int;
begin
  select * into v_pet from public.pets where public.pets.id = p_pet_id for update;
  if not found then return; end if;

  v_days_since := extract(day from now() - coalesce(v_pet.last_check_at, now() - interval '1 day'))::int;

  if v_days_since >= 1 then
    v_base := coalesce(v_pet.base_coin_per_day, 0);
    v_level := coalesce(v_pet.level, 1);
    -- 简单 5% of base per level (非复利)
    v_daily_production := v_base + v_base * 0.05 * (v_level - 1);

    v_decay := coalesce(v_pet.daily_decay_base, 5)
      + round(coalesce(v_pet.daily_decay_base, 5) * 0.02 * v_days_since)::int;
    v_new_hunger := greatest(0, coalesce(v_pet.hunger, 0) - v_decay);
    v_new_clean := greatest(0, coalesce(v_pet.clean, 0) - v_decay);
    v_new_happiness := greatest(0, coalesce(v_pet.happiness, 0) - v_decay);
    v_new_health := greatest(0, coalesce(v_pet.health, 0) - v_decay);

    update public.pets set
      coin_balance = coalesce(v_pet.coin_balance, 0) + v_daily_production * v_days_since,
      hunger = v_new_hunger,
      clean = v_new_clean,
      happiness = v_new_happiness,
      health = v_new_health,
      is_sick = (v_new_health < 30),
      last_check_at = now()
    where public.pets.id = p_pet_id;
  end if;

  return query select * from public.pets where public.pets.id = p_pet_id;
end;
$$;

grant execute on function public.check_pet(uuid) to anon, authenticated;

-- ============================================================
-- 七、新建 complete_pet_levelup RPC
--    签名：(p_member_id uuid, p_pet_id uuid) returns setof public.pets
--    行为：
--      - 校验 pending_levelup = true
--      - 校验 level < max_level
--      - level + 1, +10 金币, pending_levelup = false
--      - 给孩子加 10 金币
-- ============================================================
create or replace function public.complete_pet_levelup(
  p_member_id uuid,
  p_pet_id uuid
)
returns setof public.pets
language plpgsql security definer as $$
declare
  v_pet record;
  v_reward int := 10;
begin
  select * into v_pet from public.pets where public.pets.id = p_pet_id for update;
  if not found then return; end if;

  -- 跨用户校验
  if v_pet.member_id <> p_member_id then
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;

  -- 必须 pending_levelup = true
  if not coalesce(v_pet.pending_levelup, false) then
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;

  -- 必须未满级
  if coalesce(v_pet.level, 1) >= coalesce(v_pet.max_level, 10) then
    -- 已满级，清除 flag
    update public.pets set pending_levelup = false where public.pets.id = p_pet_id;
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;

  -- 升级
  update public.pets set
    level = coalesce(v_pet.level, 1) + 1,
    pending_levelup = false
  where public.pets.id = p_pet_id;

  -- 给孩子加金币
  update public.members
    set coin_balance = coalesce(coin_balance, 0) + v_reward, updated_at = now()
    where public.members.id = p_member_id;

  return query select * from public.pets where public.pets.id = p_pet_id;
end;
$$;

grant execute on function public.complete_pet_levelup(uuid, uuid) to anon, authenticated;

-- ============================================================
-- 八、重建 buy_pet_item
--    新宠物初始 4 项属性全部为 0
-- ============================================================
drop function if exists public.buy_pet_item(uuid, uuid);

create function public.buy_pet_item(
  p_member_id uuid,
  p_item_id uuid
)
returns table(
  success boolean,
  message text,
  new_star int,
  new_coin int,
  pet_id uuid,
  inventory_qty int
)
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
  select * into v_item from public.pet_shop_items
    where public.pet_shop_items.id = p_item_id and status = 'active';
  if not found then
    return query select false, '商品不存在或已下架', 0, 0, null::uuid, 0;
    return;
  end if;

  select * into v_member from public.members where public.members.id = p_member_id for update;
  v_family_id := v_member.family_id;
  v_star := v_member.star_value;
  v_coin := v_member.coin_balance;

  if v_star < coalesce(v_item.price_star, 0) then
    return query select false, '星光值不足', v_star, v_coin, null::uuid, 0;
    return;
  end if;

  if v_item.subcategory = 'doghouse' then
    return query select false, '请使用狗屋升级功能', v_star, v_coin, null::uuid, 0;
    return;
  end if;

  if v_item.type = 'pet' then
    select id into v_existing_pet_id from public.pets
      where public.pets.member_id = p_member_id
        and public.pets.shop_item_id = p_item_id
      limit 1;
    if found then
      return query select false, '已领养该宠物，不可重复购买', v_star, v_coin, null::uuid, 0;
      return;
    end if;

    select level into v_doghouse_level from public.dog_house
      where public.dog_house.member_id = p_member_id limit 1;
    v_doghouse_level := coalesce(v_doghouse_level, 0);
    select count(*) into v_current_pet_count from public.pets
      where public.pets.member_id = p_member_id;

    v_capacity := case v_doghouse_level
      when 0 then 0
      when 1 then 1
      when 2 then 5
      when 3 then 10
      else 10
    end;

    if v_current_pet_count >= v_capacity then
      if v_doghouse_level = 0 then
        return query select false, '请先购买「茅草屋」才能领养宠物', v_star, v_coin, null::uuid, 0;
      elsif v_doghouse_level = 1 then
        return query select false, '狗屋容量不足，请先购买「温馨狗屋」', v_star, v_coin, null::uuid, 0;
      elsif v_doghouse_level = 2 then
        return query select false, '狗屋容量不足，请先购买「豪华狗屋」', v_star, v_coin, null::uuid, 0;
      else
        return query select false, '狗屋容量已满', v_star, v_coin, null::uuid, 0;
      end if;
      return;
    end if;
  end if;

  v_star := v_star - coalesce(v_item.price_star, 0);
  update public.members
    set star_value = v_star, updated_at = now()
    where public.members.id = p_member_id;

  if v_item.type = 'pet' then
    -- 新宠物初始 4 项属性全部为 0
    insert into public.pets (
      family_id, member_id, shop_item_id, name, emoji, image_url, gender,
      base_coin_per_day, upgrade_coin_reward, coin_balance,
      max_level, current_max_blood, daily_decay_base, upgrade_percent,
      evolved_bonus, exp, rarity,
      hunger, clean, happiness, health, pending_levelup
    )
    values (
      v_family_id, p_member_id, v_item.id, '新宠物', v_item.emoji, v_item.image_url, v_item.gender,
      coalesce(v_item.base_coin_per_day, 2), coalesce(v_item.upgrade_coin_reward, 5), 0,
      coalesce(v_item.max_level, 10), coalesce(v_item.max_blood_bar, 100),
      coalesce(v_item.daily_decay_base, 5), coalesce(v_item.upgrade_percent, 5.0),
      0.0, 0, coalesce(v_item.rarity, 'common'),
      0, 0, 0, 0, false
    )
    returning id into v_pet_id;
    return query select true, '购买成功！请给宠物取个名字', v_star, v_coin, v_pet_id, 0;
  else
    insert into public.pet_inventory (family_id, member_id, item_id, item_name_snapshot, item_emoji, item_image_url, subcategory, quantity)
    values (v_family_id, p_member_id, p_item_id, coalesce(v_item.name, '用品'), v_item.emoji, v_item.image_url, v_item.subcategory, 1)
    on conflict (member_id, item_id) do update set quantity = public.pet_inventory.quantity + 1
    returning quantity into v_inv_qty;
    return query select true, '已购买并存入背包', v_star, v_coin, null::uuid, v_inv_qty;
  end if;
end;
$$;

grant execute on function public.buy_pet_item(uuid, uuid) to anon, authenticated;

-- ============================================================
-- 九、重建 gacha_start
--    新宠物初始 4 项属性全部为 0
-- ============================================================
drop function if exists public.gacha_start(uuid);

create function public.gacha_start(p_member_id uuid)
returns table(
  success boolean,
  message text,
  drawn_pet_id uuid,
  drawn_pet_name text,
  drawn_pet_emoji text,
  drawn_pet_image text,
  remaining_star int,
  draw_count int
)
language plpgsql security definer as $$
declare
  v_member record;
  v_item record;
  v_pet_id uuid;
  v_star int;
begin
  select * into v_member from public.members where public.members.id = p_member_id for update;
  if not found then
    return query select false, '用户不存在', null::uuid, null::text, null::text, null::text, 0, 0;
    return;
  end if;

  if v_member.star_value < 500 then
    return query select false, '需要500星光值才能抽卡', null::uuid, null::text, null::text, null::text, v_member.star_value, 0;
    return;
  end if;

  v_star := v_member.star_value - 500;
  update public.members
    set star_value = v_star, updated_at = now()
    where public.members.id = p_member_id;

  select * into v_item from public.pet_shop_items
    where type = 'pet' and status = 'active' and price_star > 0
    order by random() limit 1;

  if not found then
    update public.members set star_value = star_value + 500 where public.members.id = p_member_id;
    return query select false, '暂无可抽的宠物', null::uuid, null::text, null::text, null::text, v_member.star_value, 0;
    return;
  end if;

  -- 新宠物初始 4 项属性全部为 0
  insert into public.pets (
    family_id, member_id, shop_item_id, name, emoji, image_url, gender,
    base_coin_per_day, upgrade_coin_reward, coin_balance,
    max_level, current_max_blood, daily_decay_base, upgrade_percent,
    evolved_bonus, exp, rarity,
    hunger, clean, happiness, health, pending_levelup
  )
  values (
    v_member.family_id, p_member_id, v_item.id, '新宠物', v_item.emoji, v_item.image_url, v_item.gender,
    coalesce(v_item.base_coin_per_day, 2), coalesce(v_item.upgrade_coin_reward, 5), 0,
    coalesce(v_item.max_level, 10), coalesce(v_item.max_blood_bar, 100),
    coalesce(v_item.daily_decay_base, 5), coalesce(v_item.upgrade_percent, 5.0),
    0.0, 0, coalesce(v_item.rarity, 'common'),
    0, 0, 0, 0, false
  )
  returning id into v_pet_id;

  return query select true, '抽卡成功', v_pet_id, v_item.name, v_item.emoji, v_item.image_url, v_star, 1;
end;
$$;

grant execute on function public.gacha_start(uuid) to anon, authenticated;
