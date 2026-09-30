-- 0171: 萌宠星球宠物生病整套逻辑重构
-- Bug1 修复：生病时禁用所有互动、经验、金币、升级（托管禁止逻辑保留）
-- Bug2 修复：健康值=100 时自动解除生病状态
-- 新增：普通生病（属性全0持续3天触发，随机分配病症，药品强绑定）
-- 新增：重病（属性全0持续7天触发，普通药无效，需花费后台配置星光值就医）
-- 新增：families.severe_illness_cost 后台配置字段
-- 新增：medicine 拆分为 stomach_medicine / deworming_medicine

-- ============================================================
-- 一、新增字段
-- ============================================================
alter table public.pets add column if not exists days_zero_stats int not null default 0;
alter table public.families add column if not exists severe_illness_cost int not null default 20;

-- ============================================================
-- 二、pet_shop_items subcategory 扩展：新增 stomach_medicine / deworming_medicine
-- ============================================================
alter table public.pet_shop_items drop constraint if exists pet_shop_items_subcategory_check;
alter table public.pet_shop_items add constraint pet_shop_items_subcategory_check
  check (subcategory in ('dog','cat','food','clean','toy','medicine','foster','doghouse','stomach_medicine','deworming_medicine'));

-- 现有 medicine 商品按名称拆分
update public.pet_shop_items set subcategory = 'stomach_medicine'
  where subcategory = 'medicine' and (name ilike '%肠胃%' or name ilike '%胃%');
update public.pet_shop_items set subcategory = 'deworming_medicine'
  where subcategory = 'medicine' and (name ilike '%驱虫%' or name ilike '%虫%');
-- 剩余未匹配的 medicine 默认设为肠胃药
update public.pet_shop_items set subcategory = 'stomach_medicine'
  where subcategory = 'medicine';

-- 同步更新 pet_inventory 中的 subcategory（背包物品保留 subcategory 字段）
update public.pet_inventory set subcategory = 'stomach_medicine'
  where subcategory = 'medicine';
update public.pet_inventory set subcategory = 'deworming_medicine'
  where subcategory = 'stomach_medicine' and item_id in (
    select id from public.pet_shop_items where subcategory = 'deworming_medicine'
  );

-- ============================================================
-- 三、重写 check_pet：新触发逻辑 + Bug2 修复
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
  v_all_zero boolean;
begin
  select * into v_pet from public.pets where public.pets.id = p_pet_id for update;
  if not found then return; end if;

  v_days := extract(day from now() - coalesce(v_pet.last_check_at, now() - interval '1 day'))::int;

  if v_days >= 1 then
    v_hunger_mult := public.trait_hunger_multiplier(coalesce(v_pet.trait, '平平无奇'));
    v_clean_mult := public.trait_clean_multiplier(coalesce(v_pet.trait, '平平无奇'));

    for v_i in 1..v_days loop
      v_check_date := (now() - (v_days - v_i + 1) * interval '1 day')::date;

      v_fed := coalesce(v_pet.last_feed_date, '2000-01-01'::date) >= v_check_date;
      v_cleaned := coalesce(v_pet.last_clean_date, '2000-01-01'::date) >= v_check_date;
      v_cared := coalesce(v_pet.last_care_date, '2000-01-01'::date) >= v_check_date;

      -- 体力/清洁衰减
      v_daily_decay := round(100 * v_hunger_mult)::int;
      v_pet.hunger := greatest(0, coalesce(v_pet.hunger, 0) - v_daily_decay);

      v_daily_decay := round(100 * v_clean_mult)::int;
      v_pet.clean := greatest(0, coalesce(v_pet.clean, 0) - v_daily_decay);

      -- 心情每日归零
      v_pet.happiness := 0;
      v_pet.happiness_rounds := 0;

      -- 连续未照料天数（保留用于记录）
      if v_fed then v_pet.days_without_feed := 0;
      else v_pet.days_without_feed := coalesce(v_pet.days_without_feed, 0) + 1;
      end if;
      if v_cleaned then v_pet.days_without_clean := 0;
      else v_pet.days_without_clean := coalesce(v_pet.days_without_clean, 0) + 1;
      end if;
      if v_cared then v_pet.days_without_care := 0;
      else v_pet.days_without_care := coalesce(v_pet.days_without_care, 0) + 1;
      end if;

      -- 新逻辑：三项属性全0判断
      v_all_zero := (coalesce(v_pet.hunger, 0) = 0)
        and (coalesce(v_pet.clean, 0) = 0)
        and (coalesce(v_pet.happiness, 0) = 0);

      if v_all_zero then
        v_pet.days_zero_stats := coalesce(v_pet.days_zero_stats, 0) + 1;
      else
        v_pet.days_zero_stats := 0;
      end if;

      -- 普通生病触发：属性全0持续满3天，且当前未生病
      if v_pet.days_zero_stats >= 3
         and not v_pet.has_severe_illness
         and not v_pet.has_stomach_issue
         and not v_pet.has_skin_issue then
        -- 随机分配一种病症
        if random() < 0.5 then
          v_pet.has_stomach_issue := true;
        else
          v_pet.has_skin_issue := true;
        end if;
      end if;

      -- 重病触发：属性全0持续满7天
      if v_pet.days_zero_stats >= 7 then
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
      days_zero_stats = v_pet.days_zero_stats,
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
-- 四、重写 interact_with_pet：Bug1 修复 + 药品强绑定 + Bug2 修复
-- ============================================================
drop function if exists public.interact_with_pet(uuid, uuid, text, uuid);

