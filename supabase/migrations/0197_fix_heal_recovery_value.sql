-- 0197: 修复药品恢复健康值读取后台配置
-- Bug: heal/medical 直接设 health=100，未读取 recovery_value
-- 修复: ① 药品恢复值读取 recovery_value ② 上限100 ③ health=100时才解除生病

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

  -- 生病时禁止所有非 heal 互动
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
    if v_pet.has_severe_illness then
      return query select * from public.pets where public.pets.id = p_pet_id;
      return;
    end if;
    if v_pet.has_stomach_issue then
      v_required_sub := 'stomach_medicine';
    elsif v_pet.has_skin_issue then
      v_required_sub := 'deworming_medicine';
    else
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
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;

  -- 恢复值读取后台配置
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
    -- 修复：药品恢复值读取后台 recovery_value，不再直接拉满100
    v_pet.health := least(v_stat_max, v_old_health + v_recovery);
    v_pet.last_care_date := v_today;
    -- 仅健康值满100时才解除生病状态
    if v_pet.health >= v_stat_max then
      if v_pet.has_stomach_issue then
        v_pet.has_stomach_issue := false;
      end if;
      if v_pet.has_skin_issue then
        v_pet.has_skin_issue := false;
      end if;
      v_pet.days_zero_stats := 0;
      v_sick := false; -- 已治愈
    end if;
    -- health < 100 时维持生病状态，v_sick 保持 true
  end if;

  -- 经验/金币逻辑（仅未生病时执行）
  if not v_sick then
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

    -- 四项满 → 每日金币
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

grant execute on function public.interact_with_pet(uuid, uuid, text, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
