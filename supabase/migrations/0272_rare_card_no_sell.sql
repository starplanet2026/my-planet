-- 0272: 稀有特权卡禁止出售
-- 场景：稀有卡仅能通过抽奖/发放获得，不可购买也不可在背包出售
-- 实现：sell_purchase RPC 在出售前校验 items.category，若为 '稀有' 则抛异常

drop function if exists public.sell_purchase(uuid, uuid);
drop function if exists public.sell_purchase(uuid, uuid, int);

create or replace function public.sell_purchase(
  p_purchase_id uuid,
  p_member_id uuid,
  p_quantity int default 1
)
returns table(new_balance numeric, refund numeric)
language plpgsql security definer as $$
declare
  v_p public.purchases%rowtype;
  v_member public.members%rowtype;
  v_refund numeric;
  v_sell_qty int;
  v_item_category text;
begin
  if p_quantity is null or p_quantity < 1 then
    p_quantity := 1;
  end if;

  select * into v_p from public.purchases where id = p_purchase_id for update;
  if not found then raise exception '特权卡不存在'; end if;
  if v_p.status <> 'pending' then raise exception '特权卡已使用或已出售'; end if;
  if v_p.member_id <> p_member_id then raise exception '无权操作'; end if;
  if p_quantity > v_p.quantity then raise exception '出售数量超过持有数量'; end if;

  -- 稀有特权卡禁止出售（仅能通过抽奖/发放获得）
  select category into v_item_category from public.items where id = v_p.item_id;
  if v_item_category = '稀有' then
    raise exception '稀有特权卡无法出售';
  end if;

  v_sell_qty := least(p_quantity, v_p.quantity);
  -- 返还金币 = 单张原价 × 出售张数 × 90%，向下取整
  v_refund := floor(v_p.price_paid * v_sell_qty * 0.9);

  -- 扣卡
  if v_sell_qty < v_p.quantity then
    update public.purchases
      set quantity = quantity - v_sell_qty
      where id = p_purchase_id;
  else
    update public.purchases
      set status = 'sold', redeemed_at = now()
      where id = p_purchase_id;
  end if;

  -- 加金币
  select * into v_member from public.members where id = p_member_id for update;
  if not found then raise exception '成员不存在'; end if;

  update public.members
    set coin_balance = coin_balance + v_refund, updated_at = now()
    where id = p_member_id;

  -- 金币记录
  insert into public.coin_records (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by, balance_type)
  values (
    v_p.family_id, p_member_id, v_refund, v_member.coin_balance + v_refund,
    '背包出售特权卡：' || v_p.item_name_snapshot || ' x' || v_sell_qty,
    'shop', 'purchase', v_p.id, p_member_id, 'coin'
  );

  return query select v_member.coin_balance + v_refund, v_refund;
end;
$$;

grant execute on function public.sell_purchase(uuid, uuid, int) to anon, authenticated;
