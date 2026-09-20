-- 0040: 宠物稀有度系统 + 进化 + 等级属性

-- ============================================================
-- 一、pet_shop_items 新增字段
-- ============================================================
alter table public.pet_shop_items add column if not exists max_level int default 3;
alter table public.pet_shop_items add column if not exists max_blood_bar int default 100;
alter table public.pet_shop_items add column if not exists daily_decay_base int default 5;
alter table public.pet_shop_items add column if not exists upgrade_coin_reward int default 5;
alter table public.pet_shop_items add column if not exists upgrade_percent numeric(5,2) default 5.0;

-- ============================================================
-- 二、pets 新增字段
-- ============================================================
alter table public.pets add column if not exists exp int default 0;
alter table public.pets add column if not exists current_max_blood int default 100;
alter table public.pets add column if not exists daily_decay_base int default 5;
alter table public.pets add column if not exists upgrade_percent numeric(5,2) default 5.0;
alter table public.pets add column if not exists evolved_bonus numeric(5,2) default 0.0;
alter table public.pets add column if not exists upgrade_coin_reward int default 5;

-- ============================================================
-- 三、按稀有度设置默认值
-- ============================================================
-- 普通
update pet_shop_items set
  max_level = 3, base_coin_per_day = 2, upgrade_coin_reward = 5, upgrade_percent = 5.0,
  max_blood_bar = 90, daily_decay_base = 4, price_star = 50
  where type = 'pet' and rarity = 'common'
  and (max_level is null or max_level = 0 or max_level > 10);

-- 稀有
update pet_shop_items set
  max_level = 5, base_coin_per_day = 3, upgrade_coin_reward = 12, upgrade_percent = 8.0,
  max_blood_bar = 110, daily_decay_base = 6, price_star = 150
  where type = 'pet' and rarity = 'rare'
  and (max_level is null or max_level = 0 or max_level > 10);

-- 史诗
update pet_shop_items set
  max_level = 7, base_coin_per_day = 4, upgrade_coin_reward = 25, upgrade_percent = 12.0,
  max_blood_bar = 135, daily_decay_base = 9, price_star = 400
  where type = 'pet' and rarity = 'epic'
  and (max_level is null or max_level = 0 or max_level > 10);

-- 已有宠物同步默认值
update pets set current_max_blood = 100, daily_decay_base = 5, upgrade_percent = 5.0
  where current_max_blood is null or current_max_blood = 0;

-- ============================================================
-- 四、经验值需求函数（按等级查表）
-- ============================================================
create or replace function public.exp_needed(p_level int)
returns int
language sql immutable
as $$
  select case
    when p_level = 1 then 100
    when p_level = 2 then 150
    when p_level = 3 then 200
    when p_level = 4 then 250
    when p_level = 5 then 400
    when p_level = 6 then 600
    else 800
  end;
$$;

-- ============================================================
-- 五、重建 interact_with_pet（升级逻辑）
-- ============================================================
drop function if exists public.interact_with_pet(uuid, text, uuid);
create or replace function public.interact_with_pet(
  p_pet_id uuid,
  p_action text,
  p_item_id uuid default null
)
returns table(success boolean, message text, pet_id uuid, level int, exp int, exp_needed int, hunger int, clean int, happiness int, health int, coin_earned int, level_up boolean)
language plpgsql security definer as $$
declare
  v_pet record;
  v_member record;
  v_item record;
  v_new_hunger int;
  v_new_clean int;
  v_new_happiness int;
  v_new_health int;
  v_recovery int;
  v_exp_gain int;
  v_new_exp int;
  v_exp_needed int;
  v_level_up boolean := false;
  v_coin_earned int := 0;
  v_upgrade_reward int;
  v_evolved_bonus numeric(5,2);
