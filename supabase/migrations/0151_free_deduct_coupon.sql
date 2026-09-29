-- 0151: 免扣积分券功能
-- 1. members 表增加 free_deduct_count 字段（剩余免扣次数）
-- 2. redeem_purchase 使用"免扣积分券"时增加免扣次数
-- 3. purchase_item / buy_doghouse_upgrade / start_lucky_wheel 扣金币时支持免扣

-- ===== 1. 表结构 =====
alter table public.members
  add column if not exists free_deduct_count int not null default 0;

comment on column public.members.free_deduct_count is '免扣积分券剩余次数，每次扣金币时优先消耗';

-- ===== 2. redeem_purchase: 免扣积分券增加 free_deduct_count =====
drop function if exists public.redeem_purchase(uuid, uuid);
create or replace function public.redeem_purchase(
  p_purchase_id uuid,
  p_member_id uuid
)
returns void
language plpgsql security definer as $$
declare
  v_p public.purchases%rowtype;
  v_item public.items%rowtype;
  v_weekly_count int;
  v_week_start timestamptz;
begin
  v_week_start := date_trunc('week', now());

  select * into v_p from public.purchases where id = p_purchase_id for update;
  if not found then raise exception '特权卡不存在'; end if;
  if v_p.status <> 'pending' then raise exception '特权卡已使用或已出售'; end if;
  if v_p.member_id <> p_member_id then raise exception '无权操作'; end if;

  select * into v_item from public.items where id = v_p.item_id;

  -- 周使用上限校验
  if v_item.weekly_limit is not null and v_item.weekly_limit > 0 then
    select count(*) into v_weekly_count
      from public.purchase_usage_records
      where member_id = p_member_id
        and item_id = v_p.item_id
        and used_at >= v_week_start;

    if v_weekly_count >= v_item.weekly_limit then
      raise exception '本周该特权卡已达到使用上限（%s次），请下周再使用', v_item.weekly_limit;
    end if;
  end if;

  -- 免扣积分券：增加免扣次数
  if v_item.name = '免抠积分券' then
    update public.members set free_deduct_count = free_deduct_count + 1 where id = p_member_id;
  end if;

  -- 执行使用
  if v_p.quantity > 1 then
    update public.purchases set quantity = quantity - 1 where id = p_purchase_id;
  else
    update public.purchases
      set status = 'redeemed', redeemed_by = p_member_id, redeemed_at = now()
      where id = p_purchase_id;
  end if;

  insert into public.purchase_usage_records (family_id, member_id, purchase_id, item_id, item_name)
  values (v_p.family_id, p_member_id, p_purchase_id, v_p.item_id, v_p.item_name_snapshot);
end;
$$;
grant execute on function public.redeem_purchase(uuid, uuid) to anon, authenticated;

-- ===== 3. purchase_item: 扣金币时支持免扣 =====
drop function if exists public.purchase_item(uuid, uuid, int);
create or replace function public.purchase_item(
  p_item_id uuid,
  p_member_id uuid,
  p_quantity int
)
returns table(purchase_id uuid, code text, new_balance numeric)
language plpgsql security definer as $$
declare
  v_item public.items%rowtype;
  v_member public.members%rowtype;
  v_total numeric;
  v_purchase_id uuid;
  v_code text;
  v_actual_cost numeric;
  v_used_free int := 0;
begin
  if p_quantity is null or p_quantity < 1 then
    p_quantity := 1;
  end if;

  select * into v_item from public.items where id = p_item_id and status = 'active';
  if not found then raise exception '商品不存在或已下架'; end if;

  if v_item.stock is not null then
    if v_item.stock < p_quantity then raise exception '库存不足'; end if;
    update public.items set stock = stock - p_quantity where id = p_item_id;
  end if;

  v_total := v_item.price * p_quantity;

  select * into v_member from public.members where id = p_member_id for update;
  if not found then raise exception '成员不存在'; end if;

  -- 免扣逻辑：有免扣次数则本次免扣
  if v_member.free_deduct_count > 0 then
    v_used_free := 1;
    v_actual_cost := 0;
    update public.members set free_deduct_count = free_deduct_count - 1 where id = p_member_id;
  else
    v_actual_cost := v_total;
    if v_member.coin_balance < v_actual_cost then
      raise exception '金币不足（需 %，有 %）', v_actual_cost, v_member.coin_balance;
    end if;
    update public.members
      set coin_balance = coin_balance - v_actual_cost, updated_at = now()
      where id = p_member_id;
  end if;

  v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into public.purchases (family_id, item_id, item_name_snapshot, member_id, price_paid, quantity, code, status)
  values (v_member.family_id, p_item_id, v_item.name, p_member_id, v_item.price, p_quantity, v_code, 'pending')
  returning id into v_purchase_id;

  insert into public.coin_records (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by, balance_type)
  values (v_member.family_id, p_member_id, -v_actual_cost, v_member.coin_balance - v_actual_cost,
    case when v_used_free = 1 then '兑换特权（免扣积分券）：' || v_item.name
         else '兑换特权：' || v_item.name end,
    'shop', 'purchase', v_purchase_id, p_member_id, 'coin');

  return query select v_purchase_id, v_code, v_member.coin_balance - v_actual_cost;
