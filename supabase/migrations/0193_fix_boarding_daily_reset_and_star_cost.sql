-- 0193: 修复托管每日0点属性清零+固定扣100星光值+历史漏扣补扣
-- Bug: 持续托管时属性已满→gap=0→不扣星光→用户白嫖托管
-- 修复: 无论是否连续托管，每日0点固定执行：清零属性→扣100星光→补满属性
--       星光不足100时跳过该宠物（不重置、不扣费、不发放经验金币）

-- ============================================================
-- 一、pet_boarding_log 新增 stars_cost 字段
-- ============================================================
alter table public.pet_boarding_log
  add column if not exists stars_cost int not null default 0;

comment on column public.pet_boarding_log.stars_cost is '本次托管扣除的星光值';

-- ============================================================
-- 二、重写 run_daily_boarding_care：固定100星光/只，先清零再补满
-- ============================================================
create or replace function public.run_daily_boarding_care(p_member_id uuid default null)
returns void
language plpgsql security definer as $$
declare
  v_member record;
  v_pet record;
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
  v_stars_cost int := 100;  -- 固定每只宠物扣100星光
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
    -- 已执行过则跳过（幂等）
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

    -- 逐只宠物处理：先清零→扣100星光→补满→发经验金币
    for v_pet in
      select p.*,
             public.pet_is_sick(p.has_stomach_issue, p.has_skin_issue, p.has_severe_illness) as sick
      from public.pets p
      where p.id = any(v_selected_ids)
    loop
      if v_pet.sick then continue; end if;

      -- 星光值不足100：跳过该宠物，不重置、不扣费、不发放
      if v_member.star_value < v_stars_cost then
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

      -- 步骤1：清零全部属性
      update public.pets set
        hunger = 0,
        clean = 0,
        happiness = 0,
        last_check_at = now()
      where id = v_pet.id;

      -- 步骤2：扣除100星光值
      v_new_star := v_member.star_value - v_stars_cost;
      update public.members set star_value = v_new_star, updated_at = now()
      where id = v_member.id;
      v_member.star_value := v_new_star;  -- 更新内存中的余额供下一只宠物判断

      insert into public.coin_records (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by, balance_type)
      values (v_member.family_id, v_member.id, -v_stars_cost, v_new_star,
        '萌宠托管消耗星光值，补满属性', 'boarding', 'pet_boarding', v_pet.id, v_member.id, 'star');

      -- 步骤3：补满全部属性
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

      -- 发放经验值
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
      if v_daily_total > 50 then
        v_exp_gain := 0;
      end if;

      if v_exp_gain > 0 then
        v_new_exp := coalesce(v_pet.exp, 0) + v_exp_gain;
        v_exp_needed := public.exp_needed(coalesce(v_pet.level, 1), coalesce(v_pet.rarity, 'common'));
        if v_new_exp >= v_exp_needed then
          update public.pets set exp = v_new_exp, pending_levelup = true where id = v_pet.id;
          perform public.add_pet_message(v_pet.member_id, v_pet.id, 'level_up',
            v_pet.name, v_pet.name || ' 升级了，可以去升级啦！');
        else
          update public.pets set exp = v_new_exp where id = v_pet.id;
        end if;
      end if;

      -- 今日产金
      v_coin_gain := 0;
      if v_pet.last_coin_date is null or v_pet.last_coin_date < v_today then
        v_daily_coin := coalesce(v_pet.base_coin_per_day, 0)
          * (1.0 + coalesce(v_pet.upgrade_percent, 10.0) / 100.0 * (coalesce(v_pet.level, 1) - 1));
        update public.pets set
          coin_balance = coalesce(coin_balance, 0) + v_daily_coin,
          last_coin_date = v_today
        where id = v_pet.id;
        perform public.add_pet_message(v_pet.member_id, v_pet.id, 'coin_harvest',
          v_pet.name, v_pet.name || ' 今日产金 ' || round(v_daily_coin)::int || ' 金币');
        v_coin_gain := coalesce(v_daily_coin, 0);
      end if;

      -- 记录托管日志（含星光消耗）
      insert into public.pet_boarding (family_id, member_id, pet_id, board_date)
      values (v_pet.family_id, v_member.id, v_pet.id, v_today)
      on conflict do nothing;

      insert into public.pet_boarding_log
        (family_id, member_id, pet_id, board_date,
         hunger_gain, clean_gain, happiness_gain, exp_gain, coin_gain, stars_cost)
      values
        (v_pet.family_id, v_member.id, v_pet.id, v_today,
         100, 100, 300,  -- 清零后补满，固定 gain 为满值
         v_exp_gain,
         v_coin_gain,
         v_stars_cost)
      on conflict (member_id, pet_id, board_date) do nothing;
    end loop;
  end loop;
