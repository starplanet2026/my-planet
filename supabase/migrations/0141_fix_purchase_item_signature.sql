-- 0141: 修复 purchase_item 函数
-- 问题1：旧函数签名 (uuid, uuid) 未被删除，迁移 0098/0140 只 drop 了 (uuid, uuid, int)
-- 问题2：coin_balance 是 numeric 类型，但函数声明 new_balance integer，导致类型不匹配
--   报错：structure of query does not match function result type

-- 删除所有旧签名
drop function if exists public.purchase_item(uuid, uuid);
drop function if exists public.purchase_item(uuid, uuid, int);

-- 重建：返回 new_balance 改为 numeric 匹配 coin_balance 实际类型
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
begin
  if p_quantity is null or p_quantity < 1 then
    p_quantity := 1;
  end if;

  select * into v_item from public.items where id = p_item_id and status = 'active';
  if not found then raise exception '商品不存在或已下架'; end if;

  -- 库存检查
  if v_item.stock is not null then
    if v_item.stock < p_quantity then raise exception '库存不足'; end if;
    update public.items set stock = stock - p_quantity where id = p_item_id;
  end if;

  v_total := v_item.price * p_quantity;

  -- 从 members 表获取 family_id（items.family_id 已在 0071 删除）
  select * into v_member from public.members where id = p_member_id for update;
  if not found then raise exception '成员不存在'; end if;
  if v_member.coin_balance < v_total then
    raise exception '金币不足（需 %，有 %）', v_total, v_member.coin_balance;
  end if;

  -- 扣金币
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

grant execute on function public.purchase_item(uuid, uuid, int) to anon, authenticated;

notify pgrst, 'reload schema';
