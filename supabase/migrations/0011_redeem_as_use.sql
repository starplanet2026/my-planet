-- ============================================================
-- 0011: 特权卡"使用"逻辑重构
-- 1. purchase_item：去掉每周购买上限检查（购买不限数量）
-- 2. redeem_purchase：加 weekly_limit 检查（每周使用上限，按 item_id 统计）
-- ============================================================

-- 1. purchase_item 重写：去掉 weekly_limit 检查
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
  select * into v_item from public.items where id = p_item_id and status = 'active';
  if not found then raise exception '商品不存在或已下架'; end if;

  -- 库存检查
  if v_item.stock is not null then
    if v_item.stock < p_quantity then raise exception '库存不足'; end if;
    update public.items set stock = stock - p_quantity where id = p_item_id;
  end if;

  v_total := v_item.price * p_quantity;

  select * into v_member from public.members where id = p_member_id for update;
  if v_member.coin_balance < v_total then
    raise exception '金币不足（需 %，有 %）', v_total, v_member.coin_balance;
  end if;

  update public.members set coin_balance = coin_balance - v_total, updated_at = now() where id = p_member_id;

  v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into public.purchases (family_id, item_id, item_name_snapshot, member_id, price_paid, quantity, code, status)
  values (v_member.family_id, p_item_id, v_item.name, p_member_id, v_total, p_quantity, v_code, 'pending')
  returning id into v_purchase_id;

  insert into public.coin_records (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by, balance_type)
  values (v_member.family_id, p_member_id, -v_total, v_member.coin_balance - v_total,
    '购买特权：' || v_item.name, 'shop', 'purchase', v_purchase_id, p_member_id, 'coin');

  return query select v_purchase_id, v_code, v_member.coin_balance - v_total;
end;
$$;

-- 2. redeem_purchase 重写：加 weekly_limit 检查
-- weekly_limit 现在含义为"每周使用上限"
drop function if exists public.redeem_purchase(uuid, uuid);
create or replace function public.redeem_purchase(p_purchase_id uuid, p_member_id uuid)
returns void
language plpgsql security definer as $$
declare
  v_p public.purchases%rowtype;
  v_item public.items%rowtype;
  v_weekly_used int := 0;
begin
  select * into v_p from public.purchases where id = p_purchase_id for update;
  if not found then raise exception '特权卡不存在'; end if;
  if v_p.status <> 'pending' then raise exception '特权卡已使用或已出售'; end if;
  if v_p.member_id <> p_member_id then raise exception '无权操作'; end if;

  -- 检查使用上限
  select * into v_item from public.items where id = v_p.item_id;
  if found and v_item.weekly_limit is not null then
    select coalesce(sum(quantity), 0) into v_weekly_used
    from public.purchases
    where member_id = p_member_id
      and item_id = v_p.item_id
      and status = 'redeemed'
      and redeemed_at >= date_trunc('week', now());

    if v_weekly_used + v_p.quantity > v_item.weekly_limit then
      raise exception '本周使用次数已达上限（上限 %，已用 %）', v_item.weekly_limit, v_weekly_used;
    end if;
  end if;

  update public.purchases
    set status = 'redeemed', redeemed_by = p_member_id, redeemed_at = now()
    where id = p_purchase_id;
end;
$$;

grant execute on function public.purchase_item(uuid, uuid, int) to anon, authenticated;
grant execute on function public.redeem_purchase(uuid, uuid) to anon, authenticated;