begin
  select * into v_pet from public.pets where public.pets.id = p_pet_id for update;
  if not found then
    return query select false, '宠物不存在', null::uuid, 0, 0, 0, 0, 0, 0, 0, 0, false;
    return;
  end if;

  select * into v_member from public.members where id = v_pet.member_id for update;

  -- 获取恢复值
  v_recovery := 20;
  if p_item_id is not null then
    select * into v_item from public.pet_shop_items where public.pet_shop_items.id = p_item_id;
    if found and v_item.recovery_value is not null and v_item.recovery_value > 0 then
      v_recovery := v_item.recovery_value;
    end if;
  end if;

  -- 根据动作恢复对应属性
  v_new_hunger := v_pet.hunger;
  v_new_clean := v_pet.clean;
  v_new_happiness := v_pet.happiness;
  v_new_health := v_pet.health;

  if p_action = 'feed' then
    v_new_hunger := least(v_pet.current_max_blood, v_pet.hunger + v_recovery);
  elsif p_action = 'clean' then
    v_new_clean := least(v_pet.current_max_blood, v_pet.clean + v_recovery);
  elsif p_action = 'play' then
    v_new_happiness := least(v_pet.current_max_blood, v_pet.happiness + v_recovery);
  elsif p_action = 'medical' then
    v_new_health := least(v_pet.current_max_blood, v_pet.health + v_recovery);
  end if;

  -- 经验值：互动给 20 XP
  v_exp_gain := 20;
  v_new_exp := v_pet.exp + v_exp_gain;
  v_exp_needed := public.exp_needed(v_pet.level);

  -- 检查升级
  if v_new_exp >= v_exp_needed and v_pet.level < v_pet.max_level then
    v_level_up := true;
    v_new_exp := v_new_exp - v_exp_needed;
    v_upgrade_reward := v_pet.upgrade_coin_reward;
    v_evolved_bonus := coalesce(v_pet.evolved_bonus, 0.0);

    -- 进化加成：升级奖励 × (1 + evolved_bonus)
    v_coin_earned := round(v_upgrade_reward * (1.0 + v_evolved_bonus))::int;

    -- 给孩子金币
    update public.members set coin_balance = coin_balance + v_coin_earned where id = v_pet.member_id;

    -- 更新宠物：等级+1，血条上限增长，产金增加
    update public.pets set
      level = v_pet.level + 1,
      exp = v_new_exp,
      hunger = v_new_hunger,
      clean = v_new_clean,
      happiness = v_new_happiness,
      health = v_new_health,
      current_max_blood = round(v_pet.current_max_blood * (1.0 + 0.03 + v_evolved_bonus * 0.01))::int,
      daily_decay_base = v_pet.daily_decay_base + 1
    where public.pets.id = p_pet_id;
  else
    -- 不升级，只更新属性和经验
    update public.pets set
      exp = v_new_exp,
      hunger = v_new_hunger,
      clean = v_new_clean,
      happiness = v_new_happiness,
      health = v_new_health,
      is_sick = (v_new_health < 30)
    where public.pets.id = p_pet_id;
  end if;

  return query select
    true,
    case when v_level_up then '升级！获得' || v_coin_earned || '金币' else '互动成功' end,
    p_pet_id,
    case when v_level_up then v_pet.level + 1 else v_pet.level end,
    v_new_exp,
    public.exp_needed(case when v_level_up then v_pet.level + 1 else v_pet.level end),
    v_new_hunger,
    v_new_clean,
    v_new_happiness,
    v_new_health,
    v_coin_earned,
    v_level_up;
end;
$$;

-- ============================================================
-- 六、重建 check_pet（日产金按等级计算 + 衰减）
-- ============================================================
drop function if exists public.check_pet(uuid);
create or replace function public.check_pet(p_pet_id uuid)
returns table(
  id uuid, member_id uuid, family_id uuid, shop_item_id uuid, name text,
  emoji text, image_url text, gender text, level int, exp int, max_level int,
  hunger int, clean int, happiness int, health int, is_sick boolean,
  coin_balance numeric, base_coin_per_day numeric, upgrade_percent numeric,
  current_max_blood int, daily_decay_base int, evolved_bonus numeric,
  last_check_at timestamp, upgrade_coin_reward int
)
language plpgsql security definer as $$
declare
  v_pet record;
  v_member record;
  v_daily_production numeric;
  v_decay int;
  v_evolved_bonus numeric;
  v_new_hunger int;
  v_new_clean int;
  v_new_happiness int;
  v_new_health int;
  v_days_since int;
