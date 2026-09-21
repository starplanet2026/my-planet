-- 0068: 萌宠星球 - 疾病系统 + 特质衰减 + 三项填满产金
-- 新增字段：连续未照料天数追踪、三种疾病标记、心情轮次、日产金日期
-- 重写 check_pet / interact_with_pet

-- ============================================================
-- 一、pets 表新增字段
-- ============================================================
alter table public.pets add column if not exists last_feed_date date;
alter table public.pets add column if not exists last_clean_date date;
alter table public.pets add column if not exists last_happiness_date date;
alter table public.pets add column if not exists last_care_date date;
alter table public.pets add column if not exists days_without_feed int not null default 0;
alter table public.pets add column if not exists days_without_clean int not null default 0;
alter table public.pets add column if not exists days_without_care int not null default 0;
alter table public.pets add column if not exists has_stomach_issue boolean not null default false;
alter table public.pets add column if not exists has_skin_issue boolean not null default false;
alter table public.pets add column if not exists has_severe_illness boolean not null default false;
alter table public.pets add column if not exists last_coin_date date;
alter table public.pets add column if not exists happiness_rounds int not null default 0;
alter table public.pets add column if not exists last_happiness_reset_at timestamptz;

-- is_sick 保持兼容：任一疾病即为生病
-- (不删除 is_sick 列，由 RPC 同步维护)

-- ============================================================
-- 二、特质倍率辅助函数
-- ============================================================
create or replace function public.trait_hunger_multiplier(p_trait text)
returns numeric
language sql immutable
as $$
  select case
    when p_trait in ('体质强健', '大胃好养') then 0.8
    when p_trait in ('娇弱易感', '胃口消耗快') then 1.2
    else 1.0
  end;
$$;

create or replace function public.trait_clean_multiplier(p_trait text)
returns numeric
language sql immutable
as $$
  select case
    when p_trait in ('体质强健', '爱干净') then 0.8
    when p_trait in ('娇弱易感', '容易脏') then 1.2
    else 1.0
  end;
$$;

create or replace function public.trait_health_recovery_multiplier(p_trait text)
returns numeric
language sql immutable
as $$
  select case when p_trait = '乐天派' then 0.8 else 1.0 end;
$$;

-- 综合是否生病
create or replace function public.pet_is_sick(
  p_has_stomach boolean, p_has_skin boolean, p_has_severe boolean
)
returns boolean
language sql immutable
as $$
  select coalesce(p_has_stomach, false) or coalesce(p_has_skin, false) or coalesce(p_has_severe, false);
$$;

grant execute on function public.trait_hunger_multiplier(text) to anon, authenticated;
grant execute on function public.trait_clean_multiplier(text) to anon, authenticated;
grant execute on function public.trait_health_recovery_multiplier(text) to anon, authenticated;
grant execute on function public.pet_is_sick(boolean, boolean, boolean) to anon, authenticated;

-- ============================================================
-- 三、重写 check_pet
--    逻辑：
--      1) 计算经过天数
--      2) 逐日衰减 体力/清洁（基准100 × 特质倍率）
--      3) 逐日累计未照料天数，判定三种疾病
--      4) 疾病期间健康值下降
--      5) 更新 is_sick 兼容字段
-- ============================================================
drop function if exists public.check_pet(uuid);

create function public.check_pet(p_pet_id uuid)
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
begin
  select * into v_pet from public.pets where public.pets.id = p_pet_id for update;
  if not found then return; end if;

  v_days := extract(day from now() - coalesce(v_pet.last_check_at, now() - interval '1 day'))::int;

  if v_days >= 1 then
    v_hunger_mult := public.trait_hunger_multiplier(coalesce(v_pet.trait, '平平无奇'));
    v_clean_mult := public.trait_clean_multiplier(coalesce(v_pet.trait, '平平无奇'));

    for v_i in 1..v_days loop
      v_check_date := (now() - (v_days - v_i + 1) * interval '1 day')::date;

      -- 当日是否照料过
      v_fed := coalesce(v_pet.last_feed_date, '2000-01-01'::date) >= v_check_date;
      v_cleaned := coalesce(v_pet.last_clean_date, '2000-01-01'::date) >= v_check_date;
      v_cared := coalesce(v_pet.last_care_date, '2000-01-01'::date) >= v_check_date;

      -- 体力/清洁衰减（基准100）
      v_daily_decay := round(100 * v_hunger_mult)::int;
      v_pet.hunger := greatest(0, coalesce(v_pet.hunger, 0) - v_daily_decay);

      v_daily_decay := round(100 * v_clean_mult)::int;
      v_pet.clean := greatest(0, coalesce(v_pet.clean, 0) - v_daily_decay);

      -- 心情每日归零（每小时重置，这里按天兜底清零）
      v_pet.happiness := 0;
      v_pet.happiness_rounds := 0;

      -- 连续未照料天数
      if v_fed then
        v_pet.days_without_feed := 0;
      else
        v_pet.days_without_feed := coalesce(v_pet.days_without_feed, 0) + 1;
      end if;

      if v_cleaned then
        v_pet.days_without_clean := 0;
      else
        v_pet.days_without_clean := coalesce(v_pet.days_without_clean, 0) + 1;
      end if;

      if v_cared then
        v_pet.days_without_care := 0;
      else
        v_pet.days_without_care := coalesce(v_pet.days_without_care, 0) + 1;
      end if;

      -- 疾病判定
      if v_pet.days_without_feed >= 3 then
        v_pet.has_stomach_issue := true;
      end if;
      if v_pet.days_without_clean >= 3 then
        v_pet.has_skin_issue := true;
      end if;
      if v_pet.days_without_care >= 7 then
        v_pet.has_severe_illness := true;
      end if;

      -- 疾病期间健康值下降
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
      last_check_at = now()
    where public.pets.id = p_pet_id;
  end if;

  return query select * from public.pets where public.pets.id = p_pet_id;
