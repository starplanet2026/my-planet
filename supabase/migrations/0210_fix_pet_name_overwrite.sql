-- 0210: 修复宠物改名被重置为品种名的问题
-- 根因：0207 迁移执行了 update pets set name = d.name（d.name=品种名），覆盖了用户自定义名
-- 修复：
--   1. pets 表新增 breed 列（品种名，从 pet_shop_items 同步）
--   2. 恢复被覆盖的自定义名：从 study_records / pet_messages 历史快照找回
--   3. 未命名的宠物 name 置 NULL，前端回退显示 breed
--   4. buy_pet_item / gacha_adopt 创建宠物时 name=NULL、breed=商品品种
--   5. interact_with_pet / run_daily_boarding_care 消息中宠物名用 coalesce(name, breed, '宠物')

-- ============================================================
-- 一、pets 表新增 breed 列并回填
-- ============================================================
alter table public.pets add column if not exists breed text;
comment on column public.pets.breed is '品种名（来自 pet_shop_items.breed），未命名时前端显示此字段';

-- 回填已有宠物的 breed
update public.pets p
set breed = psi.breed
from public.pet_shop_items psi
where p.shop_item_id = psi.id
  and p.breed is null;

-- name 列允许 NULL：未命名宠物 name=NULL，前端回退显示 breed
alter table public.pets alter column name drop not null;
comment on column public.pets.name is '用户自定义名（NULL=未命名，前端回退显示 breed）';

-- ============================================================
-- 二、恢复被 0207 覆盖的用户自定义名
-- 从 study_records.pet_name 和 pet_messages.pet_name 取最近一条
-- 非品种名、非"新宠物"的历史名字
-- ============================================================
with recovered as (
  select distinct on (pet_id) pet_id, pet_name
  from (
    select pet_id, pet_name, created_at from public.study_records
    union all
    select pet_id, pet_name, created_at from public.pet_messages
  ) all_names
  where pet_name is not null
    and trim(pet_name) <> ''
    and pet_name <> '新宠物'
  order by pet_id, created_at desc
)
update public.pets p
set name = recovered.pet_name
from recovered
where p.id = recovered.pet_id
  and recovered.pet_name <> coalesce(p.breed, '');

-- 未找回自定义名的宠物：name 置 NULL，前端显示 breed
-- （0207 把所有 name 都改成了 breed，这里把仍然等于 breed 的 name 清空）
update public.pets
set name = null
where name is not null
  and breed is not null
  and name = breed;

-- ============================================================
-- 三、buy_pet_item：创建宠物时 name=NULL、breed=商品品种
-- 基于 0208 版本重写
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
    -- name 置 NULL（未命名），breed 记录品种；前端显示时 name 优先，回退 breed
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

    -- 新宠物到家消息：优先 dialogue_new_pet，否则用品种名
    if v_item.dialogue_new_pet is not null and length(trim(v_item.dialogue_new_pet)) > 0 then
      v_new_pet_msg := v_item.dialogue_new_pet;
    else
      v_new_pet_msg := '新宠物 ' || coalesce(v_item.breed, v_item.name, '新宠物') || ' 到家啦！';
    end if;

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
-- 四、gacha_adopt：创建宠物时 name=NULL、breed=商品品种
-- 基于 0135 版本重写
-- ============================================================
drop function if exists public.gacha_adopt(uuid, uuid);
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
  v_cfg public.gacha_config%rowtype;
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

  -- name 置 NULL，breed 记录品种
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

  return query select true, '领养成功', v_pet_id, v_star;
end;
$$;
grant execute on function public.gacha_adopt(uuid, uuid) to anon, authenticated;

