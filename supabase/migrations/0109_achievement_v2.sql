-- 0109_achievement_v2.sql
-- 成就板块完整开发：分类管理、优先级排序、下线逻辑、循环任务独立实例

-- ============================================================
-- 1. 分类表：支持自定义分类、可编辑名称、默认分类不可删
-- ============================================================
create table if not exists public.task_categories (
  id uuid primary key default gen_random_uuid(),
  family_id uuid references public.families(id) on delete cascade, -- null=全局默认分类
  key text not null,                  -- tasks.category 存储的标识键
  name text not null,                 -- 展示名称（可编辑）
  is_default boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 同 family 下 key 唯一（family_id null 用零 UUID 占位，保证默认分类全局唯一）
create unique index if not exists idx_task_categories_family_key
  on public.task_categories (coalesce(family_id, '00000000-0000-0000-0000-000000000000'::uuid), key);

create index if not exists idx_task_categories_family on public.task_categories(family_id);

-- 种子：4 个默认分类（全局，is_default=true，不可删除）
insert into public.task_categories (family_id, key, name, is_default, sort_order) values
  (null, 'daily',  '每日成就',    true, 1),
  (null, 'stage',  '里程碑成就',  true, 2),
  (null, 'super',  '高光时刻',    true, 3),
  (null, 'black',  '成长挑战',    true, 4)
on conflict (coalesce(family_id, '00000000-0000-0000-0000-000000000000'::uuid), key) do nothing;

-- ============================================================
-- 2. tasks 表改动：加 priority 列、放开 category 约束、存量状态归一
-- ============================================================
alter table public.tasks add column if not exists priority int not null default 0;

-- 放开 category 的枚举约束，允许自定义分类 key
alter table public.tasks drop constraint if exists tasks_category_check;

-- 已下线任务统一归为 draft（待发布）：completed/expired → draft
-- 理由：下线仅隐藏前台，配置与循环规则保留，可重新上线
update public.tasks set status = 'draft', updated_at = now()
  where status in ('completed', 'expired');

-- ============================================================
-- 3. 重写 expire_tasks：到期下线 → draft（不再 expired）
--    仅处理无循环规则的任务；循环任务由 refresh_repeat_tasks 按日管理
-- ============================================================
create or replace function public.expire_tasks(p_family_id uuid)
returns void language plpgsql security definer as $$
begin
  update public.tasks
  set status = 'draft', updated_at = now()
  where family_id = p_family_id
    and deadline is not null
    and deadline < now()
    and status in ('active', 'pending_approval')
    and (repeat_days is null or array_length(repeat_days, 1) is null);
end;
$$;
revoke all on function public.expire_tasks(uuid) from public;
grant execute on function public.expire_tasks(uuid) to authenticated;

-- ============================================================
-- 4. 重写 refresh_repeat_tasks：按循环日上线/下线（独立实例语义）
--    当日匹配 → active；不匹配 → draft（下线）
--    跳过 pending_approval（等待家长审核）和 deleted
-- ============================================================
create or replace function public.refresh_repeat_tasks(p_family_id uuid)
returns void language plpgsql security definer as $$
declare
  v_today_dow int;
begin
  v_today_dow := extract(dow from current_date)::int;
  update public.tasks
  set status = case
    when v_today_dow = any(repeat_days) then 'active'
    else 'draft'
  end,
  updated_at = now()
  where family_id = p_family_id
    and repeat_days is not null
    and array_length(repeat_days, 1) > 0
    and status not in ('pending_approval', 'deleted');
end;
$$;
revoke all on function public.refresh_repeat_tasks(uuid) from public;
grant execute on function public.refresh_repeat_tasks(uuid) to authenticated;

-- ============================================================
-- 5. 重写 approve_task：家长审核通过 → 发放奖励 + 下线到 draft
--    下线仅关闭本次前台展示，循环任务下次匹配日仍会自动上线
-- ============================================================
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
revoke all on function public.approve_task(uuid) from public;
grant execute on function public.approve_task(uuid) to authenticated;

-- ============================================================
-- 6. 重写 publish_task / offline_task：发布/下线
-- ============================================================
create or replace function public.publish_task(p_task_id uuid)
returns void language plpgsql security definer as $$
begin
  update public.tasks set status = 'active', updated_at = now()
    where id = p_task_id and status in ('draft', 'expired', 'completed');
end;
$$;
revoke all on function public.publish_task(uuid) from public;
grant execute on function public.publish_task(uuid) to authenticated;

create or replace function public.offline_task(p_task_id uuid)
returns void language plpgsql security definer as $$
begin
  update public.tasks set status = 'draft', updated_at = now()
    where id = p_task_id and status = 'active';
end;
$$;
revoke all on function public.offline_task(uuid) from public;
grant execute on function public.offline_task(uuid) to authenticated;

-- ============================================================
-- 7. RLS：task_categories
--    家长可读可写自己 family 的分类 + 全局默认分类
--    孩子可读（用于前台展示分类名）
-- ============================================================
alter table public.task_categories enable row level security;

drop policy if exists "read categories" on public.task_categories;
create policy "read categories" on public.task_categories
  for select using (
    family_id is null
    or exists (select 1 from public.families f where f.id = task_categories.family_id)
  );

drop policy if exists "write categories" on public.task_categories;
create policy "write categories" on public.task_categories
  for all using (
    exists (
      select 1 from public.families f
      where f.id = task_categories.family_id
        and f.owner_user_id = auth.uid()
    )
  );

notify pgrst, 'reload schema';
