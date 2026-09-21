-- 0069: 萌宠星球 - 宠托师托管系统
-- 1. 创建托管卡商品（日卡/周卡/月卡）
-- 2. pet_boarding_cards 表：托管卡有效期
-- 3. pet_boarding 表：每日托管记录
-- 4. RPC：购买托管卡、开启托管（自动照料）、查询托管状态

-- ============================================================
-- 一、创建托管卡商品（type=supply, subcategory=foster）
-- ============================================================
do $$
declare
  v_family_id uuid;
  v_parent_id uuid;
begin
  select id into v_family_id from public.families order by created_at limit 1;
  if v_family_id is null then return; end if;

  select id into v_parent_id from public.members
    where family_id = v_family_id and role = 'parent' order by created_at limit 1;
  if v_parent_id is null then return; end if;

  -- 托管日卡：1星光，1天
  insert into public.pet_shop_items (family_id, type, subcategory, name, emoji, description, price_star, price_coin, status)
  select v_family_id, 'supply', 'foster', '托管日卡', '📅', '有效期1天，当日可托管任意数量宠物', 1, 0, 'active'
  where not exists (select 1 from public.pet_shop_items where family_id = v_family_id and name = '托管日卡' and subcategory = 'foster');

  -- 托管周卡：6星光，7天
  insert into public.pet_shop_items (family_id, type, subcategory, name, emoji, description, price_star, price_coin, status)
  select v_family_id, 'supply', 'foster', '托管周卡', '📆', '有效期7天，每天可托管任意数量宠物', 6, 0, 'active'
  where not exists (select 1 from public.pet_shop_items where family_id = v_family_id and name = '托管周卡' and subcategory = 'foster');

  -- 托管月卡：25星光，30天
  insert into public.pet_shop_items (family_id, type, subcategory, name, emoji, description, price_star, price_coin, status)
  select v_family_id, 'supply', 'foster', '托管月卡', '🗓️', '有效期30天，每天可托管任意数量宠物', 25, 0, 'active'
  where not exists (select 1 from public.pet_shop_items where family_id = v_family_id and name = '托管月卡' and subcategory = 'foster');
end $$;