begin
  select * into v_pet from public.pets where public.pets.id = p_pet_id for update;
  if not found then return; end if;

  -- 计算天数差
  v_days_since := extract(day from now() - coalesce(v_pet.last_check_at, now() - interval '1 day'));
  if v_days_since < 1 then
    -- 同一天，不产出不衰减
    return query select
      v_pet.id, v_pet.member_id, v_pet.family_id, v_pet.shop_item_id, v_pet.name,
      v_pet.emoji, v_pet.image_url, v_pet.gender, v_pet.level, v_pet.exp, v_pet.max_level,
      v_pet.hunger, v_pet.clean, v_pet.happiness, v_pet.health, v_pet.is_sick,
      v_pet.coin_balance, v_pet.base_coin_per_day, v_pet.upgrade_percent,
      v_pet.current_max_blood, v_pet.daily_decay_base, v_pet.evolved_bonus,
      v_pet.last_check_at, v_pet.upgrade_coin_reward;
    return;
  end if;

  -- 计算日产金：base × (1 + (level-1) × upgrade_percent/100) × (1 + evolved_bonus/100)
  v_evolved_bonus := coalesce(v_pet.evolved_bonus, 0.0);
  v_daily_production := v_pet.base_coin_per_day
    * (1.0 + (v_pet.level - 1) * v_pet.upgrade_percent / 100.0)
    * (1.0 + v_evolved_bonus / 100.0);

  -- 衰减：固定 + 百分比
  v_decay := v_pet.daily_decay_base + round(v_pet.daily_decay_base * 0.02 * v_days_since)::int;
  v_new_hunger := greatest(0, v_pet.hunger - v_decay);
  v_new_clean := greatest(0, v_pet.clean - v_decay);
  v_new_happiness := greatest(0, v_pet.happiness - v_decay);
  v_new_health := greatest(0, v_pet.health - v_decay);

  -- 更新
  update public.pets set
    coin_balance = v_pet.coin_balance + v_daily_production * v_days_since,
    hunger = v_new_hunger,
    clean = v_new_clean,
    happiness = v_new_happiness,
    health = v_new_health,
    is_sick = (v_new_health < 30),
    last_check_at = now()
  where public.pets.id = p_pet_id;

  -- 给孩子加金币
  update public.members set coin_balance = coin_balance + v_daily_production * v_days_since
  where id = v_pet.member_id;

  return query select
    p_pet_id, v_pet.member_id, v_pet.family_id, v_pet.shop_item_id, v_pet.name,
    v_pet.emoji, v_pet.image_url, v_pet.gender, v_pet.level, v_pet.exp, v_pet.max_level,
    v_new_hunger, v_new_clean, v_new_happiness, v_new_health, (v_new_health < 30),
    v_pet.coin_balance + v_daily_production * v_days_since,
    v_pet.base_coin_per_day, v_pet.upgrade_percent,
    v_pet.current_max_blood, v_pet.daily_decay_base, v_pet.evolved_bonus,
    now(), v_pet.upgrade_coin_reward;
end;
$$;

