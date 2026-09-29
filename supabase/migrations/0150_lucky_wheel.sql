-- ============================================================
-- 0150: 幸运大转盘功能
-- ============================================================

-- 1. 扩展 coin_records.category 允许 'lucky_wheel'
alter table public.coin_records drop constraint if exists coin_records_category_check;
alter table public.coin_records add constraint coin_records_category_check
  check (category in ('task','purchase','manual','system','task_reject','manual_adjust','challenge','shop','boarding','evolve','study','upgrade','dictation','recitation','lucky_wheel')) not valid;

-- 2. 奖池权重配置表
create table if not exists public.lucky_wheel_weights (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  reward_key text not null,
  weight int not null default 10 check (weight >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(family_id, reward_key)
);
create index if not exists idx_lww_family on public.lucky_wheel_weights(family_id);

-- 3. 转盘会话表（一轮）
create table if not exists public.lucky_wheel_sessions (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  pay_type text not null check (pay_type in ('coin','ticket')),
  wish_reward_key text,
  remaining_spins int not null default 3 check (remaining_spins >= 0 and remaining_spins <= 3),
  status text not null default 'active' check (status in ('active','completed')),
  coin_refunded boolean not null default false,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists idx_lws_member on public.lucky_wheel_sessions(member_id, created_at desc);

-- 4. 单次抽取记录表
create table if not exists public.lucky_wheel_spins (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.lucky_wheel_sessions(id) on delete cascade,
  spin_index int not null check (spin_index >= 0 and spin_index <= 2),
  reward_type text not null check (reward_type in ('item','star')),
  reward_key text not null,
  reward_name text not null,
  is_claimed boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_lws_session on public.lucky_wheel_spins(session_id, spin_index);

-- 5. RLS
alter table public.lucky_wheel_weights enable row level security;
alter table public.lucky_wheel_sessions enable row level security;
alter table public.lucky_wheel_spins enable row level security;

create policy "family read weights" on public.lucky_wheel_weights for select
  using (exists (select 1 from public.families f where f.id = lucky_wheel_weights.family_id));
create policy "family write weights" on public.lucky_wheel_weights for all
  using (exists (select 1 from public.families f where f.id = lucky_wheel_weights.family_id));

create policy "member read own sessions" on public.lucky_wheel_sessions for select
  using (exists (select 1 from public.members m where m.id = lucky_wheel_sessions.member_id));
create policy "member write own sessions" on public.lucky_wheel_sessions for all
  using (exists (select 1 from public.members m where m.id = lucky_wheel_sessions.member_id));

create policy "member read own spins" on public.lucky_wheel_spins for select
  using (exists (
    select 1 from public.lucky_wheel_sessions s
    join public.members m on m.id = s.member_id
    where s.id = lucky_wheel_spins.session_id
  ));

-- ============================================================
-- RPC 函数
-- ============================================================

-- 6. 初始化奖池权重（upsert，不覆盖已有配置）
create or replace function public.init_lucky_wheel_weights(p_family_id uuid)
returns void language plpgsql security definer as $$
declare
  v_item record;
  v_star_key text := 'star_500';
  v_rare_items record;
begin
  -- 普通特权卡：active 且 category != '稀有'（items 已全局化，无 family_id）
  for v_item in
    select id, name from public.items
    where status = 'active'
      and (category is null or category <> '稀有')
  loop
    insert into public.lucky_wheel_weights (family_id, reward_key, weight)
    values (p_family_id, v_item.id::text, 10)
    on conflict (family_id, reward_key) do nothing;
  end loop;

  -- 五百星光值
  insert into public.lucky_wheel_weights (family_id, reward_key, weight)
  values (p_family_id, v_star_key, 5)
  on conflict (family_id, reward_key) do nothing;

  -- 3 张稀有卡
  for v_rare_items in
    select id, name from public.items
    where status = 'active' and category = '稀有'
      and name in ('免抠积分券', '积分膨胀券', '幸运大转盘')
  loop
    insert into public.lucky_wheel_weights (family_id, reward_key, weight)
    values (p_family_id, v_rare_items.id::text,
      case v_rare_items.name
        when '幸运大转盘' then 2
        else 3
      end)
    on conflict (family_id, reward_key) do nothing;
  end loop;
end;
$$;
grant execute on function public.init_lucky_wheel_weights(uuid) to anon, authenticated;

-- 7. 获取完整奖池列表
create or replace function public.get_lucky_wheel_pool(p_family_id uuid)
returns table(
  reward_key text,
  reward_type text,
  name text,
  description text,
  image_url text,
  weight int
) language plpgsql security definer as $$
begin
  -- 确保权重已初始化
  perform public.init_lucky_wheel_weights(p_family_id);

  return query
  -- 普通特权卡 + 稀有卡（来自 items）
  select
    i.id::text as reward_key,
    'item'::text as reward_type,
    i.name,
    i.description,
    i.image_url,
    coalesce(w.weight, 10) as weight
  from public.items i
  left join public.lucky_wheel_weights w
    on w.family_id = p_family_id and w.reward_key = i.id::text
  where i.status = 'active'
    and (i.category is null or i.category <> '稀有'
         or i.name in ('免抠积分券', '积分膨胀券', '幸运大转盘'))
  union all
  -- 五百星光值
  select
    'star_500'::text as reward_key,
    'star'::text as reward_type,
    '五百星光值'::text as name,
    '直接获得500星光值'::text as description,
    null::text as image_url,
    coalesce((select lww.weight from public.lucky_wheel_weights lww where lww.family_id = p_family_id and lww.reward_key = 'star_500'), 5) as weight;
end;
$$;
grant execute on function public.get_lucky_wheel_pool(uuid) to anon, authenticated;

-- 8. 更新权重（批量）
create or replace function public.update_lucky_wheel_weights(
  p_family_id uuid,
  p_configs jsonb
) returns void language plpgsql security definer as $$
declare
  v_cfg record;
begin
  for v_cfg in
    select * from jsonb_to_recordset(p_configs) as x(reward_key text, weight int)
  loop
    insert into public.lucky_wheel_weights (family_id, reward_key, weight, updated_at)
    values (p_family_id, v_cfg.reward_key, greatest(0, v_cfg.weight), now())
    on conflict (family_id, reward_key) do update
      set weight = excluded.weight, updated_at = now();
  end loop;
end;
$$;
grant execute on function public.update_lucky_wheel_weights(uuid, jsonb) to anon, authenticated;

-- 9. 开启一轮转盘
create or replace function public.start_lucky_wheel(
  p_member_id uuid,
  p_pay_type text,
  p_wish_reward_key text default null
)
returns table(session_id uuid, remaining_spins int, message text)
language plpgsql security definer as $$
declare
  v_member public.members%rowtype;
  v_family_id uuid;
  v_today_count int;
  v_ticket_id uuid;
  v_session_id uuid;
  v_coin_cost int := 20;
begin
  select * into v_member from public.members where id = p_member_id for update;
  if not found then
    return query select null::uuid, 0, '成员不存在'::text;
    return;
  end if;
  v_family_id := v_member.family_id;

  if p_pay_type = 'coin' then
    -- 每日付费次数限制
    select count(*) into v_today_count from public.lucky_wheel_sessions
    where member_id = p_member_id and pay_type = 'coin'
      and created_at >= date_trunc('day', now());
    if v_today_count >= 1 then
      return query select null::uuid, 0, '今日付费抽奖次数已用完，可以使用背包内的幸运大转盘券继续抽奖'::text;
      return;
    end if;
    -- 金币校验
    if v_member.coin_balance < v_coin_cost then
      return query select null::uuid, 0, '金币不足，无法开启转盘'::text;
      return;
    end if;
    -- 扣金币
    update public.members set coin_balance = coin_balance - v_coin_cost, updated_at = now() where id = p_member_id;
    insert into public.coin_records (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by, balance_type)
    values (v_family_id, p_member_id, -v_coin_cost, v_member.coin_balance - v_coin_cost,
      '幸运大转盘: 开启转盘', 'lucky_wheel', 'lucky_wheel_session', null, p_member_id, 'coin');
  elsif p_pay_type = 'ticket' then
    -- 校验背包有幸运大转盘券
    select p.id into v_ticket_id from public.purchases p
    join public.items i on i.id = p.item_id
    where p.member_id = p_member_id and p.status = 'pending' and i.name = '幸运大转盘'
    order by p.created_at limit 1;
    if v_ticket_id is null then
      return query select null::uuid, 0, '背包内没有幸运大转盘券'::text;
      return;
    end if;
    -- 扣券
    update public.purchases set status = 'redeemed', redeemed_by = p_member_id, redeemed_at = now() where id = v_ticket_id;
  else
    return query select null::uuid, 0, '无效的支付方式'::text;
    return;
  end if;

  -- 创建 session
  insert into public.lucky_wheel_sessions (family_id, member_id, pay_type, wish_reward_key, remaining_spins)
  values (v_family_id, p_member_id, p_pay_type, p_wish_reward_key, 3)
  returning id into v_session_id;

  return query select v_session_id, 3, 'ok'::text;
end;
$$;
grant execute on function public.start_lucky_wheel(uuid, text, text) to anon, authenticated;

-- 10. 单次抽取
create or replace function public.spin_lucky_wheel(p_session_id uuid)
returns table(reward_type text, reward_key text, reward_name text, remaining_spins int, message text)
language plpgsql security definer as $$
declare
  v_session public.lucky_wheel_sessions%rowtype;
  v_family_id uuid;
  v_total_weight numeric;
  v_rand numeric;
  v_cum numeric := 0;
  v_reward record;
  v_spin_index int;
  v_reward_type text;
  v_reward_key text;
  v_reward_name text;
begin
  select * into v_session from public.lucky_wheel_sessions where id = p_session_id for update;
  if not found then
    return query select null::text, null::text, null::text, 0, '转盘会话不存在'::text;
    return;
  end if;
  if v_session.status <> 'active' then
    return query select null::text, null::text, null::text, 0, '本轮已结束'::text;
    return;
  end if;
  if v_session.remaining_spins <= 0 then
    return query select null::text, null::text, null::text, 0, '抽取次数已用完'::text;
    return;
  end if;

  v_family_id := v_session.family_id;

  -- 计算总权重
  select coalesce(sum(weight), 0) into v_total_weight
  from public.lucky_wheel_weights where family_id = v_family_id and weight > 0;

  if v_total_weight = 0 then
    return query select null::text, null::text, null::text, v_session.remaining_spins, '奖池为空'::text;
    return;
  end if;

  -- 随机抽取
  v_rand := random() * v_total_weight;
  for v_reward in
    select w.reward_key, w.weight,
      case when w.reward_key = 'star_500' then 'star' else 'item' end as rtype,
      case when w.reward_key = 'star_500' then '五百星光值'
           else (select name from public.items where id::text = w.reward_key) end as rname
    from public.lucky_wheel_weights w
    where w.family_id = v_family_id and w.weight > 0
    order by w.reward_key
  loop
    v_cum := v_cum + v_reward.weight;
    if v_rand < v_cum then
      v_reward_type := v_reward.rtype;
      v_reward_key := v_reward.reward_key;
      v_reward_name := v_reward.rname;
      exit;
    end if;
  end loop;

  -- 计算 spin_index
  select coalesce(max(spin_index), -1) + 1 into v_spin_index
  from public.lucky_wheel_spins where session_id = p_session_id;

  -- 写入抽取记录
  insert into public.lucky_wheel_spins (session_id, spin_index, reward_type, reward_key, reward_name)
  values (p_session_id, v_spin_index, v_reward_type, v_reward_key, v_reward_name);

  -- 扣减次数
  update public.lucky_wheel_sessions lws
    set remaining_spins = lws.remaining_spins - 1
    where lws.id = p_session_id;

  return query select v_reward_type, v_reward_key, v_reward_name, v_session.remaining_spins - 1, 'ok'::text;
end;
$$;
grant execute on function public.spin_lucky_wheel(uuid) to anon, authenticated;

-- 11. 领取奖励
create or replace function public.claim_lucky_wheel_reward(p_session_id uuid)
returns table(
  reward_type text, reward_key text, reward_name text,
  wish_hit boolean, coin_refunded boolean, message text
) language plpgsql security definer as $$
declare
  v_session public.lucky_wheel_sessions%rowtype;
  v_spin public.lucky_wheel_spins%rowtype;
  v_member public.members%rowtype;
  v_family_id uuid;
  v_item public.items%rowtype;
  v_purchase_id uuid;
  v_code text;
  v_new_star int;
  v_new_coin numeric;
  v_wish_hit boolean := false;
  v_coin_refunded boolean := false;
begin
  select * into v_session from public.lucky_wheel_sessions where id = p_session_id for update;
  if not found then
    return query select null::text, null::text, null::text, false, false, '转盘会话不存在'::text;
    return;
  end if;

  v_family_id := v_session.family_id;
  select * into v_member from public.members where id = v_session.member_id;

  -- 获取最后一次抽取结果
  select * into v_spin from public.lucky_wheel_spins
  where session_id = p_session_id
  order by spin_index desc limit 1;

  if not found or v_spin.is_claimed then
    -- 没有抽取记录或已领取，直接结束
    update public.lucky_wheel_sessions set status = 'completed', completed_at = now() where id = p_session_id;
    return query select null::text, null::text, null::text, false, false, '无可领取的奖励'::text;
    return;
  end if;

  -- 发放奖励
  if v_spin.reward_type = 'star' then
    -- 五百星光值
    v_new_star := v_member.star_value + 500;
    update public.members set star_value = v_new_star, updated_at = now() where id = v_session.member_id;
    insert into public.coin_records (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by, balance_type)
    values (v_family_id, v_session.member_id, 500, v_new_star,
      '幸运大转盘: 五百星光值', 'lucky_wheel', 'lucky_wheel_spin', v_spin.id, v_session.member_id, 'star');
  else
    -- 物品类（普通特权卡 / 稀有券）：写入 purchases
    select * into v_item from public.items where id::text = v_spin.reward_key;
    if found then
      v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
      insert into public.purchases (family_id, item_id, item_name_snapshot, member_id, price_paid, quantity, code, status)
      values (v_family_id, v_item.id, v_item.name, v_session.member_id, 0, 1, v_code, 'pending')
      returning id into v_purchase_id;
      insert into public.coin_records (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by, balance_type)
      values (v_family_id, v_session.member_id, 0, v_member.coin_balance,
        '幸运大转盘: ' || v_item.name, 'lucky_wheel', 'purchase', v_purchase_id, v_session.member_id, 'coin');
    end if;
  end if;

  -- 许愿判定
  if v_session.wish_reward_key is not null and v_session.wish_reward_key = v_spin.reward_key then
    v_wish_hit := true;
    if v_session.pay_type = 'coin' and not v_session.coin_refunded then
      -- 退还 20 金币
      v_new_coin := v_member.coin_balance + 20;
      update public.members set coin_balance = v_new_coin, updated_at = now() where id = v_session.member_id;
      insert into public.coin_records (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by, balance_type)
      values (v_family_id, v_session.member_id, 20, v_new_coin,
        '幸运大转盘: 许愿成功退还金币', 'lucky_wheel', 'lucky_wheel_session', p_session_id, v_session.member_id, 'coin');
      update public.lucky_wheel_sessions set coin_refunded = true where id = p_session_id;
      v_coin_refunded := true;
    end if;
  end if;

  -- 标记已领取 + session 结束
  update public.lucky_wheel_spins set is_claimed = true where id = v_spin.id;
  update public.lucky_wheel_sessions set status = 'completed', completed_at = now() where id = p_session_id;

  return query select
    v_spin.reward_type, v_spin.reward_key, v_spin.reward_name,
    v_wish_hit, v_coin_refunded, 'ok'::text;
end;
$$;
grant execute on function public.claim_lucky_wheel_reward(uuid) to anon, authenticated;

-- 12. 关闭弹窗兜底（自动发放最后一次结果）
create or replace function public.abandon_lucky_wheel(p_session_id uuid)
returns table(reward_type text, reward_name text, message text)
language plpgsql security definer as $$
declare
  v_session public.lucky_wheel_sessions%rowtype;
  v_spin public.lucky_wheel_spins%rowtype;
  v_claimed record;
begin
  select * into v_session from public.lucky_wheel_sessions where id = p_session_id;
  if not found then
    return query select null::text, null::text, '会话不存在'::text;
    return;
  end if;
  if v_session.status = 'completed' then
    return query select null::text, null::text, '本轮已结束'::text;
    return;
  end if;

  -- 获取最后一次未领取的抽取
  select * into v_spin from public.lucky_wheel_spins
  where session_id = p_session_id and is_claimed = false
  order by spin_index desc limit 1;

  if found then
    -- 复用领取逻辑
    select * into v_claimed from public.claim_lucky_wheel_reward(p_session_id);
    return query select v_claimed.reward_type, v_claimed.reward_name, '已自动发放最后一次抽取结果'::text;
  else
    -- 没有抽取记录，直接结束
    update public.lucky_wheel_sessions set status = 'completed', completed_at = now() where id = p_session_id;
    return query select null::text, null::text, '本轮无抽取结果'::text;
  end if;
end;
$$;
grant execute on function public.abandon_lucky_wheel(uuid) to anon, authenticated;

-- 13. 查询今日付费状态（前端用于提示）
create or replace function public.get_lucky_wheel_daily_status(p_member_id uuid)
returns table(used_coin_today boolean, ticket_count int)
language plpgsql security definer as $$
declare
  v_count int;
  v_tickets int;
begin
  select count(*) into v_count from public.lucky_wheel_sessions
  where member_id = p_member_id and pay_type = 'coin'
    and created_at >= date_trunc('day', now());

  select count(*) into v_tickets from public.purchases p
  join public.items i on i.id = p.item_id
  where p.member_id = p_member_id and p.status = 'pending' and i.name = '幸运大转盘';

  return query select (v_count >= 1), v_tickets;
end;
$$;
grant execute on function public.get_lucky_wheel_daily_status(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