end;
$$;
grant execute on function public.purchase_item(uuid, uuid, int) to anon, authenticated;

-- ===== 4. buy_doghouse_upgrade: 扣金币时支持免扣 =====
drop function if exists public.buy_doghouse_upgrade(uuid, uuid);
create or replace function public.buy_doghouse_upgrade(
  p_member_id uuid,
  p_item_id uuid
)
returns table(success boolean, message text, new_level int, new_capacity int, new_star int, new_coin int)
language plpgsql security definer as $$
declare
  v_member public.members%rowtype;
  v_item public.pet_shop_items%rowtype;
  v_star int;
  v_coin int;
  v_need_star int;
  v_need_coin int;
  v_current_level int := 0;
  v_target_level int;
  v_new_capacity int;
  v_family_id uuid;
  v_used_free int := 0;
begin
  select * into v_member from public.members where id = p_member_id for update;
  if not found then
    return query select false, '会员不存在', 0, 0, 0, 0;
    return;
  end if;
  v_family_id := v_member.family_id;

  select * into v_item from public.pet_shop_items where id = p_item_id for update;
  if not found then
    return query select false, '商品不存在', 0, 0, 0, 0;
    return;
  end if;

  if v_item.type <> 'supply' or v_item.subcategory <> 'doghouse' then
    return query select false, '该商品不是狗屋', 0, 0, 0, 0;
    return;
  end if;
  if v_item.status <> 'active' then
    return query select false, '商品已下架', 0, 0, 0, 0;
    return;
  end if;

  if v_item.doghouse_level is null or v_item.doghouse_level = 0 then
    return query select false, '该狗屋未配置等级，请在后台编辑商品设置等级', 0, 0, v_member.star_value, v_member.coin_balance;
    return;
  end if;

  if v_item.stock is not null and v_item.stock <= 0 then
    return query select false, '已售罄', 0, 0, 0, 0;
    return;
  end if;

  select level into v_current_level from public.dog_house where member_id = p_member_id;
  if not found then v_current_level := 0; end if;

  v_target_level := v_item.doghouse_level;

  if v_target_level <= v_current_level then
    return query select false, '已拥有该级别或更高狗屋', v_current_level, 0, v_member.star_value, v_member.coin_balance;
    return;
  elsif v_target_level <> v_current_level + 1 then
    return query select false, '请先购买上一级狗屋', v_current_level, 0, v_member.star_value, v_member.coin_balance;
    return;
  end if;

  v_need_star := v_item.price_star;
  v_need_coin := v_item.price_coin;
  v_star := v_member.star_value;
  v_coin := v_member.coin_balance;

  if v_need_star > 0 and v_star < v_need_star then
    return query select false, '星光值不足', v_current_level, 0, v_star, v_coin;
    return;
  end if;

  -- 免扣逻辑：有免扣次数则金币部分免扣
  if v_need_coin > 0 and v_member.free_deduct_count > 0 then
    v_used_free := 1;
    update public.members set free_deduct_count = free_deduct_count - 1 where id = p_member_id;
  else
    if v_need_coin > 0 and v_coin < v_need_coin then
      return query select false, '金币不足', v_current_level, 0, v_star, v_coin;
      return;
    end if;
  end if;

  if v_need_star > 0 then
    update public.members set star_value = star_value - v_need_star where id = p_member_id;
    v_star := v_star - v_need_star;
  end if;
  if v_need_coin > 0 and v_used_free = 0 then
    update public.members set coin_balance = coin_balance - v_need_coin where id = p_member_id;
    v_coin := v_coin - v_need_coin;
  end if;

  v_new_capacity := case v_target_level
    when 1 then 1
    when 2 then 5
    when 3 then 10
    else 0
  end;

  insert into public.dog_house (member_id, family_id, level, capacity, upgrade_cost)
  values (p_member_id, v_family_id, v_target_level, v_new_capacity, 0)
  on conflict (member_id) do update
  set level = v_target_level, capacity = v_new_capacity, updated_at = now();

  -- 金币流水
  if v_need_coin > 0 then
    insert into public.coin_records (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by, balance_type)
    values (v_family_id, p_member_id,
      case when v_used_free = 1 then 0 else -v_need_coin end,
      v_coin,
      case when v_used_free = 1 then '升级狗屋（免扣积分券）' else '升级狗屋' end,
      'purchase', 'pet_shop_item', p_item_id, p_member_id, 'coin');
  end if;

  return query select true,
    case when v_used_free = 1 then '狗屋升级成功（使用免扣积分券）' else '狗屋升级成功' end,
    v_target_level, v_new_capacity, v_star, v_coin;