-- ============================================================
-- 二、托管卡表（时间有效期）
-- ============================================================
create table if not exists public.pet_boarding_cards (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  card_type text not null check (card_type in ('daily','weekly','monthly')),
  start_date date not null,
  end_date date not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_boarding_cards_member on public.pet_boarding_cards(member_id);

-- ============================================================
-- 三、每日托管记录表
-- ============================================================
create table if not exists public.pet_boarding (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  pet_id uuid not null references public.pets(id) on delete cascade,
  board_date date not null,
  created_at timestamptz not null default now(),
  unique (member_id, pet_id, board_date)
);

create index if not exists idx_pet_boarding_member on public.pet_boarding(member_id, board_date);

-- ============================================================
-- 四、RPC：购买托管卡
-- ============================================================
create or replace function public.buy_boarding_card(
  p_member_id uuid,
  p_card_type text
)
returns table(success boolean, message text, new_star int, end_date date)
language plpgsql security definer as $$
declare
  v_member record;
  v_family_id uuid;
  v_cost int;
  v_days int;
  v_existing_end date;
  v_new_end date;
begin
  select * into v_member from public.members where id = p_member_id for update;
  if not found then
    return query select false, '用户不存在', 0, null::date;
    return;
  end if;
  v_family_id := v_member.family_id;

  if p_card_type = 'daily' then v_cost := 1; v_days := 1;
  elsif p_card_type = 'weekly' then v_cost := 6; v_days := 7;
  elsif p_card_type = 'monthly' then v_cost := 25; v_days := 30;
  else
    return query select false, '未知卡类型', v_member.star_value, null::date;
    return;
  end if;

  if v_member.star_value < v_cost then
    return query select false, '星光值不足', v_member.star_value, null::date;
    return;
  end if;

  -- 扣费
  update public.members set star_value = star_value - v_cost, updated_at = now() where id = p_member_id;

  -- 如果有有效期内的卡，延长；否则新建
  select end_date into v_existing_end from public.pet_boarding_cards
    where member_id = p_member_id and end_date >= current_date
    order by end_date desc limit 1;

  if v_existing_end is not null then
    v_new_end := v_existing_end + v_days;
    update public.pet_boarding_cards set end_date = v_new_end
      where member_id = p_member_id and end_date = v_existing_end;
  else
    v_new_end := current_date + v_days - 1;
    insert into public.pet_boarding_cards (family_id, member_id, card_type, start_date, end_date)
    values (v_family_id, p_member_id, p_card_type, current_date, v_new_end);
  end if;

  return query select true, '购买成功，有效期至 ' || v_new_end::text, v_member.star_value - v_cost, v_new_end;
end;
$$;

grant execute on function public.buy_boarding_card(uuid, text) to anon, authenticated;

-- ============================================================
-- 五、RPC：开启托管（批量）
--    自动完成喂食/清洁/心情填满，获得50经验，发放当日金币
-- ============================================================
create or replace function public.board_pets(
  p_member_id uuid,
  p_pet_ids uuid[]
)
returns table(success boolean, message text, boarded_count int)
language plpgsql security definer as $$
declare
  v_card record;
  v_pet record;
  v_pet_id uuid;
  v_today date := current_date;
  v_count int := 0;
  v_daily_coin numeric;
  v_exp_gain int := 50;
  v_sick boolean;
  v_already boolean;
begin
  -- 校验有效托管卡
  select * into v_card from public.pet_boarding_cards
    where member_id = p_member_id and end_date >= v_today
    order by end_date desc limit 1;
  if not found then
    return query select false, '没有有效的托管卡，请先购买', 0;
    return;
  end if;

  foreach v_pet_id in array p_pet_ids loop
    -- 校验宠物归属
    select * into v_pet from public.pets where id = v_pet_id and member_id = p_member_id for update;
    if not found then continue; end if;

    -- 今日已托管则跳过
    select exists(
      select 1 from public.pet_boarding
      where member_id = p_member_id and pet_id = v_pet_id and board_date = v_today
    ) into v_already;
    if v_already then continue; end if;

    -- 生病宠物不能托管
    v_sick := public.pet_is_sick(v_pet.has_stomach_issue, v_pet.has_skin_issue, v_pet.has_severe_illness);
    if v_sick then continue; end if;

    -- 自动照料：三项填满 + 50经验
    v_pet.hunger := 100;
    v_pet.clean := 100;
    v_pet.happiness := 100;
    v_pet.last_feed_date := v_today;
    v_pet.last_clean_date := v_today;
    v_pet.last_happiness_date := v_today;
    v_pet.last_care_date := v_today;
    v_pet.days_without_feed := 0;
    v_pet.days_without_clean := 0;
    v_pet.days_without_care := 0;
    v_pet.exp := coalesce(v_pet.exp, 0) + v_exp_gain;

    -- 发放当日金币（今日未领过）
    if v_pet.last_coin_date is null or v_pet.last_coin_date < v_today then
      v_daily_coin := coalesce(v_pet.base_coin_per_day, 0)
        * (1.0 + coalesce(v_pet.upgrade_percent, 10.0) / 100.0 * (coalesce(v_pet.level, 1) - 1));
      v_pet.coin_balance := coalesce(v_pet.coin_balance, 0) + v_daily_coin;
      v_pet.last_coin_date := v_today;
    end if;

    update public.pets set
      hunger = v_pet.hunger,
      clean = v_pet.clean,
      happiness = v_pet.happiness,
      exp = v_pet.exp,
      last_feed_date = v_pet.last_feed_date,
      last_clean_date = v_pet.last_clean_date,
      last_happiness_date = v_pet.last_happiness_date,
      last_care_date = v_pet.last_care_date,
      days_without_feed = 0,
      days_without_clean = 0,
      days_without_care = 0,
      coin_balance = v_pet.coin_balance,
      last_coin_date = v_pet.last_coin_date
    where id = v_pet_id;

    -- 记录托管
    insert into public.pet_boarding (family_id, member_id, pet_id, board_date)
    values (v_pet.family_id, p_member_id, v_pet_id, v_today);

    v_count := v_count + 1;
  end loop;

  return query select true, '已托管 ' || v_count || ' 只宠物', v_count;
end;
$$;

grant execute on function public.board_pets(uuid, uuid[]) to anon, authenticated;

-- ============================================================
-- 六、RPC：查询托管状态
-- ============================================================
create or replace function public.get_boarding_status(p_member_id uuid)
returns table(
  has_active_card boolean,
  card_end_date date,
  today_boarded_pet_ids uuid[]
)
language plpgsql security definer as $$
declare
  v_card record;
  v_boarded uuid[];
begin
  select * into v_card from public.pet_boarding_cards
    where member_id = p_member_id and end_date >= current_date
    order by end_date desc limit 1;

  select coalesce(array_agg(pet_id), array[]::uuid[]) into v_boarded
    from public.pet_boarding
    where member_id = p_member_id and board_date = current_date;

  return query select
    v_card is not null,
    v_card.end_date,
    v_boarded;
end;
$$;

grant execute on function public.get_boarding_status(uuid) to anon, authenticated;

-- RLS
alter table public.pet_boarding_cards enable row level security;
alter table public.pet_boarding enable row level security;
create policy "boarding_cards_select" on public.pet_boarding_cards for select using (true);
create policy "boarding_cards_insert" on public.pet_boarding_cards for insert with check (true);
create policy "boarding_cards_update" on public.pet_boarding_cards for update using (true);
create policy "boarding_select" on public.pet_boarding for select using (true);
create policy "boarding_insert" on public.pet_boarding for insert with check (true);