-- ============================================================
-- 七、进化 RPC（不重置等级）
-- ============================================================
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

  -- 获取当前稀有度（从 shop_item）
  select rarity into v_current_rarity from pet_shop_items where id = v_pet.shop_item_id;

  -- 校验进化路径
  if v_current_rarity = 'common' and v_target_rarity = 'rare' then
    v_cost := 150; v_new_max_level := 5;
    v_new_base_coin := 2 + random(); -- 2-3
    v_new_upgrade_reward := 8 + floor(random() * 8); -- 8-15
    v_new_upgrade_percent := 8.0;
    v_new_max_blood := 100 + floor(random() * 21); -- 100-120
    v_new_decay := 5 + floor(random() * 3); -- 5-7
  elsif v_current_rarity = 'rare' and v_target_rarity = 'epic' then
    v_cost := 400; v_new_max_level := 7;
    v_new_base_coin := 3 + random(); -- 3-4
    v_new_upgrade_reward := 15 + floor(random() * 16); -- 15-30
    v_new_upgrade_percent := 12.0;
    v_new_max_blood := 120 + floor(random() * 31); -- 120-150
    v_new_decay := 8 + floor(random() * 3); -- 8-10
  else
    return query select false, '无法从' || v_current_rarity || '进化到' || v_target_rarity, null::text, 0, 0;
    return;
  end if;

  -- 校验满级
  if v_pet.level < v_pet.max_level then
    return query select false, '宠物需要满级才能进化', null::text, 0, 0;
    return;
  end if;

  -- 校验星光值
  if v_member.star_value < v_cost then
    return query select false, '星光值不足，需要' || v_cost, null::text, 0, 0;
    return;
  end if;

  -- 扣费
  update public.members set star_value = star_value - v_cost where id = v_pet.member_id;

  -- 更新宠物：等级保留，max_level 扩展，属性更新到新稀有度区间 + 10% 进化加成
  update public.pets set
    max_level = v_new_max_level,
    base_coin_per_day = v_new_base_coin,
    upgrade_coin_reward = v_new_upgrade_reward,
    upgrade_percent = v_new_upgrade_percent,
    current_max_blood = round(v_new_max_blood * 1.1)::int,
    daily_decay_base = v_new_decay,
    evolved_bonus = 10.0
  where public.pets.id = p_pet_id;

  return query select true, '进化成功！等级保留，后续升级属性+10%', v_target_rarity, v_new_max_level, v_cost;
end;
$$;

-- ============================================================
-- 八、陪伴学习奖励经验 + 心情恢复
-- ============================================================
drop function if exists public.study_reward(uuid, int, int);
create or replace function public.study_reward(
  p_member_id uuid,
  p_minutes int,
  p_reward int,
  p_pet_id uuid default null
)
returns table(success boolean, message text)
language plpgsql security definer as $$
declare
  v_pet record;
  v_exp_gain int;
  v_happiness_gain int;
  v_new_exp int;
  v_exp_needed int;
  v_level_up boolean := false;
  v_coin_earned int := 0;
begin
  -- 给星光值
  update public.members set star_value = star_value + p_reward where public.members.id = p_member_id;

  -- 如果有宠物，给经验 + 心情恢复
  if p_pet_id is not null then
    select * into v_pet from public.pets where public.pets.id = p_pet_id for update;
    if found then
      -- 经验：10 XP / 10min
      v_exp_gain := floor(p_minutes / 10) * 10;
      -- 心情恢复：10% / 10min
      v_happiness_gain := floor(p_minutes / 10) * 10;

      v_new_exp := v_pet.exp + v_exp_gain;
      v_exp_needed := public.exp_needed(v_pet.level);

      -- 检查升级
      if v_new_exp >= v_exp_needed and v_pet.level < v_pet.max_level then
        v_level_up := true;
        v_new_exp := v_new_exp - v_exp_needed;
        v_coin_earned := round(v_pet.upgrade_coin_reward * (1.0 + coalesce(v_pet.evolved_bonus, 0.0)))::int;

        update public.members set coin_balance = coin_balance + v_coin_earned where public.members.id = p_member_id;

        update public.pets set
          level = v_pet.level + 1,
          exp = v_new_exp,
          happiness = least(v_pet.current_max_blood, v_pet.happiness + v_happiness_gain),
          current_max_blood = round(v_pet.current_max_blood * (1.03 + coalesce(v_pet.evolved_bonus, 0.0) * 0.01))::int,
          daily_decay_base = v_pet.daily_decay_base + 1
        where public.pets.id = p_pet_id;
      else
        update public.pets set
          exp = v_new_exp,
          happiness = least(v_pet.current_max_blood, v_pet.happiness + v_happiness_gain)
        where public.pets.id = p_pet_id;
      end if;
    end if;
  end if;

  return query select true,
    case
      when v_level_up then '学习完成！获得' || p_reward || '星光值，宠物升级！+' || v_coin_earned || '金币'
      when p_pet_id is not null then '学习完成！获得' || p_reward || '星光值，宠物获得' || v_exp_gain || '经验'
      else '学习完成！获得' || p_reward || '星光值'
    end;
