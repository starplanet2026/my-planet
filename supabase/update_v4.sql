-- ============================================================
-- update_v4.sql
-- 1. tasks 表增加 icon 列（任务图标）
-- 2. 增加 pending_approval 状态（完成需家长确认）
-- 3. 新增 request_complete_task / approve_task / reject_task RPC
-- ============================================================

-- ============ 1. 增加 icon 列 ============
alter table public.tasks add column if not exists icon text default '⭐';

-- ============ 2. 增加 pending_approval 状态 ============
alter table public.tasks drop constraint if exists tasks_status_check;
alter table public.tasks add constraint tasks_status_check
  check (status in ('draft','active','pending_approval','completed','expired','deleted'));

-- ============ 3. 新增 RPC ============

-- 3a. 孩子请求完成任务（status → pending_approval，不加金币）
create or replace function public.request_complete_task(p_task_id uuid, p_member_id uuid)
returns void
language plpgsql security definer as $$
declare
  v_task public.tasks%rowtype;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then raise exception '任务不存在'; end if;
  if v_task.status <> 'active' then raise exception '任务当前状态不可完成'; end if;
  if v_task.member_id is not null and v_task.member_id <> p_member_id then
    raise exception '此任务不是指派给你的';
  end if;
  update public.tasks
    set status = 'pending_approval', completed_by = p_member_id, completed_at = now(), updated_at = now()
    where id = p_task_id;
end;
$$;

-- 3b. 家长确认完成任务 → 加减金币 → 记账（原 complete_task 逻辑）
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

  update public.tasks set status = 'completed', updated_at = now() where id = p_task_id;

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

-- 3c. 家长拒绝完成 → 退回 active 状态
create or replace function public.reject_task(p_task_id uuid)
returns void
language plpgsql security definer as $$
begin
  update public.tasks
    set status = 'active', completed_by = null, completed_at = null, updated_at = now()
    where id = p_task_id and status = 'pending_approval';
  if not found then raise exception '任务不在待确认状态'; end if;
end;
$$;

-- 给已有任务补上默认 icon
update public.tasks set icon = '⭐' where icon is null;
