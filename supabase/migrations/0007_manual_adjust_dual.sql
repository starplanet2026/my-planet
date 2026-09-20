-- 0007: 手动加减分支持双货币（金币/星光值）
-- 重写 manual_adjust_coins RPC，新增 p_balance_type 参数（'coin' 或 'star'）
-- 前置条件：0006_star_currency.sql 已执行（star_value 列和 balance_type 列已存在）

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

  -- 锁定成员行
  if v_bal_type = 'star' then
    select star_value into v_balance from public.members where id = p_member_id for update;
  else
    select coin_balance into v_balance from public.members where id = p_member_id for update;
  end if;

  if not found then
    raise exception '成员不存在';
  end if;

  v_balance := v_balance + p_amount;
  if v_balance < 0 then
    raise exception '调整后余额不能为负';
  end if;

  -- 更新对应余额
  if v_bal_type = 'star' then
    update public.members set star_value = v_balance, updated_at = now() where id = p_member_id;
  else
    update public.members set coin_balance = v_balance, updated_at = now() where id = p_member_id;
  end if;

  -- 记流水
  insert into public.coin_records (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by, balance_type)
  values (p_family_id, p_member_id, p_amount, v_balance,
          '家长调整: ' || coalesce(p_reason, '无说明'),
          'manual', 'manual', p_created_by, p_created_by, v_bal_type);

  return query select v_balance, v_bal_type;
end;
$$;

-- 授权
grant execute on function public.manual_adjust_coins(uuid, uuid, int, text, uuid, text) to anon, authenticated;
