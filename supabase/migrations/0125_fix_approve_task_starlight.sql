-- 0125: 修复 approve_task 发放金币而非星光值的 Bug
-- 问题：0109_achievement_v2 重写 approve_task 时用了 coin_balance（金币），
--       但 0006/0008 早已改为 star_value（星光值）。
--       导致成就任务审核通过后错误发放金币，而非星光值。
-- 修复：恢复为 star_value，coin_records 记录 balance_type='star'
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

  -- 下线到 draft（待发布），不删除数据、不影响循环规则
  update public.tasks
    set status = 'draft', updated_at = now()
    where id = p_task_id;

  -- 发放星光值（star_value），而非金币（coin_balance）
  select star_value into v_balance from public.members where id = v_member_id for update;
  if not found then raise exception '成员不存在'; end if;
  v_balance := v_balance + v_task.reward_coins;
  if v_balance < 0 then raise exception '星光值余额不足，无法扣减'; end if;
  update public.members set star_value = v_balance, updated_at = now() where id = v_member_id;

  insert into public.coin_records (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by, balance_type)
  values (v_family_id, v_member_id, v_task.reward_coins, v_balance, '任务完成: ' || v_task.title, 'task', 'task', v_task.id, v_member_id, 'star');

  return query select v_balance, v_task.reward_coins;
end;
$$;
revoke all on function public.approve_task(uuid) from public;
grant execute on function public.approve_task(uuid) to authenticated;
