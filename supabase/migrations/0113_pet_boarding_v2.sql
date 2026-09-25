-- 0113_pet_boarding_v2.sql
-- 萌宠星球：托管机制重构
-- 1. 托管卡配置后台化（pet_shop_items 加 valid_days）
-- 2. 托管卡购买改为按商品 item_id，每张卡独立记录（可多张叠加续期）
-- 3. 新增宠物托管勾选表 pet_boarding_selection（持久化选择）
-- 4. board_pets → set_boarding_selection（仅保存选择，不立即填属性）
-- 5. 新增 run_daily_boarding_care：北京时间每日0点自动养护，1星光=5属性点
-- 6. pg_cron 定时任务

-- ============================================================
-- 一、pet_shop_items 增加 valid_days（托管卡有效天数）
-- ============================================================
alter table public.pet_shop_items add column if not exists valid_days integer;

-- 回填现有托管卡的有效天数
update public.pet_shop_items set valid_days = 1
  where subcategory = 'foster' and name = '托管日卡' and valid_days is null;
update public.pet_shop_items set valid_days = 7
  where subcategory = 'foster' and name = '托管周卡' and valid_days is null;
update public.pet_shop_items set valid_days = 30
  where subcategory = 'foster' and name = '托管月卡' and valid_days is null;

-- ============================================================
-- 二、pet_boarding_cards 增加 item_id，放宽 card_type 约束
-- ============================================================
alter table public.pet_boarding_cards add column if not exists item_id uuid references public.pet_shop_items(id);
alter table public.pet_boarding_cards drop constraint if exists pet_boarding_cards_card_type_check;
alter table public.pet_boarding_cards alter column card_type drop not null;

-- ============================================================
-- 三、托管选择表（持久化用户勾选的宠物）
-- ============================================================
create table if not exists public.pet_boarding_selection (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  pet_id uuid not null references public.pets(id) on delete cascade,
  selected boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (member_id, pet_id)
);
create index if not exists idx_boarding_selection_member on public.pet_boarding_selection(member_id);

-- ============================================================
-- 四、buy_boarding_card：按 item_id 购买，每张卡独立记录
-- ============================================================
drop function if exists public.buy_boarding_card(uuid, text);

create or replace function public.buy_boarding_card(
  p_member_id uuid,
  p_item_id uuid
)
returns table(success boolean, message text, new_star int, end_date date)
language plpgsql security definer as $$
declare
  v_member record;
  v_item record;
  v_family_id uuid;
  v_cost int;
  v_days int;
  v_last_end date;
  v_start date;
  v_new_end date;
begin
  select * into v_member from public.members where id = p_member_id for update;
  if not found then
    return query select false, '用户不存在', 0, null::date;
    return;
  end if;
  v_family_id := v_member.family_id;

  select * into v_item from public.pet_shop_items
    where id = p_item_id and subcategory = 'foster' and status = 'active';
  if not found then
    return query select false, '托管卡不存在或已下架', v_member.star_value, null::date;
    return;
  end if;

  v_cost := coalesce(v_item.price_star, 0);
  v_days := coalesce(v_item.valid_days, 1);

  if v_member.star_value < v_cost then
    return query select false, '星光值不足', v_member.star_value, null::date;
    return;
  end if;

  -- 扣费
  update public.members set star_value = star_value - v_cost, updated_at = now() where id = p_member_id;

  -- 找到该用户所有托管卡中最晚的截止日期（限定表别名避免歧义）
  select max(pbc.end_date) into v_last_end
    from public.pet_boarding_cards pbc
    where pbc.member_id = p_member_id;

  -- 生效起始日：若有未过期/未来的卡，接在最后一张之后；否则从今天开始
  if v_last_end is not null and v_last_end >= current_date then
    v_start := v_last_end + 1;
  else
    v_start := current_date;
  end if;
  v_new_end := v_start + v_days - 1;

  insert into public.pet_boarding_cards (family_id, member_id, card_type, item_id, start_date, end_date)
  values (v_family_id, p_member_id, coalesce(v_item.name, 'custom'), p_item_id, v_start, v_new_end);

  return query select true, '购买成功，有效期至 ' || v_new_end::text, v_member.star_value - v_cost, v_new_end;
end;
$$;

revoke all on function public.buy_boarding_card(uuid, uuid) from public;
grant execute on function public.buy_boarding_card(uuid, uuid) to anon, authenticated;

-- ============================================================
-- 五、set_boarding_selection：保存托管宠物勾选（不立即填属性）
-- ============================================================
drop function if exists public.board_pets(uuid, uuid[]);

