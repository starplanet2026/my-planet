-- ============================================================
-- update_v6.sql：消息系统 + 验证申请 + 手动加减分
-- 1. tasks 表增加 reject_reason 列
-- 2. coin_records 表增加 message、reply 列，扩展 category
-- 3. 修改 reject_task RPC：支持退回原因 + 记录消息
-- 4. 新增 manual_adjust_coins RPC：手动加减分
-- 5. 新增 reply_message RPC：孩子回复退回消息
-- ============================================================

-- 1. tasks 表增加 reject_reason
alter table public.tasks add column if not exists reject_reason text;

-- 2. coin_records 扩展
alter table public.coin_records add column if not exists message text;
alter table public.coin_records add column if not exists reply text;

-- 扩展 category 约束（增加 task_reject 和 manual_adjust）
-- 先删除旧约束再添加新约束
alter table public.coin_records drop constraint if exists coin_records_category_check;
alter table public.coin_records add constraint coin_records_category_check
  check (category in ('task','purchase','manual','system','task_reject','manual_adjust'));

-- ============================================================
-- 3. 修改 reject_task RPC：支持退回原因 + 记录消息
-- ============================================================
create or replace function public.reject_task(p_task_id uuid, p_reason text default null)
returns void
language plpgsql security definer as $$
declare
  v_task record;
  v_parent members%rowtype;
begin
  select * into v_task from public.tasks where id = p_task_id;
  if not found then
    raise exception 'Task not found';
  end if;

  select * into v_parent from public.members
  where family_id = v_task.family_id and role = 'parent' limit 1;

  -- 退回任务状态
  update public.tasks
  set status = 'active',
      reject_reason = p_reason,
      updated_at = now()
  where id = p_task_id and status = 'pending_approval';

  -- 记录退回消息（amount=0，不影响金币）
  if p_reason is not null and p_reason != '' then
    insert into public.coin_records (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by, message)
    values (
      v_task.family_id,
      v_task.member_id,
      0,
      coalesce((select coin_balance from public.members where id = v_task.member_id), 0),
      '任务退回：' || v_task.title,
      'task_reject',
      'task',
      p_task_id,
      v_parent.id,
      p_reason
    );
  end if;
end;
$$;

-- ============================================================
-- 4. 手动加减分 RPC
-- ============================================================
create or replace function public.manual_adjust_coins(
  p_family_id uuid,
  p_member_id uuid,
  p_amount int,
  p_reason text,
  p_created_by uuid
)
returns table(new_balance int, amount int)
language plpgsql security definer as $$
declare
  v_new_balance int;
  v_old_balance int;
begin
  -- 检查余额（扣分时不能为负）
  select coin_balance into v_old_balance from public.members where id = p_member_id;
  if v_old_balance is null then
    raise exception 'Member not found';
  end if;

  v_new_balance := v_old_balance + p_amount;
  if v_new_balance < 0 then
    v_new_balance := 0;
    p_amount := -v_old_balance;  -- 只扣到0
  end if;

  -- 更新余额
  update public.members set coin_balance = v_new_balance, updated_at = now()
  where id = p_member_id;

  -- 记录
  insert into public.coin_records (family_id, member_id, amount, balance_after, reason, category, created_by)
  values (p_family_id, p_member_id, p_amount, v_new_balance, p_reason, 'manual_adjust', p_created_by);

  return query select v_new_balance, p_amount;
end;
$$;

-- ============================================================
-- 5. 孩子回复退回消息 RPC
-- ============================================================
create or replace function public.reply_message(p_record_id uuid, p_reply text)
returns void
language plpgsql security definer as $$
begin
  update public.coin_records
  set reply = p_reply
  where id = p_record_id;
end;
$$;
