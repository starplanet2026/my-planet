-- 0126: 资产数据修正——近2天成就领取误发金币→扣除金币、补发星光值
-- 背景：0109 的 approve_task 错误将奖励发到 coin_balance（金币），
--       0125 已修复为 star_value（星光值）。本迁移修正存量错误数据。
-- 逻辑：找到近2天 coin_records 中 category='task' 且 balance_type='coin' 的记录，
--       按用户汇总金额，从 coin_balance 扣除、补入 star_value，并写入修正流水。

DO $$
declare
  v_rec record;
  v_member uuid;
  v_amount int;
  v_new_coin int;
  v_new_star int;
  v_family uuid;
begin
  for v_rec in
    select member_id, sum(amount) as total_amount, max(family_id::text)::uuid as family_id
    from public.coin_records
    where category = 'task'
      and balance_type = 'coin'
      and created_at >= now() - interval '2 days'
    group by member_id
  loop
    v_member := v_rec.member_id;
    v_amount := v_rec.total_amount;
    v_family := v_rec.family_id;

    -- 扣回误发的金币，补发应得的星光值
    update public.members
      set coin_balance = coin_balance - v_amount,
          star_value = star_value + v_amount,
          updated_at = now()
      where id = v_member
      returning coin_balance, star_value into v_new_coin, v_new_star;

    -- 修正流水：金币扣减
    insert into public.coin_records (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by, balance_type)
    values (v_family, v_member, -v_amount, v_new_coin,
      '资产修正：成就任务误发金币扣回', 'correction', 'task_correction', null, v_member, 'coin');

    -- 修正流水：星光值补发
    insert into public.coin_records (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by, balance_type)
    values (v_family, v_member, v_amount, v_new_star,
      '资产修正：成就任务星光值补发', 'correction', 'task_correction', null, v_member, 'star');
  end loop;
end;
$$;