end;
$$;

-- ============================================================
-- 九、重建 buy_pet_item（INSERT 时传递新属性）
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

  -- 狗屋用品：走 buy_doghouse_upgrade
  if v_item.subcategory = 'doghouse' then
    return query select false, '请使用狗屋升级功能', v_star, v_coin, null::uuid, 0; return;
  end if;

  -- 宠物类型：禁止重复领养 + 狗屋容量校验
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

  -- 扣星光值
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
    return query select true, '购买成功！请给宠物取个名字', v_star, v_coin, v_pet_id, 0;
  else
    -- 购买用品：存入背包
    insert into public.pet_inventory (family_id, member_id, item_id, item_name_snapshot, item_emoji, item_image_url, subcategory, quantity)
    values (v_family_id, p_member_id, p_item_id, coalesce(v_item.name, '用品'), v_item.emoji, v_item.image_url, v_item.subcategory, 1)
    on conflict (member_id, item_id) do update set quantity = pet_inventory.quantity + 1
    returning quantity into v_inv_qty;
    return query select true, '已购买并存入背包', v_star, v_coin, null::uuid, v_inv_qty;
  end if;
end;
$$;

-- 权限
grant execute on function public.exp_needed(int) to anon, authenticated;
grant execute on function public.interact_with_pet(uuid, text, uuid) to anon, authenticated;
grant execute on function public.check_pet(uuid) to anon, authenticated;
grant execute on function public.evolve_pet(uuid, text) to anon, authenticated;
grant execute on function public.study_reward(uuid, int, int, uuid) to anon, authenticated;
grant execute on function public.buy_pet_item(uuid, uuid) to anon, authenticated;

-- 重建 buy_doghouse_upgrade（pick up new columns）
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
  v_new_upgrade_cost int;
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

  if v_star < v_item.price_star then
    return query select false, '星光值不足', 0, 0, v_star;
    return;
  end if;

  select * into v_dh from public.dog_house where member_id = p_member_id for update;
  v_current_level := coalesce(v_dh.level, 0);
  v_target_level := v_item.doghouse_level;

  if v_current_level >= v_target_level then
    return query select false, '已拥有该等级或更高等级的狗屋', v_current_level, 0, v_star;
    return;
  end if;

  if v_target_level != v_current_level + 1 then
    return query select false, '需要按顺序购买狗屋', v_current_level, 0, v_star;
    return;
  end if;

  v_new_capacity := case v_target_level
    when 1 then 1
    when 2 then 5
    when 3 then 10
    else 10
  end;
  v_new_upgrade_cost := case v_target_level
    when 1 then 100
    when 2 then 300
    when 3 then 500
    else 500
  end;

  v_star := v_star - v_item.price_star;
  update public.members set star_value = v_star, updated_at = now() where public.members.id = p_member_id;

  if v_current_level = 0 then
    insert into public.dog_house (member_id, family_id, level, capacity, upgrade_cost)
    values (p_member_id, v_member.family_id, v_target_level, v_new_capacity, v_new_upgrade_cost);
  else
    update public.dog_house set level = v_target_level, capacity = v_new_capacity, upgrade_cost = v_new_upgrade_cost
    where member_id = p_member_id;
  end if;

  return query select true, '狗屋升级成功！', v_target_level, v_new_capacity, v_star;
end;
$$;
grant execute on function public.buy_doghouse_upgrade(uuid, uuid) to anon, authenticated;