end;
$$;
grant execute on function public.buy_doghouse_upgrade(uuid, uuid) to anon, authenticated;

-- ===== 5. start_lucky_wheel: 扣金币时支持免扣 =====
drop function if exists public.start_lucky_wheel(uuid, text, text);
create or replace function public.start_lucky_wheel(
  p_member_id uuid,
  p_open_method text,
  p_wish_reward_key text default null
)
returns table(session_id uuid, remaining_spins int, message text)
language plpgsql security definer as $$
declare
  v_member public.members%rowtype;
  v_family_id uuid;
  v_coin_cost int := 20;
  v_today date;
  v_today_paid_count int;
  v_ticket_purchase public.purchases%rowtype;
  v_existing public.lucky_wheel_sessions%rowtype;
  v_wish_valid boolean := false;
  v_used_free int := 0;
  v_pool record;
begin
  select * into v_member from public.members where id = p_member_id for update;
  if not found then raise exception '用户不存在'; end if;
  v_family_id := v_member.family_id;

  select * into v_existing from public.lucky_wheel_sessions
  where member_id = p_member_id and status = 'active';
  if found then
    return query select v_existing.id, v_existing.remaining_spins, '已有进行中的转盘';
    return;
  end if;

  if p_open_method = 'coin' then
    v_today := (now() at time zone 'Asia/Shanghai')::date;
    select count(*) into v_today_paid_count from public.lucky_wheel_sessions
    where member_id = p_member_id and open_method = 'coin'
      and (created_at at time zone 'Asia/Shanghai')::date = v_today;
    if v_today_paid_count >= 1 then
      return query select null::uuid, 0, '今日付费抽奖次数已用完，可以使用背包内的幸运大转盘券继续抽奖';
      return;
    end if;

    -- 免扣逻辑：有免扣次数则本次免扣
    if v_member.free_deduct_count > 0 then
      v_used_free := 1;
      update public.members set free_deduct_count = free_deduct_count - 1 where id = p_member_id;
    else
      if v_member.coin_balance < v_coin_cost then
        return query select null::uuid, 0, '金币不足，无法开启转盘';
        return;
      end if;
      update public.members set coin_balance = coin_balance - v_coin_cost, updated_at = now() where id = p_member_id;

      insert into public.coin_records (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by, balance_type)
      values (v_family_id, p_member_id, -v_coin_cost, v_member.coin_balance - v_coin_cost,
        '幸运大转盘开启', 'lucky_wheel', 'lucky_wheel_session', null, p_member_id, 'coin');
    end if;
  elsif p_open_method = 'ticket' then
    select * into v_ticket_purchase from public.purchases
    where member_id = p_member_id and status = 'pending'
      and item_name_snapshot = '幸运大转盘'
    order by created_at limit 1 for update;
    if not found then
      return query select null::uuid, 0, '背包中没有幸运大转盘券';
      return;
    end if;
    if v_ticket_purchase.quantity > 1 then
      update public.purchases set quantity = quantity - 1 where id = v_ticket_purchase.id;
    else
      update public.purchases set status = 'redeemed', redeemed_by = p_member_id, redeemed_at = now() where id = v_ticket_purchase.id;
    end if;
  else
    raise exception '无效的开启方式';
  end if;

  -- 许愿校验
  if p_wish_reward_key is not null then
    for v_pool in select reward_key from public.get_lucky_wheel_pool(v_family_id) loop
      if v_pool.reward_key = p_wish_reward_key then
        v_wish_valid := true;
        exit;
      end if;
    end loop;
    if not v_wish_valid then
      return query select null::uuid, 0, '许愿奖励不存在于奖池中';
      return;
    end if;
  end if;

  insert into public.lucky_wheel_sessions (family_id, member_id, open_method, coin_cost, wish_reward_key, remaining_spins)
  values (v_family_id, p_member_id, p_open_method,
    case when p_open_method = 'coin' and v_used_free = 0 then v_coin_cost else 0 end,
    p_wish_reward_key, 3);

  return query select currval(pg_get_serial_sequence('public.lucky_wheel_sessions','id'))::uuid, 3,
    case when v_used_free = 1 then '转盘已开启（使用免扣积分券）' else '转盘已开启' end;
end;
$$;
grant execute on function public.start_lucky_wheel(uuid, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
