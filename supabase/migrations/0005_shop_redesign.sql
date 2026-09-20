-- My Planet: 兑换特权板块重构
-- 1. items 表新增 weekly_limit 列（一周兑换数量限制）
-- 2. purchases 表新增 quantity 列 + sold 状态
-- 3. purchase_item RPC 支持数量和周限
-- 4. 新增 sell_purchase RPC（出售返 90% 金币）
-- 5. redeem_purchase 改为由孩子直接兑换

-- 1. items 表：新增 weekly_limit
alter table public.items add column if not exists weekly_limit int;

-- 2. purchases 表：新增 quantity 列
alter table public.purchases add column if not exists quantity int not null default 1;

-- 2b. purchases 表：扩展 status 增加 'sold'
do $$
begin
  if exists (select 1 from information_schema.table_constraints
             where table_name = 'purchases' and constraint_name = 'purchases_status_check') then
    alter table public.purchases drop constraint purchases_status_check;
  end if;
end $$;
alter table public.purchases add constraint purchases_status_check
  check (status in ('pending','redeemed','expired','cancelled','sold'));

-- 3. purchase_item 重写：支持数量 + 周限校验
create or replace function public.purchase_item(p_item_id uuid, p_member_id uuid, p_quantity int default 1)
returns table(purchase_id uuid, code text, new_balance int)
language plpgsql security definer as $$
declare
  v_item public.items%rowtype;
  v_balance int;
  v_family_id uuid;
  v_code text;
  v_purchase_id uuid;
  v_total_cost int;
  v_weekly_count int;
begin
  if p_quantity is null or p_quantity < 1 then
    p_quantity := 1;
  end if;

  -- 锁定商品行
  select * into v_item from public.items where id = p_item_id for update;
  if not found then
    raise exception '商品不存在';
  end if;
  if v_item.status <> 'active' then
    raise exception '商品已下架';
  end if;
  if v_item.expires_at is not null and v_item.expires_at < now() then
    raise exception '商品已过期';
  end if;
  if v_item.stock is not null and v_item.stock < p_quantity then
    raise exception '库存不足';
  end if;

  v_family_id := v_item.family_id;
  v_total_cost := v_item.price * p_quantity;

  -- 周限校验
  if v_item.weekly_limit is not null then
    select coalesce(sum(quantity), 0) into v_weekly_count
    from public.purchases
    where item_id = p_item_id
      and member_id = p_member_id
      and status in ('pending','redeemed')
      and created_at >= now() - interval '7 days';
    if v_weekly_count + p_quantity > v_item.weekly_limit then
      raise exception '本周已达兑换上限（剩余 %）', v_item.weekly_limit - v_weekly_count;
    end if;
  end if;

  -- 锁定成员行并校验余额
  select coin_balance into v_balance from public.members where id = p_member_id for update;
  if not found then
    raise exception '成员不存在';
  end if;
  if v_balance < v_total_cost then
    raise exception '金币不足';
  end if;

  -- 扣币
  v_balance := v_balance - v_total_cost;
  update public.members set coin_balance = v_balance, updated_at = now() where id = p_member_id;

  -- 生成内部码（仅用于唯一约束，不再展示给用户）
  v_code := upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8));

  -- 插入购买记录
  insert into public.purchases (family_id, item_id, item_name_snapshot, member_id, price_paid, quantity, code)
  values (v_family_id, v_item.id, v_item.name, p_member_id, v_item.price, p_quantity, v_code)
  returning id into v_purchase_id;

  -- 扣库存
  if v_item.stock is not null then
    update public.items set stock = stock - p_quantity, updated_at = now() where id = p_item_id;
  end if;

  -- 记流水
  insert into public.coin_records (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by)
  values (v_family_id, p_member_id, -v_total_cost, v_balance,
          '兑换特权: ' || v_item.name || ' x' || p_quantity, 'purchase', 'purchase', v_purchase_id, p_member_id);

  return query select v_purchase_id, v_code, v_balance;
end;
$$;

-- 4. sell_purchase：出售特权卡，返还 90% 金币
create or replace function public.sell_purchase(p_purchase_id uuid, p_member_id uuid)
returns table(new_balance int, refund int)
language plpgsql security definer as $$
declare
  v_p public.purchases%rowtype;
  v_balance int;
  v_refund int;
begin
  select * into v_p from public.purchases where id = p_purchase_id for update;
  if not found then
    raise exception '特权卡不存在';
  end if;
  if v_p.status <> 'pending' then
    raise exception '特权卡已使用或已出售';
  end if;
  if v_p.member_id <> p_member_id then
    raise exception '无权操作';
  end if;

  -- 返还 90%：price_paid * quantity * 9 / 10（整数除法）
  v_refund := v_p.price_paid * v_p.quantity * 9 / 10;

  -- 加币
  select coin_balance into v_balance from public.members where id = p_member_id for update;
  if not found then
    raise exception '成员不存在';
  end if;
  v_balance := v_balance + v_refund;
  update public.members set coin_balance = v_balance, updated_at = now() where id = p_member_id;

  -- 标记出售
  update public.purchases set status = 'sold', redeemed_at = now() where id = p_purchase_id;

  -- 记流水
  insert into public.coin_records (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by)
  values (v_p.family_id, p_member_id, v_refund, v_balance,
          '出售特权: ' || v_p.item_name_snapshot, 'purchase', 'purchase', v_p.id, p_member_id);

  return query select v_balance, v_refund;
end;
$$;

-- 5. redeem_purchase 重写：孩子直接兑换使用
create or replace function public.redeem_purchase(p_purchase_id uuid, p_member_id uuid)
returns void
language plpgsql security definer as $$
declare
  v_p public.purchases%rowtype;
begin
  select * into v_p from public.purchases where id = p_purchase_id for update;
  if not found then
    raise exception '特权卡不存在';
  end if;
  if v_p.status <> 'pending' then
    raise exception '特权卡已使用或已出售';
  end if;
  if v_p.member_id <> p_member_id then
    raise exception '无权操作';
  end if;
  update public.purchases
    set status = 'redeemed', redeemed_by = p_member_id, redeemed_at = now()
    where id = p_purchase_id;
end;
$$;

-- 授权
grant execute on function public.purchase_item(uuid, uuid, int) to anon, authenticated;
grant execute on function public.sell_purchase(uuid, uuid) to anon, authenticated;
grant execute on function public.redeem_purchase(uuid, uuid) to anon, authenticated;