-- ============================================================
-- 五、interact_with_pet：消息中宠物名用 coalesce(name, breed, '宠物')
-- 基于 0204 版本重写，仅修改 add_pet_message 处的 pet_name 取值
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

  -- 显示名：自定义名优先，回退品种名
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
    v_pet.last_care_date := v_today;
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
-- 六、run_daily_boarding_care：coalesce 顺序改为 name 优先
-- 基于 0206 版本重写，仅修改 add_pet_message 处的取值顺序
-- ============================================================
create or replace function public.run_daily_boarding_care(p_member_id uuid default null)
returns void
language plpgsql security definer as $$
declare
  v_member record;
  v_pet record;
  v_trait record;
  v_selected_ids uuid[];
  v_daily_coin numeric;
  v_today date := (now() at time zone 'Asia/Shanghai')::date;
  v_exp_gain int;
  v_mood_exp int;
  v_new_exp int;
  v_exp_needed int;
  v_log record;
  v_daily_total int;
  v_new_star int;
  v_coin_gain numeric := 0;
  v_exp_final numeric;
  v_coin_final numeric;
  v_gap_hunger int;
  v_gap_clean int;
  v_gap_happiness int;
  v_total_gap int;
  v_stars_cost int;
  v_pet_display text;
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

    for v_pet in
      select p.*,
             public.pet_is_sick(p.has_stomach_issue, p.has_skin_issue, p.has_severe_illness) as sick
      from public.pets p
      where p.id = any(v_selected_ids)
    loop
      if v_pet.sick then continue; end if;

      v_pet_display := coalesce(v_pet.name, v_pet.breed, '宠物');

      select * into v_trait from public.pet_traits
        where id = v_pet.trait_id and is_active = true;
      if not found then
        select * into v_trait from public.pet_traits
          where name = '无特质' and is_active = true limit 1;
      end if;

      v_gap_hunger    := greatest(0, 100 - coalesce(v_pet.hunger, 0));
      v_gap_clean     := greatest(0, 100 - coalesce(v_pet.clean, 0));
      v_gap_happiness := greatest(0, 300 - coalesce(v_pet.happiness, 0));
      v_total_gap     := v_gap_hunger + v_gap_clean + v_gap_happiness;
      v_stars_cost    := ceil(v_total_gap::numeric / 5.0)::int;

      if v_stars_cost > 0 and v_member.star_value < v_stars_cost then
        insert into public.pet_boarding_log
          (family_id, member_id, pet_id, board_date,
           hunger_gain, clean_gain, happiness_gain, exp_gain, coin_gain, stars_cost)
        values
          (v_pet.family_id, v_member.id, v_pet.id, v_today,
           0, 0, 0, 0, 0, 0)
        on conflict (member_id, pet_id, board_date) do nothing;

        insert into public.pet_boarding (family_id, member_id, pet_id, board_date)
        values (v_pet.family_id, v_member.id, v_pet.id, v_today)
        on conflict do nothing;

        continue;
      end if;

      if v_stars_cost > 0 then
        v_new_star := v_member.star_value - v_stars_cost;
        update public.members set star_value = v_new_star, updated_at = now()
        where id = v_member.id;
        v_member.star_value := v_new_star;

        insert into public.coin_records (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by, balance_type)
        values (v_member.family_id, v_member.id, -v_stars_cost, v_new_star,
          '萌宠托管消耗星光值，补满属性', 'boarding', 'pet_boarding', v_pet.id, v_member.id, 'star');
      end if;

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

      select * into v_log from public.pet_daily_exp_log
        where pet_id = v_pet.id and log_date = v_today;
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
          update public.pets set exp = v_new_exp, pending_levelup = true where id = v_pet.id;
          perform public.add_pet_message(v_pet.member_id, v_pet.id, 'level_up',
            v_pet_display, v_pet_display || ' 升级了，可以去升级啦！');
        else
          update public.pets set exp = v_new_exp where id = v_pet.id;
        end if;
      end if;

      v_coin_gain := 0;
      if v_pet.last_coin_date is null or v_pet.last_coin_date < v_today then
        v_daily_coin := coalesce(v_pet.base_coin_per_day, 0)
          * (1.0 + coalesce(v_pet.upgrade_percent, 10.0) / 100.0 * (coalesce(v_pet.level, 1) - 1));
        v_coin_final := v_daily_coin * coalesce(v_trait.coin_multiplier, 1.0);
        update public.pets set
          coin_balance = coalesce(coin_balance, 0) + v_coin_final,
          last_coin_date = v_today
        where id = v_pet.id;
        perform public.add_pet_message(v_pet.member_id, v_pet.id, 'coin_harvest',
          v_pet_display, v_pet_display || ' 今日产金 ' || round(v_coin_final)::int || ' 金币');
        v_coin_gain := v_coin_final;
      end if;

      insert into public.pet_boarding (family_id, member_id, pet_id, board_date)
      values (v_pet.family_id, v_member.id, v_pet.id, v_today)
      on conflict do nothing;

      insert into public.pet_boarding_log
        (family_id, member_id, pet_id, board_date,
         hunger_gain, clean_gain, happiness_gain, exp_gain, coin_gain, stars_cost)
      values
        (v_pet.family_id, v_member.id, v_pet.id, v_today,
         v_gap_hunger, v_gap_clean, v_gap_happiness,
         v_exp_gain, v_coin_gain, v_stars_cost)
      on conflict (member_id, pet_id, board_date) do nothing;
    end loop;
  end loop;
end;
$$;
revoke all on function public.run_daily_boarding_care(uuid) from public;
grant execute on function public.run_daily_boarding_care(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
