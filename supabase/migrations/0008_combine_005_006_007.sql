-- ============================================================
-- My Planet: 合并迁移（0005 + 0006 + 0007）
-- 在 Supabase Dashboard → SQL Editor 中粘贴运行即可
-- ============================================================

-- ====== 0005: 兑换特权板块重构 ======

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
drop function if exists public.purchase_item(uuid, uuid, int);
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

  select * into v_item from public.items where id = p_item_id for update;
  if not found then raise exception '商品不存在'; end if;
  if v_item.status <> 'active' then raise exception '商品已下架'; end if;
  if v_item.expires_at is not null and v_item.expires_at < now() then raise exception '商品已过期'; end if;
  if v_item.stock is not null and v_item.stock < p_quantity then raise exception '库存不足'; end if;

  v_family_id := v_item.family_id;
  v_total_cost := v_item.price * p_quantity;

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

  select coin_balance into v_balance from public.members where id = p_member_id for update;
  if not found then raise exception '成员不存在'; end if;
  if v_balance < v_total_cost then raise exception '金币不足'; end if;

  v_balance := v_balance - v_total_cost;
  update public.members set coin_balance = v_balance, updated_at = now() where id = p_member_id;

  v_code := upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8));

  insert into public.purchases (family_id, item_id, item_name_snapshot, member_id, price_paid, quantity, code)
  values (v_family_id, v_item.id, v_item.name, p_member_id, v_item.price, p_quantity, v_code)
  returning id into v_purchase_id;

  if v_item.stock is not null then
    update public.items set stock = stock - p_quantity, updated_at = now() where id = p_item_id;
  end if;

  insert into public.coin_records (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by)
  values (v_family_id, p_member_id, -v_total_cost, v_balance,
          '兑换特权: ' || v_item.name || ' x' || p_quantity, 'purchase', 'purchase', v_purchase_id, p_member_id);

  return query select v_purchase_id, v_code, v_balance;
end;
$$;

-- 4. sell_purchase：出售特权卡，返还 90% 金币
drop function if exists public.sell_purchase(uuid, uuid);
create or replace function public.sell_purchase(p_purchase_id uuid, p_member_id uuid)
returns table(new_balance int, refund int)
language plpgsql security definer as $$
declare
  v_p public.purchases%rowtype;
  v_balance int;
  v_refund int;
begin
  select * into v_p from public.purchases where id = p_purchase_id for update;
  if not found then raise exception '特权卡不存在'; end if;
  if v_p.status <> 'pending' then raise exception '特权卡已使用或已出售'; end if;
  if v_p.member_id <> p_member_id then raise exception '无权操作'; end if;

  v_refund := v_p.price_paid * v_p.quantity * 9 / 10;

  select coin_balance into v_balance from public.members where id = p_member_id for update;
  if not found then raise exception '成员不存在'; end if;
  v_balance := v_balance + v_refund;
  update public.members set coin_balance = v_balance, updated_at = now() where id = p_member_id;

  update public.purchases set status = 'sold', redeemed_at = now() where id = p_purchase_id;

  insert into public.coin_records (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by)
  values (v_p.family_id, p_member_id, v_refund, v_balance,
          '出售特权: ' || v_p.item_name_snapshot, 'purchase', 'purchase', v_p.id, p_member_id);

  return query select v_balance, v_refund;
end;
$$;

-- 5. redeem_purchase 重写：孩子直接兑换使用
drop function if exists public.redeem_purchase(uuid, uuid);
create or replace function public.redeem_purchase(p_purchase_id uuid, p_member_id uuid)
returns void
language plpgsql security definer as $$
declare
  v_p public.purchases%rowtype;
begin
  select * into v_p from public.purchases where id = p_purchase_id for update;
  if not found then raise exception '特权卡不存在'; end if;
  if v_p.status <> 'pending' then raise exception '特权卡已使用或已出售'; end if;
  if v_p.member_id <> p_member_id then raise exception '无权操作'; end if;
  update public.purchases
    set status = 'redeemed', redeemed_by = p_member_id, redeemed_at = now()
    where id = p_purchase_id;
end;
$$;

grant execute on function public.purchase_item(uuid, uuid, int) to anon, authenticated;
grant execute on function public.sell_purchase(uuid, uuid) to anon, authenticated;
grant execute on function public.redeem_purchase(uuid, uuid) to anon, authenticated;


-- ====== 0006: 双货币系统（星光值 + 金币） ======

-- members：新增 star_value
alter table public.members add column if not exists star_value int not null default 0 check (star_value >= 0);

-- coin_records：新增 balance_type
alter table public.coin_records add column if not exists balance_type text not null default 'coin'
  check (balance_type in ('coin','star'));

-- 回填历史流水
update public.coin_records set balance_type = 'coin' where balance_type is null;

-- complete_task 重写：奖励入 star_value
drop function if exists public.complete_task(uuid, uuid);
create or replace function public.complete_task(p_task_id uuid, p_member_id uuid)
returns table(new_balance int, reward int)
language plpgsql security definer as $$
declare
  v_task public.tasks%rowtype;
  v_balance int;
  v_family_id uuid;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then raise exception '任务不存在'; end if;
  if v_task.status <> 'active' then raise exception '任务已不可完成'; end if;
  if v_task.member_id is not null and v_task.member_id <> p_member_id then
    raise exception '此任务不是指派给你的';
  end if;

  v_family_id := v_task.family_id;

  update public.tasks
    set status = 'completed', completed_by = p_member_id, completed_at = now(), updated_at = now()
    where id = p_task_id;

  select star_value into v_balance from public.members where id = p_member_id for update;
  if not found then raise exception '成员不存在'; end if;
  v_balance := v_balance + v_task.reward_coins;
  if v_balance < 0 then raise exception '星光值不足，无法扣减'; end if;
  update public.members set star_value = v_balance, updated_at = now() where id = p_member_id;

  insert into public.coin_records (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by, balance_type)
  values (v_family_id, p_member_id, v_task.reward_coins, v_balance,
          '任务完成: ' || v_task.title, 'task', 'task', v_task.id, p_member_id, 'star');

  return query select v_balance, v_task.reward_coins;
