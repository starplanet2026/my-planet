-- 0306: 宠物托管 & 进修逻辑修复
-- 问题1：满级宠物托管继续扣星光/加经验导致经验溢出；进修中宠物仍被托管扣费
-- 问题2：进修准入只比对 pets.max_level，残留的旧值会让未满级宠物通过校验
-- 处理：
--   1) 托管前校验：进修中 / 满级且经验已达上限 → 自动终止托管并记日志，不再扣费
--   2) 满级后经验封顶，不再溢出
--   3) 进修准入按稀有度标准满级判定（common 10 / rare 20 / epic 25），并自动取消托管
--   4) 数据回溯：退还「压力」异常扣费，经验回落到上限

-- ============================================================
-- 一、托管终止日志
-- ============================================================
create table if not exists public.pet_boarding_terminations (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null,
  member_id uuid not null,
  pet_id uuid not null,
  reason text not null,          -- max_level_exp / study
  detail text,
  refund_stars integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_boarding_terminations_member
  on public.pet_boarding_terminations(member_id, created_at desc);

alter table public.pet_boarding_terminations enable row level security;

drop policy if exists "owner can read boarding terminations" on public.pet_boarding_terminations;
create policy "owner can read boarding terminations"
  on public.pet_boarding_terminations for select
  using (exists (
    select 1 from public.families f
    where f.id = pet_boarding_terminations.family_id and f.owner_user_id = auth.uid()
  ));

-- ============================================================
-- 二、标准满级映射
-- ============================================================
create or replace function public.pet_standard_max_level(p_rarity text)
returns integer language sql immutable as $$
  select case p_rarity
    when 'common' then 10
    when 'rare' then 20
    when 'epic' then 25
    else 10
  end;
$$;

-- ============================================================
-- 三、终止托管（取消勾选 + 写日志）
-- ============================================================
create or replace function public.terminate_pet_boarding(
  p_member_id uuid, p_pet_id uuid, p_reason text, p_detail text default null
) returns boolean
language plpgsql security definer as $$
declare
  v_updated int := 0;
  v_pet record;
begin
  update public.pet_boarding_selection
  set selected = false, updated_at = now()
  where member_id = p_member_id and pet_id = p_pet_id and selected = true;
  get diagnostics v_updated = row_count;

  if v_updated > 0 then
    select * into v_pet from public.pets where id = p_pet_id;
    if found then
      insert into public.pet_boarding_terminations
        (family_id, member_id, pet_id, reason, detail)
      values
        (v_pet.family_id, p_member_id, p_pet_id, p_reason, p_detail);
    end if;
    return true;
  end if;
  return false;
end;
$$;

grant execute on function public.terminate_pet_boarding(uuid, uuid, text, text) to authenticated;

-- ============================================================
-- 四、每日托管：跳过进修中 / 满级满经验宠物，经验封顶
-- ============================================================
create or replace function public.run_daily_boarding_care(p_member_id uuid default null)
returns void
language plpgsql security definer as $$
declare
  v_member record;
  v_pet record;
  v_trait record;
  v_selected_ids uuid[];
  v_today date := (now() at time zone 'Asia/Shanghai')::date;
  v_exp_gain int;
  v_mood_exp int;
  v_new_exp int;
  v_exp_cap int;
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
      -- 进修中的宠物不参与托管，自动终止并记日志
      if coalesce(v_pet.is_studying, false) then
        perform public.terminate_pet_boarding(
          v_member.id, v_pet.id, 'study', '宠物进修中，自动终止托管');
        continue;
      end if;

      v_exp_cap := public.exp_needed(
        coalesce(v_pet.level, 1), coalesce(v_pet.rarity, 'common'));

      -- 满级且经验已达上限：继续托管只会白扣星光，终止
      if coalesce(v_pet.level, 1) >= coalesce(v_pet.max_level, 10)
         and coalesce(v_pet.exp, 0) >= v_exp_cap then
        perform public.terminate_pet_boarding(
          v_member.id, v_pet.id, 'max_level_exp', '宠物已满级且经验达上限，自动终止托管');
        continue;
      end if;

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
        if coalesce(v_pet.level, 1) >= coalesce(v_pet.max_level, 10) then
          -- 满级：经验封顶，不溢出
          update public.pets set exp = least(v_new_exp, v_exp_cap) where id = v_pet.id;
        elsif v_new_exp >= v_exp_cap then
          update public.pets set exp = v_new_exp, pending_levelup = true where id = v_pet.id;
          perform public.add_pet_message(v_pet.member_id, v_pet.id, 'level_up',
            v_pet_display, v_pet_display || ' 升级了，可以去升级啦！');
        else
          update public.pets set exp = v_new_exp where id = v_pet.id;
        end if;
      end if;

      v_coin_gain := 0;
      if v_pet.last_coin_date is null or v_pet.last_coin_date < v_today then
        v_coin_final := coalesce(v_pet.base_coin_per_day, 0) * coalesce(v_trait.coin_multiplier, 1.0);
        update public.pets set
          coin_balance = coalesce(coin_balance, 0) + v_coin_final,
          last_coin_date = v_today
        where id = v_pet.id;
        perform public.add_pet_message(v_pet.member_id, v_pet.id, 'coin_harvest',
          v_pet_display, v_pet_display || ' 今日产金 ' || regexp_replace(round(v_coin_final, 1)::text, '\.0$', '') || ' 金币');
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

-- ============================================================
-- 五、进修准入：按稀有度标准满级判定，通过后自动取消托管
-- ============================================================
create or replace function public.send_pet_to_study(p_member_id uuid, p_pet_id uuid)
returns table(success boolean, message text)
language plpgsql security definer as $$
declare
  v_pet record;
  v_max_level int;
begin
  select * into v_pet from public.pets where id = p_pet_id for update;
  if not found then
    return query select false, '宠物不存在';
    return;
  end if;
  if v_pet.member_id <> p_member_id then
    return query select false, '无权操作';
    return;
  end if;
  if v_pet.is_studying then
    return query select false, '宠物已在进修中';
    return;
  end if;

  -- 必须满级：以稀有度标准上限为准，避免 pets.max_level 残留旧值绕过校验
  v_max_level := public.pet_standard_max_level(coalesce(v_pet.rarity, 'common'));
  if coalesce(v_pet.level, 1) < v_max_level then
    return query select false, '宠物需要满级才能进修';
    return;
  end if;

  update public.pets set
    is_studying = true,
    study_start_date = (now() at time zone 'Asia/Shanghai')::date,
    study_last_claim_date = (now() at time zone 'Asia/Shanghai')::date
  where id = p_pet_id;

  -- 进修期间不参与托管，避免继续扣星光
  perform public.terminate_pet_boarding(p_member_id, p_pet_id, 'study', '送入进修，自动取消托管');

  return query select true, '宠物已送去宠物店进修，每天被动产出星光值';
end;
$$;

-- ============================================================
-- 六、数据回溯：退还「压力」异常扣费
--   宠物：压力 fe9844e5-619b-47f4-80b0-641252bb4b09
--   1) 进修期间(11-19 起)持续被托管扣费
--   2) 满级后经验溢出，仍继续扣费
--   退还区间：满级溢出起始日 ~ 今天（含进修期）
-- ============================================================
do $$
declare
  v_pet_id uuid := 'fe9844e5-619b-47f4-80b0-641252bb4b09';
  v_pet record;
  v_exp_cap int;
  v_overflow_days int;
  v_from date;
  v_total int;
  v_new_star int;
  v_detail text;