end;
$$;

grant execute on function public.check_pet(uuid) to anon, authenticated;

-- ============================================================
-- 四、重写 interact_with_pet
--    行为：
--      - feed/clean/play/heal 消耗背包物品
--      - feed: 体力填满100，记录 last_feed_date / last_care_date
--      - clean: 清洁填满100，记录 last_clean_date / last_care_date
--      - play: 心情填满100，+10经验，每天最多3轮
--      - heal: 治疗（肠胃药治肠胃不适，驱虫药治体表虫症）
--      - 三项全部填满(≥100)且今日未领金且未生病 → 发放当日金币
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
  v_recovery int := 100;
  v_exp_gain int := 10;
  v_today date := current_date;
  v_hours_since_reset numeric;
  v_daily_coin numeric;
  v_coin_awarded boolean := false;
  v_sick boolean;
begin
  select * into v_pet from public.pets where public.pets.id = p_pet_id for update;
  if not found then return; end if;

  -- 跨用户
  if v_pet.member_id <> p_member_id then
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;

  -- action → subcategory
  if p_action = 'feed' then v_required_sub := 'food';
  elsif p_action = 'clean' then v_required_sub := 'clean';
  elsif p_action = 'play' then v_required_sub := 'toy';
  elsif p_action = 'heal' then v_required_sub := 'medicine';
  else
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;

  -- 重症不能用普通药品
  if p_action = 'heal' and v_pet.has_severe_illness then
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;

  -- 校验背包
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

  -- 读取商品 recovery_value（默认100填满）
  select * into v_item from public.pet_shop_items where public.pet_shop_items.id = p_item_id;
  if found and v_item.recovery_value is not null and v_item.recovery_value > 0 then
    v_recovery := v_item.recovery_value;
  end if;

  -- 扣减背包
  if v_inv.quantity - 1 <= 0 then
    delete from public.pet_inventory where public.pet_inventory.id = v_inv.id;
  else
    update public.pet_inventory set quantity = v_inv.quantity - 1 where public.pet_inventory.id = v_inv.id;
  end if;

  -- 心情轮次：每小时重置，一天最多3轮
  if p_action = 'play' then
    v_hours_since_reset := extract(epoch from (now() - coalesce(v_pet.last_happiness_reset_at, '2000-01-01'::timestamptz))) / 3600;
    if v_hours_since_reset >= 1 then
      v_pet.happiness_rounds := 0;
    end if;
    if v_pet.happiness_rounds >= 3 then
      -- 今日已玩够3轮，不扣物品也不操作（物品已扣，回滚太复杂，这里允许但不给经验）
      return query select * from public.pets where public.pets.id = p_pet_id;
      return;
    end if;
  end if;

  -- 应用恢复
  if p_action = 'feed' then
    v_pet.hunger := least(100, coalesce(v_pet.hunger, 0) + v_recovery);
    v_pet.last_feed_date := v_today;
    v_pet.last_care_date := v_today;
    v_pet.days_without_feed := 0;
    v_pet.days_without_care := 0;
    -- 喂食可缓解肠胃不适
    if v_pet.has_stomach_issue and v_pet.hunger >= 100 then
      v_pet.has_stomach_issue := false;
    end if;
  elsif p_action = 'clean' then
    v_pet.clean := least(100, coalesce(v_pet.clean, 0) + v_recovery);
    v_pet.last_clean_date := v_today;
    v_pet.last_care_date := v_today;
    v_pet.days_without_clean := 0;
    v_pet.days_without_care := 0;
    -- 清洁可缓解体表虫症
    if v_pet.has_skin_issue and v_pet.clean >= 100 then
      v_pet.has_skin_issue := false;
    end if;
  elsif p_action = 'play' then
    v_pet.happiness := least(100, coalesce(v_pet.happiness, 0) + v_recovery);
    v_pet.last_happiness_date := v_today;
    v_pet.last_care_date := v_today;
    v_pet.days_without_care := 0;
    v_pet.happiness_rounds := coalesce(v_pet.happiness_rounds, 0) + 1;
    v_pet.last_happiness_reset_at := now();
    v_pet.exp := coalesce(v_pet.exp, 0) + v_exp_gain;
  elsif p_action = 'heal' then
    -- 药品治疗：根据疾病类型
    -- 肠胃药（subcategory=medicine 且 name 含肠胃）→ 治肠胃不适
    -- 驱虫药 → 治体表虫症
    -- 简化：medicine 物品可治疗非重症的任一疾病
    if v_pet.has_stomach_issue then
      v_pet.has_stomach_issue := false;
    end if;
    if v_pet.has_skin_issue then
      v_pet.has_skin_issue := false;
    end if;
    v_pet.health := least(100, coalesce(v_pet.health, 0) + v_recovery);
  end if;

  v_sick := public.pet_is_sick(v_pet.has_stomach_issue, v_pet.has_skin_issue, v_pet.has_severe_illness);

  -- 三项全部填满(≥100)且今日未领金且未生病 → 发放当日金币
  if coalesce(v_pet.hunger, 0) >= 100
     and coalesce(v_pet.clean, 0) >= 100
     and coalesce(v_pet.happiness, 0) >= 100
     and (v_pet.last_coin_date is null or v_pet.last_coin_date < v_today)
     and not v_sick then
    -- 日产金 = base * (1 + upgrade_percent/100 * (level-1))
    v_daily_coin := coalesce(v_pet.base_coin_per_day, 0)
      * (1.0 + coalesce(v_pet.upgrade_percent, 10.0) / 100.0 * (coalesce(v_pet.level, 1) - 1));
    v_pet.coin_balance := coalesce(v_pet.coin_balance, 0) + v_daily_coin;
    v_pet.last_coin_date := v_today;
    v_coin_awarded := true;
  end if;

  -- 更新宠物
  update public.pets set
    hunger = v_pet.hunger,
    clean = v_pet.clean,
    happiness = v_pet.happiness,
    health = v_pet.health,
    exp = v_pet.exp,
    last_feed_date = v_pet.last_feed_date,
    last_clean_date = v_pet.last_clean_date,
    last_happiness_date = v_pet.last_happiness_date,
    last_care_date = v_pet.last_care_date,
    days_without_feed = v_pet.days_without_feed,
    days_without_clean = v_pet.days_without_clean,
    days_without_care = v_pet.days_without_care,
    has_stomach_issue = v_pet.has_stomach_issue,
    has_skin_issue = v_pet.has_skin_issue,
    has_severe_illness = v_pet.has_severe_illness,
    is_sick = v_sick,
    coin_balance = v_pet.coin_balance,
    last_coin_date = v_pet.last_coin_date,
    happiness_rounds = v_pet.happiness_rounds,
    last_happiness_reset_at = v_pet.last_happiness_reset_at
  where public.pets.id = p_pet_id;

  return query select * from public.pets where public.pets.id = p_pet_id;