end;
$$;

-- convert_star_to_coin：星光值兑换金币
drop function if exists public.convert_star_to_coin(uuid, int, int);
create or replace function public.convert_star_to_coin(p_member_id uuid, p_star_amount int, p_rate int default 1)
returns table(new_star int, new_coin int)
language plpgsql security definer as $$
declare
  v_star int;
  v_coin int;
  v_family_id uuid;
begin
  if p_star_amount is null or p_star_amount <= 0 then
    raise exception '兑换星光值必须大于 0';
  end if;
  if p_rate is null or p_rate <= 0 then
    p_rate := 1;
  end if;

  select family_id, star_value, coin_balance
  into v_family_id, v_star, v_coin
  from public.members where id = p_member_id for update;
  if not found then raise exception '成员不存在'; end if;
  if v_star < p_star_amount then raise exception '星光值不足'; end if;

  v_star := v_star - p_star_amount;
  v_coin := v_coin + p_star_amount * p_rate;
  update public.members
    set star_value = v_star, coin_balance = v_coin, updated_at = now()
    where id = p_member_id;

  insert into public.coin_records (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by, balance_type)
  values (v_family_id, p_member_id, -p_star_amount, v_star,
          '星光值兑换金币', 'system', 'convert', p_member_id, p_member_id, 'star');
  insert into public.coin_records (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by, balance_type)
  values (v_family_id, p_member_id, p_star_amount * p_rate, v_coin,
          '星光值兑换金币', 'system', 'convert', p_member_id, p_member_id, 'coin');

  return query select v_star, v_coin;
end;
$$;

-- approve_task 重写：奖励入 star_value
drop function if exists public.approve_task(uuid);
create or replace function public.approve_task(p_task_id uuid)
returns table(new_balance int, reward int)
language plpgsql security definer as $$
declare
  v_task public.tasks%rowtype;
  v_balance int;
  v_family_id uuid;
  v_member_id uuid;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then raise exception '任务不存在'; end if;
  if v_task.status <> 'pending_approval' then raise exception '任务不在待确认状态'; end if;
  v_family_id := v_task.family_id;
  v_member_id := v_task.completed_by;
  if v_member_id is null then raise exception '完成任务成员未知'; end if;

  update public.tasks set status = 'draft', updated_at = now() where id = p_task_id;

  select star_value into v_balance from public.members where id = v_member_id for update;
  if not found then raise exception '成员不存在'; end if;
  v_balance := v_balance + v_task.reward_coins;
  if v_balance < 0 then raise exception '星光值不足，无法扣减'; end if;
  update public.members set star_value = v_balance, updated_at = now() where id = v_member_id;

  insert into public.coin_records (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by, balance_type)
  values (v_family_id, v_member_id, v_task.reward_coins, v_balance,
          '任务完成: ' || v_task.title, 'task', 'task', v_task.id, v_member_id, 'star');

  return query select v_balance, v_task.reward_coins;
end;
$$;

grant execute on function public.complete_task(uuid, uuid) to anon, authenticated;
grant execute on function public.approve_task(uuid) to anon, authenticated;
grant execute on function public.convert_star_to_coin(uuid, int, int) to anon, authenticated;


-- ====== 0007: 手动加减分支持双货币 ======

drop function if exists public.manual_adjust_coins(uuid, uuid, int, text, uuid, text);
create or replace function public.manual_adjust_coins(
  p_family_id uuid,
  p_member_id uuid,
  p_amount int,
  p_reason text,
  p_created_by uuid,
  p_balance_type text default 'coin'
)
returns table(new_balance int, balance_type text)
language plpgsql security definer as $$
declare
  v_balance int;
  v_bal_type text := coalesce(p_balance_type, 'coin');
begin
  if v_bal_type not in ('coin', 'star') then
    raise exception 'balance_type 必须是 coin 或 star';
  end if;

  if v_bal_type = 'star' then
    select star_value into v_balance from public.members where id = p_member_id for update;
  else
    select coin_balance into v_balance from public.members where id = p_member_id for update;
  end if;

  if not found then raise exception '成员不存在'; end if;

  v_balance := v_balance + p_amount;
  if v_balance < 0 then raise exception '调整后余额不能为负'; end if;

  if v_bal_type = 'star' then
    update public.members set star_value = v_balance, updated_at = now() where id = p_member_id;
  else
    update public.members set coin_balance = v_balance, updated_at = now() where id = p_member_id;
  end if;

  insert into public.coin_records (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by, balance_type)
  values (p_family_id, p_member_id, p_amount, v_balance,
          '家长调整: ' || coalesce(p_reason, '无说明'),
          'manual', 'manual', p_created_by, p_created_by, v_bal_type);

  return query select v_balance, v_bal_type;
end;
$$;

grant execute on function public.manual_adjust_coins(uuid, uuid, int, text, uuid, text) to anon, authenticated;

-- 完成
select '迁移完成' as result;
