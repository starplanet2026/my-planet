-- 0128: 托管历史记录
-- 1. 新增 pet_boarding_log 表：记录每只宠物每日托管的各项收益明细
--    （体力/清洁/心情增加值、经验增加值、金币收益）
-- 2. 修改 run_daily_boarding_care：结算时插入日志（幂等，on conflict do nothing）
-- 3. 新增 get_boarding_history RPC：查询指定用户近 N 天托管明细
-- 其余托管逻辑不变。

-- ============================================================
-- 一、pet_boarding_log 表
-- ============================================================
create table if not exists public.pet_boarding_log (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  pet_id uuid not null references public.pets(id) on delete cascade,
  board_date date not null,
  hunger_gain int not null default 0,
  clean_gain int not null default 0,
  happiness_gain int not null default 0,
  exp_gain int not null default 0,
  coin_gain numeric not null default 0,
  created_at timestamptz not null default now(),
  unique (member_id, pet_id, board_date)
);

create index if not exists idx_boarding_log_member_date
  on public.pet_boarding_log(member_id, board_date desc);

alter table public.pet_boarding_log enable row level security;
drop policy if exists "boarding_log_select_own" on public.pet_boarding_log;
create policy "boarding_log_select_own" on public.pet_boarding_log
  for select using (member_id = auth.uid());
-- 插入由 security definer 函数完成，不需要用户直接插入权限

-- ============================================================
-- 二、修改 run_daily_boarding_care：结算时插入日志
-- ============================================================
create or replace function public.run_daily_boarding_care(p_member_id uuid default null)
returns void
language plpgsql security definer as $$
declare
  v_member record;
  v_pet record;
  v_selected_ids uuid[];
  v_total_gap int;
  v_stars_needed int;
  v_daily_coin numeric;
  v_today date := (now() at time zone 'Asia/Shanghai')::date;
  v_old_hunger int;
  v_old_clean int;
  v_old_happiness int;
  v_exp_gain int;
  v_new_exp int;
  v_exp_needed int;
  v_log record;
  v_daily_total int;
  v_new_star int;
  v_coin_gain numeric := 0;
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

    v_total_gap := 0;
    for v_pet in
      select p.id, p.hunger, p.clean, p.happiness,
             public.pet_is_sick(p.has_stomach_issue, p.has_skin_issue, p.has_severe_illness) as sick
      from public.pets p
      where p.id = any(v_selected_ids)
    loop
      if v_pet.sick then continue; end if;
      v_total_gap := v_total_gap
        + greatest(0, 100 - coalesce(v_pet.hunger, 0))
        + greatest(0, 100 - coalesce(v_pet.clean, 0))
        + greatest(0, 100 - coalesce(v_pet.happiness, 0));
    end loop;

    v_stars_needed := ceil(coalesce(v_total_gap, 0)::numeric / 5.0)::int;

    if v_member.star_value < v_stars_needed then
      continue;
    end if;

    if v_stars_needed > 0 then
      v_new_star := v_member.star_value - v_stars_needed;
      update public.members set star_value = v_new_star, updated_at = now()
      where id = v_member.id;
      insert into public.coin_records (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by, balance_type)
      values (v_member.family_id, v_member.id, -v_stars_needed, v_new_star,
        '萌宠托管消耗星光值，产出金币', 'boarding', 'pet_boarding', null, v_member.id, 'star');
    end if;

    for v_pet in
      select p.*,
             public.pet_is_sick(p.has_stomach_issue, p.has_skin_issue, p.has_severe_illness) as sick
      from public.pets p
      where p.id = any(v_selected_ids)
    loop
      if v_pet.sick then continue; end if;

      v_old_hunger := coalesce(v_pet.hunger, 0);
      v_old_clean := coalesce(v_pet.clean, 0);
      v_old_happiness := coalesce(v_pet.happiness, 0);

      update public.pets set
        hunger = 100,
        clean = 100,
        happiness = 100,
        last_feed_date = v_today,
        last_clean_date = v_today,
        last_happiness_date = v_today,
        last_care_date = v_today,
        days_without_feed = 0,
        days_without_clean = 0,
        days_without_care = 0
      where id = v_pet.id;

      -- 经验值发放
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

      if v_old_hunger < 100 and coalesce(v_log.hunger_full_count, 0) < 1 then
        update public.pet_daily_exp_log set hunger_full_count = 1
          where pet_id = v_pet.id and log_date = v_today;
        v_exp_gain := v_exp_gain + 10;
      end if;
      if v_old_clean < 100 and coalesce(v_log.clean_full_count, 0) < 1 then
        update public.pet_daily_exp_log set clean_full_count = 1
          where pet_id = v_pet.id and log_date = v_today;
        v_exp_gain := v_exp_gain + 10;
      end if;
      if v_old_happiness < 100 and coalesce(v_log.mood_full_count, 0) < 3 then
        update public.pet_daily_exp_log set mood_full_count = 3
          where pet_id = v_pet.id and log_date = v_today;
        v_exp_gain := v_exp_gain + 10;
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

      -- 三项属性补满 → 每日金币
      v_coin_gain := 0;
      if v_pet.last_coin_date is null or v_pet.last_coin_date < v_today then
        v_daily_coin := coalesce(v_pet.base_coin_per_day, 0)
          * (1.0 + coalesce(v_pet.upgrade_percent, 10.0) / 100.0 * (coalesce(v_pet.level, 1) - 1));
        update public.pets set
          coin_balance = coalesce(coin_balance, 0) + v_daily_coin,
          last_coin_date = v_today
        where id = v_pet.id;
        perform public.add_pet_message(v_pet.member_id, v_pet.id, 'coin_harvest',
          v_pet.name, v_pet.name || ' 收获了 ' || round(v_daily_coin)::int || ' 金币');
        v_coin_gain := coalesce(v_daily_coin, 0);
      end if;

      insert into public.pet_boarding (family_id, member_id, pet_id, board_date)
      values (v_pet.family_id, v_member.id, v_pet.id, v_today)
      on conflict do nothing;

      -- 记录当日托管收益明细（幂等：同日同宠物只记一次）
      insert into public.pet_boarding_log
        (family_id, member_id, pet_id, board_date,
         hunger_gain, clean_gain, happiness_gain, exp_gain, coin_gain)
      values
        (v_pet.family_id, v_member.id, v_pet.id, v_today,
         greatest(0, 100 - v_old_hunger),
         greatest(0, 100 - v_old_clean),
         greatest(0, 100 - v_old_happiness),
         v_exp_gain,
         v_coin_gain)
      on conflict (member_id, pet_id, board_date) do nothing;
    end loop;
  end loop;
end;
$$;
revoke all on function public.run_daily_boarding_care(uuid) from public;
grant execute on function public.run_daily_boarding_care(uuid) to anon, authenticated;

-- ============================================================
-- 三、get_boarding_history RPC：查询近 N 天托管明细
-- ============================================================
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
  coin_gain numeric
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
    l.coin_gain
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