create function public.interact_with_pet(
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
  v_mood_threshold int;
  v_sick boolean;
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

  -- Bug1 修复：生病时禁止所有非 heal 互动
  v_sick := public.pet_is_sick(v_pet.has_stomach_issue, v_pet.has_skin_issue, v_pet.has_severe_illness);
  if v_sick and p_action not in ('heal', 'medical') then
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;

  -- action → subcategory（药品强绑定）
  if p_action = 'feed' then v_required_sub := 'food';
  elsif p_action = 'clean' then v_required_sub := 'clean';
  elsif p_action = 'play' then v_required_sub := 'toy';
  elsif p_action in ('heal', 'medical') then
    -- 重病不能用普通药品（前端通过 heal_severe_illness RPC 处理）
    if v_pet.has_severe_illness then
      return query select * from public.pets where public.pets.id = p_pet_id;
      return;
    end if;
    -- 药品强绑定：根据病症选择对应药品
    if v_pet.has_stomach_issue then
      v_required_sub := 'stomach_medicine';
    elsif v_pet.has_skin_issue then
      v_required_sub := 'deworming_medicine';
    else
      -- 无病症，不需要 heal
      return query select * from public.pets where public.pets.id = p_pet_id;
      return;
    end if;
  else
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;

  -- 满值检查
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

  -- 校验商品
  select * into v_item from public.pet_shop_items
    where id = p_item_id and subcategory = v_required_sub limit 1;
  if not found then
    -- 药品不匹配（错误药品）：提示无效，不消耗，维持生病状态
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;

  v_recovery := coalesce(v_item.recovery_value, 20);

  -- 校验背包
  select * into v_inv from public.pet_inventory
    where member_id = p_member_id and item_id = p_item_id and quantity > 0 limit 1;
  if not found then
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;

  -- 消耗物品
  update public.pet_inventory set quantity = quantity - 1
    where member_id = p_member_id and item_id = p_item_id;
  delete from public.pet_inventory
    where member_id = p_member_id and item_id = p_item_id and quantity <= 0;

  -- 执行互动
  if p_action = 'feed' then
    v_pet.hunger := least(v_stat_max, v_old_hunger + v_recovery);
    v_pet.last_feed_date := v_today;
  elsif p_action = 'clean' then
    v_pet.clean := least(v_stat_max, v_old_clean + v_recovery);
    v_pet.last_clean_date := v_today;
  elsif p_action = 'play' then
    v_pet.happiness := least(v_happiness_max, v_old_happiness + v_recovery);
    v_pet.last_happiness_date := v_today;
  elsif p_action in ('heal', 'medical') then
    -- Bug2 修复：heal 成功后 health=100，重置对应疾病标记
    v_pet.health := v_stat_max;
    v_pet.last_care_date := v_today;
    if v_pet.has_stomach_issue then
      v_pet.has_stomach_issue := false;
    end if;
    if v_pet.has_skin_issue then
      v_pet.has_skin_issue := false;
    end if;
    v_pet.days_zero_stats := 0;
    v_sick := false; -- 已治愈
  end if;

  -- 经验/金币逻辑（仅健康时，生病时 heal 后已重置 v_sick=false）
  if not v_sick or p_action in ('heal', 'medical') then
    select * into v_log from public.pet_daily_exp_log where pet_id = p_pet_id and log_date = v_today;
    if not found then
      insert into public.pet_daily_exp_log (pet_id, log_date) values (p_pet_id, v_today)
        on conflict (pet_id, log_date) do nothing;
      select * into v_log from public.pet_daily_exp_log where pet_id = p_pet_id and log_date = v_today;
    end if;

    -- 体力满额 +10
    if p_action = 'feed' and v_pet.hunger >= v_stat_max and v_old_hunger < v_stat_max then
      if coalesce(v_log.hunger_full_count, 0) < 1 then
        update public.pet_daily_exp_log set hunger_full_count = hunger_full_count + 1
          where pet_id = p_pet_id and log_date = v_today;
        v_exp_gain := v_exp_gain + 10;
      end if;
    end if;

    -- 清洁满额 +10
    if p_action = 'clean' and v_pet.clean >= v_stat_max and v_old_clean < v_stat_max then
      if coalesce(v_log.clean_full_count, 0) < 1 then
        update public.pet_daily_exp_log set clean_full_count = clean_full_count + 1
          where pet_id = p_pet_id and log_date = v_today;
        v_exp_gain := v_exp_gain + 10;
      end if;
    end if;

    -- 心情阈值触发
    if p_action = 'play' and coalesce(v_log.mood_full_count, 0) < 3 then
      v_mood_threshold := (coalesce(v_log.mood_full_count, 0) + 1) * 100;
      if v_pet.happiness >= v_mood_threshold and v_old_happiness < v_mood_threshold then
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
        if not v_was_pending then
          perform public.add_pet_message(p_member_id, p_pet_id, 'level_up',
            v_pet.name, v_pet.name || ' 升级了，可以去升级啦！');
        end if;
      else
        v_pet.exp := v_new_exp;
      end if;
    end if;

    -- 四项满 → 每日金币（体力/清洁/心情各满100即可，无需心情满300）
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
      perform public.add_pet_message(p_member_id, p_pet_id, 'coin_harvest',
        v_pet.name, v_pet.name || ' 今日产金 ' || v_coin_earned || ' 金币');
    end if;
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
    exp = v_pet.exp,
    pending_levelup = v_pet.pending_levelup,
    coin_balance = v_pet.coin_balance,
    has_stomach_issue = v_pet.has_stomach_issue,
    has_skin_issue = v_pet.has_skin_issue,
    has_severe_illness = v_pet.has_severe_illness,
    is_sick = v_sick,
    days_zero_stats = v_pet.days_zero_stats
  where public.pets.id = p_pet_id;

  return query select * from public.pets where public.pets.id = p_pet_id;
end;
$$;

revoke all on function public.interact_with_pet(uuid, uuid, text, uuid) from public;
grant execute on function public.interact_with_pet(uuid, uuid, text, uuid) to anon, authenticated;

-- ============================================================
-- 五、重写 heal_severe_illness：读取后台配置 severe_illness_cost
-- ============================================================
drop function if exists public.heal_severe_illness(uuid, uuid);

create function public.heal_severe_illness(
  p_member_id uuid,
  p_pet_id uuid
)
returns table(success boolean, message text, new_star int)
language plpgsql security definer as $$
declare
  v_pet record;
  v_member record;
  v_family record;
  v_cost int;
  v_new_star int;
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
  select * into v_family from public.families where id = v_member.family_id;

  -- 读取后台配置的重病就医消耗星光值
  v_cost := coalesce(v_family.severe_illness_cost, 20);

  if v_member.star_value < v_cost then
    return query select false, '星光值不足，需要 ' || v_cost || ' 星光值', v_member.star_value;
    return;
  end if;

  -- 扣除星光值
  v_new_star := v_member.star_value - v_cost;
  update public.members set star_value = v_new_star, updated_at = now() where id = p_member_id;

  -- 星光消耗流水
  insert into public.coin_records (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by, balance_type)
  values (v_member.family_id, p_member_id, -v_cost, v_new_star,
    '重病就医消耗星光值', 'medical', 'pet', p_pet_id, p_member_id, 'star');

  -- 重置宠物：健康值恢复100，重置所有疾病标记，属性清零（保留原 0068 逻辑）
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
    days_without_care = 0,
    days_zero_stats = 0
  where public.pets.id = p_pet_id;

  -- 写入治愈消息
  perform public.add_pet_message(p_member_id, p_pet_id, 'sick',
    v_pet.name, v_pet.name || ' 已治愈重病，恢复健康啦！');

  return query select true, '治疗成功，宠物已恢复健康', v_new_star;
end;
$$;

grant execute on function public.heal_severe_illness(uuid, uuid) to anon, authenticated;

-- ============================================================
-- 六、历史数据修正
-- ============================================================

-- 1. 已有普通疾病标记且属性全0的宠物，设置 days_zero_stats = 3
update public.pets
set days_zero_stats = 3
where (has_stomach_issue or has_skin_issue)
  and not has_severe_illness
  and coalesce(hunger, 0) = 0
  and coalesce(clean, 0) = 0
  and coalesce(happiness, 0) = 0;

-- 2. 重病宠物设置 days_zero_stats = 7
update public.pets
set days_zero_stats = 7
where has_severe_illness;

-- 3. 健康状态但 is_sick=true 的宠物，修正 is_sick=false
update public.pets
set is_sick = false
where not has_stomach_issue
  and not has_skin_issue
  and not has_severe_illness
  and is_sick = true;

notify pgrst, 'reload schema';