create or replace function public.set_boarding_selection(
  p_member_id uuid,
  p_pet_ids uuid[]
)
returns table(success boolean, message text, selected_count int)
language plpgsql security definer as $$
begin
  -- 先将该用户所有选择置为未选中
  update public.pet_boarding_selection set selected = false, updated_at = now()
    where member_id = p_member_id;

  -- 将传入的宠物设为选中
  if p_pet_ids is not null and array_length(p_pet_ids, 1) > 0 then
    insert into public.pet_boarding_selection (member_id, pet_id, selected)
    select p_member_id, id, true from unnest(p_pet_ids) as id
    on conflict (member_id, pet_id) do update set selected = true, updated_at = now();
  end if;

  return query select true, '托管选择已保存，今晚0点自动养护', coalesce(array_length(p_pet_ids, 1), 0);
end;
$$;

grant execute on function public.set_boarding_selection(uuid, uuid[]) to anon, authenticated;

-- ============================================================
-- 六、get_boarding_status：增加 selected_pet_ids
-- ============================================================
drop function if exists public.get_boarding_status(uuid);

create or replace function public.get_boarding_status(p_member_id uuid)
returns table(
  has_active_card boolean,
  card_end_date date,
  today_boarded_pet_ids uuid[],
  selected_pet_ids uuid[]
)
language plpgsql security definer as $$
declare
  v_card record;
  v_boarded uuid[];
  v_selected uuid[];
  v_today date := (now() at time zone 'Asia/Shanghai')::date;
begin
  select * into v_card from public.pet_boarding_cards pbc
    where pbc.member_id = p_member_id and pbc.end_date >= v_today
    order by pbc.end_date asc limit 1;

  select coalesce(array_agg(pet_id), array[]::uuid[]) into v_boarded
    from public.pet_boarding
    where member_id = p_member_id and board_date = v_today;

  select coalesce(array_agg(pet_id), array[]::uuid[]) into v_selected
    from public.pet_boarding_selection
    where member_id = p_member_id and selected = true;

  return query select
    v_card is not null,
    v_card.end_date,
    v_boarded,
    v_selected;
end;
$$;

grant execute on function public.get_boarding_status(uuid) to anon, authenticated;

-- ============================================================
-- 七、run_daily_boarding_care：每日0点自动养护
--    1星光 = 5属性点；星光不足则跳过（保留托管资格）
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
    -- 今日已执行过托管则跳过（幂等）
    if exists (
      select 1 from public.pet_boarding b
      where b.member_id = v_member.id and b.board_date = v_today
    ) then
      continue;
    end if;

    -- 获取勾选托管的宠物
    select array_agg(pet_id) into v_selected_ids
    from public.pet_boarding_selection
    where member_id = v_member.id and selected = true;

    if v_selected_ids is null or array_length(v_selected_ids, 1) = 0 then
      continue;
    end if;

    -- 计算总属性缺口（排除生病宠物）
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

    -- 星光不足：本次不执行，保留托管资格
    if v_member.star_value < v_stars_needed then
      continue;
    end if;

    -- 扣减星光
    if v_stars_needed > 0 then
      update public.members set star_value = star_value - v_stars_needed, updated_at = now()
      where id = v_member.id;
    end if;

    -- 逐只补齐属性 + 发放每日金币 + 记录托管
    for v_pet in
      select p.*,
             public.pet_is_sick(p.has_stomach_issue, p.has_skin_issue, p.has_severe_illness) as sick
      from public.pets p
      where p.id = any(v_selected_ids)
    loop
      if v_pet.sick then continue; end if;

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

      -- 三项属性全部补满，发放该宠物每日金币
      if v_pet.last_coin_date is null or v_pet.last_coin_date < v_today then
        v_daily_coin := coalesce(v_pet.base_coin_per_day, 0)
          * (1.0 + coalesce(v_pet.upgrade_percent, 10.0) / 100.0 * (coalesce(v_pet.level, 1) - 1));
        update public.pets set
          coin_balance = coalesce(coin_balance, 0) + v_daily_coin,
          last_coin_date = v_today
        where id = v_pet.id;
      end if;

      insert into public.pet_boarding (family_id, member_id, pet_id, board_date)
      values (v_pet.family_id, v_member.id, v_pet.id, v_today)
      on conflict do nothing;
    end loop;
  end loop;
end;
$$;

grant execute on function public.run_daily_boarding_care(uuid) to anon, authenticated;

-- ============================================================
-- 八、pg_cron：北京时间每日0点（UTC 16:00）执行托管养护
-- ============================================================
do $$
begin
  if exists (select 1 from cron.job where jobname = 'daily_boarding_care') then
    perform cron.unschedule('daily_boarding_care');
  end if;
end $$;

select cron.schedule(
  'daily_boarding_care',
  '0 16 * * *',
  $$select public.run_daily_boarding_care();$$
);

-- ============================================================
-- 九、RLS
-- ============================================================
alter table public.pet_boarding_selection enable row level security;
create policy "boarding_selection_select" on public.pet_boarding_selection for select using (true);
create policy "boarding_selection_insert" on public.pet_boarding_selection for insert with check (true);
create policy "boarding_selection_update" on public.pet_boarding_selection for update using (true);

notify pgrst, 'reload schema';