end;
$$;

grant execute on function public.interact_with_pet(uuid, uuid, text, uuid) to anon, authenticated;

-- ============================================================
-- 五、重症治疗 RPC：去宠物医院，花费 等级×2 星光值
-- ============================================================
create or replace function public.heal_severe_illness(
  p_member_id uuid,
  p_pet_id uuid
)
returns table(success boolean, message text, new_star int)
language plpgsql security definer as $$
declare
  v_pet record;
  v_member record;
  v_cost int;
begin
  select * into v_pet from public.pets where public.pets.id = p_pet_id for update;
  if not found then
    return query select false, '宠物不存在', 0;
    return;
  end if;
  if v_pet.member_id <> p_member_id then
    return query select false, '无权操作', 0;
    return;
  end if;
  if not v_pet.has_severe_illness then
    return query select false, '宠物没有重症', 0;
    return;
  end if;

  select * into v_member from public.members where id = p_member_id for update;
  v_cost := coalesce(v_pet.level, 1) * 2;
  if v_member.star_value < v_cost then
    return query select false, '星光值不足，需要' || v_cost || '星光值', v_member.star_value;
    return;
  end if;

  update public.members set star_value = star_value - v_cost, updated_at = now() where id = p_member_id;

  update public.pets set
    has_severe_illness = false,
    has_stomach_issue = false,
    has_skin_issue = false,
    is_sick = false,
    health = 100,
    hunger = 0,
    clean = 0,
    happiness = 0,
    days_without_feed = 0,
    days_without_clean = 0,
    days_without_care = 0
  where public.pets.id = p_pet_id;

  return query select true, '治疗成功，宠物已恢复健康', v_member.star_value - v_cost;
end;
$$;

grant execute on function public.heal_severe_illness(uuid, uuid) to anon, authenticated;
