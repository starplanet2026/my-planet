-- 0301: 补打卡改为「申请 → 家长审核 → 补发星光」流程
-- 孩子端提交补打卡申请（不产生记录）；家长在「成就达成」页审核，
-- 通过后才补写 coin_records（created_at 为补打卡日期）并加星光、触发勋章重算。

-- 直接补打卡的 0300 版本作废，改走审核流
drop function if exists public.makeup_task_checkin(uuid, uuid, date);

-- ============================================================
-- 1. 补打卡申请表
-- ============================================================
create table if not exists public.makeup_requests (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  checkin_date date not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reject_reason text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

-- 同任务同日期只允许一条待审核申请
create unique index if not exists makeup_requests_pending_uniq
  on public.makeup_requests (member_id, task_id, checkin_date) where status = 'pending';

create index if not exists makeup_requests_family_status_idx
  on public.makeup_requests (family_id, status);

alter table public.makeup_requests enable row level security;

create policy makeup_requests_owner_all on public.makeup_requests
  for all using (
    exists (select 1 from public.families f where f.id = makeup_requests.family_id and f.owner_user_id = auth.uid())
  ) with check (
    exists (select 1 from public.families f where f.id = makeup_requests.family_id and f.owner_user_id = auth.uid())
  );

-- 家庭成员（孩子端）可读自己的申请状态
create policy makeup_requests_member_read on public.makeup_requests
  for select using (
    exists (select 1 from public.families f where f.id = makeup_requests.family_id and f.owner_user_id = auth.uid())
  );

-- ============================================================
-- 2. 孩子提交补打卡申请
-- ============================================================
create or replace function public.request_makeup_checkin(
  p_task_id uuid, p_member_id uuid, p_date date
)
returns uuid
language plpgsql security definer as $$
declare
  v_task public.tasks%rowtype;
  v_family uuid;
  v_dow int;
  v_today date := (now() at time zone 'Asia/Shanghai')::date;
  v_id uuid;
begin
  select * into v_task from public.tasks where id = p_task_id;
  if not found then raise exception '任务不存在'; end if;

  select family_id into v_family from public.members where id = p_member_id;
  if v_family is null or v_family <> v_task.family_id then
    raise exception '无权为该成员申请补打卡';
  end if;

  if v_task.member_id is not null and v_task.member_id <> p_member_id then
    raise exception '该任务不属于此成员';
  end if;

  if p_date >= v_today then
    raise exception '只能补过去的打卡日期，今天请直接完成';
  end if;

  v_dow := extract(dow from p_date)::int;  -- 0=周日...6=周六，与 repeat_days 一致
  if not (v_dow = any(coalesce(v_task.repeat_days, array[]::int[]))) then
    raise exception '该日期不是打卡日';
  end if;

  if exists (
    select 1 from public.coin_records
    where member_id = p_member_id and category = 'task' and ref_id = p_task_id
      and (created_at at time zone 'Asia/Shanghai')::date = p_date
  ) then
    raise exception '该日期已有打卡记录';
  end if;

  if exists (
    select 1 from public.makeup_requests
    where member_id = p_member_id and task_id = p_task_id and checkin_date = p_date and status = 'pending'
  ) then
    raise exception '该日期已在审核中，请耐心等待';
  end if;

  insert into public.makeup_requests (family_id, member_id, task_id, checkin_date)
  values (v_task.family_id, p_member_id, p_task_id, p_date)
  returning id into v_id;

  return v_id;
end;
$$;

-- ============================================================
-- 3. 家长审核补打卡申请
-- ============================================================
create or replace function public.review_makeup_request(
  p_request_id uuid, p_approve boolean, p_reason text default null
)
returns void
language plpgsql security definer as $$
declare
  v_req public.makeup_requests%rowtype;
  v_task public.tasks%rowtype;
  v_ts timestamptz;
  v_balance int;
begin
  select * into v_req from public.makeup_requests where id = p_request_id;
  if not found then raise exception '申请不存在'; end if;
  if v_req.status <> 'pending' then raise exception '该申请已处理'; end if;

  if not exists (
    select 1 from public.families f where f.id = v_req.family_id and f.owner_user_id = auth.uid()
  ) then
    raise exception '无权审核该申请';
  end if;

  if not p_approve then
    update public.makeup_requests
    set status = 'rejected', reject_reason = nullif(trim(coalesce(p_reason, '')), ''), reviewed_at = now()
    where id = p_request_id;
    return;
  end if;

  select * into v_task from public.tasks where id = v_req.task_id;
  if not found then raise exception '任务不存在'; end if;

  -- 审核期间可能已通过其他途径打卡，避免重复发奖
  if exists (
    select 1 from public.coin_records
    where member_id = v_req.member_id and category = 'task' and ref_id = v_req.task_id
      and (created_at at time zone 'Asia/Shanghai')::date = v_req.checkin_date
  ) then
    update public.makeup_requests
    set status = 'approved', reviewed_at = now(), reject_reason = '该日期已有打卡记录，自动通过'
    where id = p_request_id;
    return;
  end if;

  -- 补写打卡记录：时间定在补打卡当天北京时间中午，coin_record_medal_sync 触发器重算勋章
  v_ts := (v_req.checkin_date::text || ' 12:00:00+08')::timestamptz;

  update public.members
  set star_value = coalesce(star_value, 0) + v_task.reward_coins
  where id = v_req.member_id
  returning star_value into v_balance;

  insert into public.coin_records
    (id, family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by, created_at, balance_type)
  values
    (gen_random_uuid(), v_req.family_id, v_req.member_id, v_task.reward_coins, coalesce(v_balance, 0),
     '补打卡·' || v_task.title, 'task', 'task', v_req.task_id, v_req.member_id, v_ts, 'star');

  update public.makeup_requests
  set status = 'approved', reviewed_at = now()
  where id = p_request_id;
end;
$$;