begin
  select * into v_pet from public.pets where id = v_pet_id;
  if not found then return; end if;

  v_exp_cap := public.exp_needed(coalesce(v_pet.level, 1), coalesce(v_pet.rarity, 'common'));
  -- 每日托管经验 50，溢出天数 = 当前经验 / 50
  v_overflow_days := ceil(coalesce(v_pet.exp, 0)::numeric / 50.0)::int;

  select least(
    coalesce(v_pet.study_start_date, current_date),
    coalesce((
      select min(board_date) from (
        select board_date from public.pet_boarding_log
        where pet_id = v_pet_id and exp_gain > 0
        order by board_date desc
        limit greatest(v_overflow_days, 1)
      ) t
    ), current_date)
  ) into v_from;

  select coalesce(sum(stars_cost), 0) into v_total
  from public.pet_boarding_log
  where pet_id = v_pet_id and board_date >= v_from and stars_cost > 0;

  if v_total > 0 then
    update public.members
      set star_value = coalesce(star_value, 0) + v_total, updated_at = now()
      where id = v_pet.member_id
      returning star_value into v_new_star;

    v_detail := '满级经验溢出+进修期间异常扣费退还，区间 ' || v_from || ' ~ ' ||
                (now() at time zone 'Asia/Shanghai')::date;

    insert into public.coin_records
      (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by, balance_type)
    values
      (v_pet.family_id, v_pet.member_id, v_total, coalesce(v_new_star, 0),
       '托管异常退还：' || v_detail, 'boarding', 'pet_boarding_refund', v_pet_id, v_pet.member_id, 'star');
  end if;

  -- 经验回落到上限，消除溢出
  update public.pets set exp = least(coalesce(exp, 0), v_exp_cap) where id = v_pet_id;

  -- 终止托管勾选并记账
  update public.pet_boarding_selection
    set selected = false, updated_at = now()
    where member_id = v_pet.member_id and pet_id = v_pet_id and selected = true;

  insert into public.pet_boarding_terminations
    (family_id, member_id, pet_id, reason, detail, refund_stars)
  values
    (v_pet.family_id, v_pet.member_id, v_pet_id, 'max_level_exp',
     '历史异常回溯：满级经验溢出 + 进修期间扣费，已终止托管', v_total);
end;
$$;

notify pgrst, 'reload schema';