end;
$$;
revoke all on function public.run_daily_boarding_care(uuid) from public;
grant execute on function public.run_daily_boarding_care(uuid) to anon, authenticated;

-- ============================================================
-- 三、更新 get_boarding_history RPC：返回 stars_cost 字段
-- ============================================================
drop function if exists public.get_boarding_history(uuid, int);
create or replace function public.get_boarding_history(
  p_member_id uuid,
  p_days int default 30
)
returns table(
  board_date date,
  pet_id uuid,
  pet_name text,
  pet_emoji text,
  pet_image_url text,
  hunger_gain int,
  clean_gain int,
  happiness_gain int,
  exp_gain int,
  coin_gain numeric,
  stars_cost int
)
language plpgsql security definer as $$
begin
  return query
  select
    l.board_date,
    l.pet_id,
    p.name,
    coalesce(p.emoji, ''),
    coalesce(si.image_url, p.image_url, ''),
    l.hunger_gain,
    l.clean_gain,
    l.happiness_gain,
    l.exp_gain,
    l.coin_gain,
    l.stars_cost
  from public.pet_boarding_log l
  join public.pets p on p.id = l.pet_id
  left join public.pet_shop_items si on si.id = p.shop_item_id
  where l.member_id = p_member_id
    and l.board_date >= ((now() at time zone 'Asia/Shanghai')::date - coalesce(p_days, 30))
  order by l.board_date desc, p.name asc;
end;
$$;
revoke all on function public.get_boarding_history(uuid, int) from public;
grant execute on function public.get_boarding_history(uuid, int) to anon, authenticated;

-- ============================================================
-- 四、历史漏扣补扣：分两部分处理
--    A. 首次托管记录（hunger_gain>0, stars_cost=0）：
--       旧代码已按 gap 扣过星光，只是 stars_cost 列刚加默认0
--       → 不再扣费，仅更新 stars_cost=100，规范化 gain 为 100/100/300
--    B. 连续托管记录（hunger_gain=0, stars_cost=0）：
--       旧代码因属性已满 gap=0 未扣费，属于漏扣
--       → 补扣100星光，更新 stars_cost=100，gain 规范为 100/100/300
--       星光不足100的记录跳过（记录但不扣）
-- ============================================================

-- Part A: 首次托管记录——旧代码已扣费，仅更新 stars_cost 和 gain
update public.pet_boarding_log
set stars_cost = 100,
    hunger_gain = 100,
    clean_gain = 100,
    happiness_gain = 300
where coalesce(stars_cost, 0) = 0
  and hunger_gain > 0;

-- Part B: 连续托管记录——漏扣，需补扣100星光
do $$
declare
  v_bl record;
  v_member record;
  v_new_star int;
  v_total_backcharged int := 0;
  v_total_skipped int := 0;
begin
  for v_bl in
    select bl.id, bl.member_id, bl.family_id, bl.board_date, bl.pet_id
    from public.pet_boarding_log bl
    where coalesce(bl.stars_cost, 0) = 0
      and bl.hunger_gain = 0  -- 连续托管：属性已满，旧代码未扣费
    order by bl.board_date
  loop
    select * into v_member from public.members where id = v_bl.member_id for update;

    if not found then
      v_total_skipped := v_total_skipped + 1;
      continue;
    end if;

    -- 星光值不足100，跳过（记录但不扣）
    if v_member.star_value < 100 then
      v_total_skipped := v_total_skipped + 1;
      continue;
    end if;

    -- 扣100星光
    v_new_star := v_member.star_value - 100;
    update public.members set star_value = v_new_star, updated_at = now()
    where id = v_bl.member_id;

    -- 写扣费流水
    insert into public.coin_records (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by, balance_type)
    values (v_bl.family_id, v_bl.member_id, -100, v_new_star,
      '萌宠托管历史补扣星光值(' || v_bl.board_date || ')', 'boarding', 'pet_boarding', v_bl.pet_id, v_bl.member_id, 'star');

    -- 更新托管日志：stars_cost=100，gain 规范为 100/100/300
    update public.pet_boarding_log
    set stars_cost = 100,
        hunger_gain = 100,
        clean_gain = 100,
        happiness_gain = 300
    where id = v_bl.id;

    v_total_backcharged := v_total_backcharged + 1;
  end loop;

  raise notice '历史补扣完成: 补扣 % 条, 跳过 % 条(余额不足)', v_total_backcharged, v_total_skipped;
end;
$$;

notify pgrst, 'reload schema';
