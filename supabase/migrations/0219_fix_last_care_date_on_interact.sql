-- 0219: 修复喂食/清洁/玩耍不更新 last_care_date 导致宠物提前生病
--
-- 根因：
--   interact_with_pet 中只有 heal/medical 会设置 last_care_date = today，
--   feed/clean/play 只更新各自的 last_*_date，不更新 last_care_date。
--   而 check_pet_sickness 用 coalesce(last_care_date, created_at) 计算无照料天数。
--   导致：即使每天喂食/清洁/玩耍，last_care_date 仍为 null，回退到 created_at，
--   领养满3天后宠物必然生病（互动面板显示"互动"但实际未被计入"照料"）。
--
-- 修复：
--   feed/clean/play/heal/medical 统一更新 last_care_date = today。
--   last_care_date 语义为"最后一次照料（喂食/清洁/玩耍/就医）日期"。

create or replace function public.interact_with_pet(
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
  v_trait public.pet_traits%rowtype;
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
  v_exp_final numeric;
  v_coin_final numeric;
  v_pet_display text;
begin
  select * into v_pet from public.pets where public.pets.id = p_pet_id for update;
  if not found then return; end if;
  if v_pet.member_id <> p_member_id then
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;

  v_pet_display := coalesce(v_pet.name, v_pet.breed, '宠物');

  select * into v_trait from public.pet_traits
    where id = v_pet.trait_id and is_active = true;
  if not found then
    select * into v_trait from public.pet_traits
      where name = '无特质' limit 1;
  end if;

  v_old_hunger := coalesce(v_pet.hunger, 0);
  v_old_clean := coalesce(v_pet.clean, 0);
  v_old_happiness := coalesce(v_pet.happiness, 0);
  v_old_health := coalesce(v_pet.health, 0);
  v_was_pending := coalesce(v_pet.pending_levelup, false);

  v_sick := public.pet_is_sick(v_pet.has_stomach_issue, v_pet.has_skin_issue, v_pet.has_severe_illness);
  if v_sick and p_action not in ('heal', 'medical') then
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;

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

  select * into v_item from public.pet_shop_items
    where id = p_item_id and subcategory = v_required_sub limit 1;
  if not found then
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;

  v_recovery := coalesce(v_item.recovery_value, 20);

  select * into v_inv from public.pet_inventory
    where member_id = p_member_id and item_id = p_item_id and quantity > 0 limit 1;
  if not found then
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;

  update public.pet_inventory set quantity = quantity - 1
    where member_id = p_member_id and item_id = p_item_id;
  delete from public.pet_inventory
    where member_id = p_member_id and item_id = p_item_id and quantity <= 0;

  -- 关键修复：所有照料行为都更新 last_care_date
  -- （之前只有 heal/medical 更新，导致 feed/clean/play 不计入"最后照料日期"）
  v_pet.last_care_date := v_today;

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
    v_pet.health := least(v_stat_max, v_old_health + v_recovery);
    if v_pet.health >= v_stat_max then
      if v_pet.has_stomach_issue then v_pet.has_stomach_issue := false; end if;
      if v_pet.has_skin_issue then v_pet.has_skin_issue := false; end if;
      v_pet.days_zero_stats := 0;
      v_sick := false;
    end if;
  end if;

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

    if p_action = 'play' and v_pet.happiness >= v_happiness_max and v_old_happiness < v_happiness_max then
      if coalesce(v_log.mood_full_count, 0) < 1 then
        update public.pet_daily_exp_log set mood_full_count = mood_full_count + 1
          where pet_id = p_pet_id and log_date = v_today;
        v_exp_gain := v_exp_gain + 10;
      end if;
    end if;

    v_daily_total := coalesce(v_log.hunger_full_count, 0) * 10
      + coalesce(v_log.clean_full_count, 0) * 10
      + coalesce(v_log.mood_full_count, 0) * 10;
    if v_daily_total > 50 then v_exp_gain := 0; end if;

    v_exp_final := v_exp_gain * coalesce(v_trait.exp_multiplier, 1.0);
    v_exp_gain := round(v_exp_final)::int;

    if v_exp_gain > 0 then
      v_new_exp := coalesce(v_pet.exp, 0) + v_exp_gain;
      v_exp_needed := public.exp_needed(coalesce(v_pet.level, 1), coalesce(v_pet.rarity, 'common'));
      if v_new_exp >= v_exp_needed then
        v_pet.pending_levelup := true;
        v_pet.exp := v_new_exp;
        if not v_was_pending then
          perform public.add_pet_message(p_member_id, p_pet_id, 'level_up',
            v_pet_display, v_pet_display || ' 升级了，可以去升级啦！');
        end if;
      else
        v_pet.exp := v_new_exp;
      end if;
    end if;

    if coalesce(v_pet.hunger, 0) >= v_stat_max
       and coalesce(v_pet.clean, 0) >= v_stat_max
       and coalesce(v_pet.happiness, 0) >= v_stat_max
       and coalesce(v_pet.health, 0) >= v_stat_max
       and not (v_old_hunger >= v_stat_max and v_old_clean >= v_stat_max
                and v_old_happiness >= v_stat_max and v_old_health >= v_stat_max)
       and coalesce(v_log.daily_coin_claimed, false) = false
    then
      v_daily_coin := coalesce(v_pet.base_coin_per_day, 1) * (1 + (coalesce(v_pet.level, 1) - 1) * 0.1);
      v_coin_final := v_daily_coin * coalesce(v_trait.coin_multiplier, 1.0);
      v_coin_earned := round(v_coin_final)::int;
      v_pet.coin_balance := coalesce(v_pet.coin_balance, 0) + v_coin_earned;
      update public.pet_daily_exp_log set daily_coin_claimed = true
        where pet_id = p_pet_id and log_date = v_today;
      perform public.add_pet_message(p_member_id, p_pet_id, 'coin_harvest',
        v_pet_display, v_pet_display || ' 今日产金 ' || v_coin_earned || ' 金币');
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
-- 数据回填：将已有宠物的 last_care_date 修正为最后一次喂食/清洁/玩耍日期
-- （之前这些操作不更新 last_care_date，导致 last_care_date 为 null）
-- 取 last_feed_date / last_clean_date / last_happiness_date 中最新的非空值
-- ============================================================
update public.pets
set last_care_date = greatest(last_feed_date, last_clean_date, last_happiness_date)
where last_care_date is null
  and (last_feed_date is not null or last_clean_date is not null or last_happiness_date is not null);

notify pgrst, 'reload schema';
