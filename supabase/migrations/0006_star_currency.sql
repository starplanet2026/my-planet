-- My Planet: 双货币系统（星光值 + 金币）
-- 1. members 新增 star_value（星光值，任务奖励）和 avatar_image_url（自定义头像）
-- 2. coin_records 新增 balance_type 区分流水对应的余额（coin/star）
-- 3. complete_task RPC 改为加 star_value 而非 coin_balance
-- 4. 新增 convert_star_to_coin RPC：星光值兑换金币（农场用，预留）
-- 5. 历史金币流水回填 balance_type='coin'

-- 1. members：新增 star_value
alter table public.members add column if not exists star_value int not null default 0 check (star_value >= 0);

-- 2. coin_records：新增 balance_type
alter table public.coin_records add column if not exists balance_type text not null default 'coin'
  check (balance_type in ('coin','star'));

-- 2b. 回填历史流水（默认全部 coin）
update public.coin_records set balance_type = 'coin' where balance_type is null;

-- 3. complete_task 重写：奖励入 star_value
create or replace function public.complete_task(p_task_id uuid, p_member_id uuid)
returns table(new_balance int, reward int)
language plpgsql security definer as $$
declare
  v_task public.tasks%rowtype;
  v_balance int;
  v_family_id uuid;
begin
  -- 锁定任务行
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise exception '任务不存在';
  end if;
  if v_task.status <> 'active' then
    raise exception '任务已不可完成';
  end if;
  if v_task.member_id is not null and v_task.member_id <> p_member_id then
    raise exception '此任务不是指派给你的';
  end if;

  v_family_id := v_task.family_id;

  -- 更新任务状态
  update public.tasks
    set status = 'completed', completed_by = p_member_id, completed_at = now(), updated_at = now()
    where id = p_task_id;

  -- 锁定成员行并更新星光值
  select star_value into v_balance from public.members where id = p_member_id for update;
  if not found then
    raise exception '成员不存在';
  end if;
  v_balance := v_balance + v_task.reward_coins;
  if v_balance < 0 then
    raise exception '星光值不足，无法扣减';
  end if;
  update public.members set star_value = v_balance, updated_at = now() where id = p_member_id;

  -- 记流水（balance_type=star）
  insert into public.coin_records (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by, balance_type)
  values (v_family_id, p_member_id, v_task.reward_coins, v_balance,
          '任务完成: ' || v_task.title, 'task', 'task', v_task.id, p_member_id, 'star');

  return query select v_balance, v_task.reward_coins;
end;
$$;

-- 4. convert_star_to_coin：星光值兑换金币（农场板块用）
-- 按 rate 比例将 star_value 转为 coin_balance
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
  if not found then
    raise exception '成员不存在';
  end if;
  if v_star < p_star_amount then
    raise exception '星光值不足';
  end if;

  v_star := v_star - p_star_amount;
  v_coin := v_coin + p_star_amount * p_rate;
  update public.members
    set star_value = v_star, coin_balance = v_coin, updated_at = now()
    where id = p_member_id;

  -- 记流水：星光值扣减
  insert into public.coin_records (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by, balance_type)
  values (v_family_id, p_member_id, -p_star_amount, v_star,
          '星光值兑换金币', 'system', 'convert', p_member_id, p_member_id, 'star');
  -- 记流水：金币增加
  insert into public.coin_records (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by, balance_type)
  values (v_family_id, p_member_id, p_star_amount * p_rate, v_coin,
          '星光值兑换金币', 'system', 'convert', p_member_id, p_member_id, 'coin');

  return query select v_star, v_coin;
end;
$$;

-- 5. approve_task 重写：奖励入 star_value（任务确认流程实际走此 RPC）
-- 任务状态由 pending_approval → draft（待发布），不再回到 completed
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

  -- 改为 draft（待发布），不再是 completed
  update public.tasks set status = 'draft', updated_at = now() where id = p_task_id;

  -- 锁定成员行并更新星光值
  select star_value into v_balance from public.members where id = v_member_id for update;
  if not found then raise exception '成员不存在'; end if;
  v_balance := v_balance + v_task.reward_coins;
  if v_balance < 0 then raise exception '星光值不足，无法扣减'; end if;
  update public.members set star_value = v_balance, updated_at = now() where id = v_member_id;

  -- 记流水（balance_type=star）
  insert into public.coin_records (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by, balance_type)
  values (v_family_id, v_member_id, v_task.reward_coins, v_balance,
          '任务完成: ' || v_task.title, 'task', 'task', v_task.id, v_member_id, 'star');

  return query select v_balance, v_task.reward_coins;
end;
$$;

-- 授权
grant execute on function public.complete_task(uuid, uuid) to anon, authenticated;
grant execute on function public.approve_task(uuid) to anon, authenticated;
grant execute on function public.convert_star_to_coin(uuid, int, int) to anon, authenticated;
