-- 0098: Fix privilege purchase & redeem
-- 1. purchase_item: use v_member.family_id (items.family_id was dropped in 0071)
-- 2. redeem_purchase: use ONE card per click (decrement quantity, not all at once)

-- ============================================================
-- 1. purchase_item: fix v_item.family_id -> v_member.family_id
-- ============================================================
drop function if exists public.purchase_item(uuid, uuid, int);
create or replace function public.purchase_item(
  p_item_id uuid,
  p_member_id uuid,
  p_quantity int
)
returns table(purchase_id uuid, code text, new_balance int)
language plpgsql security definer as $$
declare
  v_item public.items%rowtype;
  v_member public.members%rowtype;
  v_total int;
  v_purchase_id uuid;
  v_code text;
begin
  if p_quantity is null or p_quantity < 1 then
    p_quantity := 1;
  end if;

  select * into v_item from public.items where id = p_item_id and status = 'active';
  if not found then raise exception '商品不存在或已下架'; end if;

  -- Stock check
  if v_item.stock is not null then
    if v_item.stock < p_quantity then raise exception '库存不足'; end if;
    update public.items set stock = stock - p_quantity where id = p_item_id;
  end if;

  v_total := v_item.price * p_quantity;

  -- Lock member row and get family_id from member (items.family_id was dropped in 0071)
  select * into v_member from public.members where id = p_member_id for update;
  if not found then raise exception '成员不存在'; end if
  if v_member.coin_balance < v_total then
    raise exception '金币不足（需 %，有 %）', v_total, v_member.coin_balance;
  end if;

  -- Deduct coins
  update public.members
    set coin_balance = coin_balance - v_total, updated_at = now()
    where id = p_member_id;

  v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into public.purchases (family_id, item_id, item_name_snapshot, member_id, price_paid, quantity, code, status)
  values (v_member.family_id, p_item_id, v_item.name, p_member_id, v_item.price, p_quantity, v_code, 'pending')
  returning id into v_purchase_id;

  insert into public.coin_records (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by, balance_type)
  values (v_member.family_id, p_member_id, -v_total, v_member.coin_balance - v_total,
    '兑换特权：' || v_item.name, 'shop', 'purchase', v_purchase_id, p_member_id, 'coin');

  return query select v_purchase_id, v_code, v_member.coin_balance - v_total;
end;
$$;

-- ============================================================
-- 2. redeem_purchase: use ONE card per click
--    - quantity > 1: decrement quantity by 1, keep status 'pending'
--    - quantity = 1: set status 'redeemed'
-- ============================================================
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

  if v_p.quantity > 1 then
    -- Use one card: decrement quantity, keep pending
    update public.purchases
      set quantity = quantity - 1
      where id = p_purchase_id;
  else
    -- Last card: mark as redeemed
    update public.purchases
      set status = 'redeemed', redeemed_by = p_member_id, redeemed_at = now()
      where id = p_purchase_id;
  end if;
end;
$$;

grant execute on function public.purchase_item(uuid, uuid, int) to anon, authenticated;
grant execute on function public.redeem_purchase(uuid, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
