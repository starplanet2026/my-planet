-- ============================================================
-- My Planet 更新 v5：已完成任务自动转为草稿
-- 在 Supabase Dashboard → SQL Editor 中粘贴执行
-- ============================================================

-- approve_task：确认完成后，任务状态由 completed 改为 draft（回到待发布）
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

  select coin_balance into v_balance from public.members where id = v_member_id for update;
  if not found then raise exception '成员不存在'; end if;
  v_balance := v_balance + v_task.reward_coins;
  if v_balance < 0 then raise exception '金币余额不足，无法扣减'; end if;
  update public.members set coin_balance = v_balance, updated_at = now() where id = v_member_id;

  insert into public.coin_records (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by)
  values (v_family_id, v_member_id, v_task.reward_coins, v_balance, '任务完成: ' || v_task.title, 'task', 'task', v_task.id, v_member_id);

  return query select v_balance, v_task.reward_coins;
end;
$$;

-- 将已有的 completed 任务转为 draft
update public.tasks set status = 'draft' where status = 'completed';
