-- 0143: 背诵任务模块（语文/英语背诵任务）
--   1. recitation_tasks 模板表（永久保存，仅手动删除）
--   2. recitation_instances 发布实例表（推送学生、提交、30天清理）
--   3. publish_recitation_task / submit_recitation_result / offline_recitation_task 三个 RPC
--   4. cleanup_old_records 追加 recitation_instances 清理

-- ====== 0. coin_records.category 约束允许背诵分类 ======
alter table public.coin_records drop constraint if exists coin_records_category_check;
alter table public.coin_records add constraint coin_records_category_check
  check (category in ('task','purchase','manual','system','task_reject','manual_adjust','challenge','shop','boarding','evolve','study','upgrade','dictation','recitation','correction'));

-- ====== 1. recitation_tasks：永久模板表 ======
create table if not exists public.recitation_tasks (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null,
  created_by uuid,
  title text not null,
  subject text not null check (subject in ('chinese', 'english')),
  answer_text text not null,                 -- 标准答案原文
  pass_threshold int not null default 60 check (pass_threshold between 0 and 100),
  match_mode text not null default 'fuzzy' check (match_mode in ('fuzzy', 'strict')),
  -- 3档固定奖励列（允许 null 表示该档未配置）
  reward_tier1_min int,
  reward_tier1_max int,
  reward_tier1_stars int,
  reward_tier2_min int,
  reward_tier2_max int,
  reward_tier2_stars int,
  reward_tier3_min int,
  reward_tier3_max int,
  reward_tier3_stars int,
  status text not null default 'saved' check (status in ('saved', 'published', 'offline')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_recitation_tasks_family on public.recitation_tasks(family_id, status);

-- ====== 2. recitation_instances：发布实例表 ======
create table if not exists public.recitation_instances (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.recitation_tasks(id) on delete cascade,
  family_id uuid not null,
  member_id uuid not null,
  status text not null default 'pending' check (status in ('pending', 'submitted')),
  score int,
  passed boolean,
  recognized_text text,
  awarded_stars int not null default 0,
  submitted_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_recitation_instances_member on public.recitation_instances(member_id, status);
create index if not exists idx_recitation_instances_task on public.recitation_instances(task_id);
create index if not exists idx_recitation_instances_submitted on public.recitation_instances(submitted_at);

-- ====== 3. 行级安全 + 触发器 ======
alter table public.recitation_tasks enable row level security;
alter table public.recitation_instances enable row level security;

-- 简化策略：authenticated 可读写（数据隔离由应用层 family_id/member_id 过滤保证）
-- 幂等：先 drop 再 create，避免重复执行时报 42710 policy already exists
drop policy if exists "recitation_tasks_auth_all" on public.recitation_tasks;
create policy "recitation_tasks_auth_all" on public.recitation_tasks
  for all to authenticated using (true) with check (true);
drop policy if exists "recitation_instances_auth_all" on public.recitation_instances;
create policy "recitation_instances_auth_all" on public.recitation_instances
  for all to authenticated using (true) with check (true);

drop trigger if exists trg_recitation_tasks_updated on public.recitation_tasks;
create trigger trg_recitation_tasks_updated before update on public.recitation_tasks
  for each row execute function public.touch_updated_at();

-- ====== 4. RPC: publish_recitation_task(p_task_id, p_member_ids[]) ======
-- 为选定学生创建 pending 实例，模板状态置 published
drop function if exists public.publish_recitation_task(uuid, uuid[]);
create or replace function public.publish_recitation_task(
  p_task_id uuid,
  p_member_ids uuid[]
)
returns table(success boolean, message text, published_count int)
language plpgsql security definer as $$
declare
  v_task record;
  v_mid uuid;
  v_count int := 0;
begin
  select * into v_task from public.recitation_tasks where id = p_task_id;
  if not found then
    return query select false, '任务模板不存在', 0;
    return;
  end if;

  -- 清理该模板下旧的 pending 实例（避免重复推送同学生成多条 pending）
  delete from public.recitation_instances
    where task_id = p_task_id and status = 'pending';

  foreach v_mid in array p_member_ids
  loop
    insert into public.recitation_instances (task_id, family_id, member_id, status)
    values (p_task_id, v_task.family_id, v_mid, 'pending');
    v_count := v_count + 1;
  end loop;

  update public.recitation_tasks set status = 'published', updated_at = now()
    where id = p_task_id;

  return query select true, '发布成功', v_count;
end;
$$;
grant execute on function public.publish_recitation_task(uuid, uuid[]) to anon, authenticated;

-- ====== 5. RPC: submit_recitation_result(p_instance_id, p_member_id, p_score, p_recognized_text) ======
-- 校验 pending → 从模板读配置 → 判定通过 → 匹配档位发星光 → 写统计 → 锁定实例
drop function if exists public.submit_recitation_result(uuid, uuid, int, text);
create or replace function public.submit_recitation_result(
  p_instance_id uuid,
  p_member_id uuid,
  p_score int,
  p_recognized_text text
)
returns table(success boolean, message text, passed boolean, awarded_stars int, new_star int)
language plpgsql security definer as $$
declare
  v_inst record;
  v_task record;
  v_member record;
  v_family_id uuid;
  v_passed boolean;
  v_award int := 0;
  v_new_star int;
  v_reward_text text;
begin
  -- 校验实例归属且 pending
  select * into v_inst from public.recitation_instances
    where id = p_instance_id and member_id = p_member_id for update;
  if not found then
    return query select false, '作业实例不存在或无权操作', false, 0, 0;
    return;
  end if;
  if v_inst.status <> 'pending' then
    return query select false, '该作业已提交，不可重复提交', false, 0, 0;
    return;
  end if;

  -- 读模板配置
  select * into v_task from public.recitation_tasks where id = v_inst.task_id;
  if not found then
    return query select false, '任务模板已被删除', false, 0, 0;
    return;
  end if;

  -- 锁定成员行
  select * into v_member from public.members where id = p_member_id for update;
  if not found then
    return query select false, '用户不存在', false, 0, 0;
    return;
  end if;
  v_family_id := v_member.family_id;

  -- 判定通过
  v_passed := (p_score >= coalesce(v_task.pass_threshold, 60));

  -- 仅在通过时尝试匹配奖励档位（命中即发放）
  if v_passed then
    if v_task.reward_tier1_min is not null
       and p_score between v_task.reward_tier1_min and coalesce(v_task.reward_tier1_max, v_task.reward_tier1_min)
       and coalesce(v_task.reward_tier1_stars, 0) > 0 then
      v_award := v_task.reward_tier1_stars;
    elsif v_task.reward_tier2_min is not null
       and p_score between v_task.reward_tier2_min and coalesce(v_task.reward_tier2_max, v_task.reward_tier2_min)
       and coalesce(v_task.reward_tier2_stars, 0) > 0 then
      v_award := v_task.reward_tier2_stars;
    elsif v_task.reward_tier3_min is not null
       and p_score between v_task.reward_tier3_min and coalesce(v_task.reward_tier3_max, v_task.reward_tier3_min)
       and coalesce(v_task.reward_tier3_stars, 0) > 0 then
      v_award := v_task.reward_tier3_stars;
    end if;
  end if;

  -- 发放星光值（仅当命中档位且 > 0）
  if v_award > 0 then
    v_new_star := v_member.star_value + v_award;
    update public.members set star_value = v_new_star, updated_at = now() where id = p_member_id;

    v_reward_text := '背诵任务：《' || v_task.title || '》得分 ' || p_score::text || ' 奖励';
    insert into public.coin_records
      (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by, balance_type)
    values
      (v_family_id, p_member_id, v_award, v_new_star,
       v_reward_text, 'recitation', 'recitation_instance', p_instance_id, p_member_id, 'star');
  else
    v_new_star := v_member.star_value;
  end if;

  -- 写智慧星战答题记录（source='背诵任务'，自动参与 TopBar 统计）
  insert into public.question_records (family_id, member_id, is_correct, reward_star, source)
  values (v_family_id, p_member_id, v_passed, v_award, '背诵任务');

  -- 锁定实例
  update public.recitation_instances
    set status = 'submitted',
        score = p_score,
        passed = v_passed,
        recognized_text = p_recognized_text,
        awarded_stars = v_award,
        submitted_at = now()
    where id = p_instance_id;

  return query select true, '提交成功', v_passed, v_award, v_new_star;
end;
$$;
grant execute on function public.submit_recitation_result(uuid, uuid, int, text) to anon, authenticated;

-- ====== 6. RPC: offline_recitation_task(p_task_id) ======
-- 模板置 offline，删除 pending 实例（已提交记录保留）
drop function if exists public.offline_recitation_task(uuid);
create or replace function public.offline_recitation_task(
  p_task_id uuid
)
returns void
language plpgsql security definer as $$
begin
  -- 删除未提交的实例（已提交记录保留，遵守30天清理）
  delete from public.recitation_instances
    where task_id = p_task_id and status = 'pending';

  update public.recitation_tasks set status = 'offline', updated_at = now()
    where id = p_task_id;
end;
$$;
grant execute on function public.offline_recitation_task(uuid) to anon, authenticated;

-- ====== 7. 权限 ======
grant select, insert, update, delete on public.recitation_tasks to anon, authenticated;
grant select, insert, update, delete on public.recitation_instances to anon, authenticated;

-- ====== 8. cleanup_old_records 追加 recitation_instances 清理 ======
create or replace function public.cleanup_old_records()
returns void
language plpgsql security definer as $$
declare
  v_cutoff timestamptz := now() - interval '30 days';
begin
  -- 宠托师托管记录
  delete from public.pet_boarding_log where created_at < v_cutoff;
  -- 答题记录
  delete from public.question_records where answered_at < v_cutoff;
  -- 默写记录
  delete from public.dictation_records where created_at < v_cutoff;
  -- 今日达成
  delete from public.tasks where created_at < v_cutoff;
  -- 资产明细
  delete from public.coin_records where created_at < v_cutoff;
  -- 萌宠消息
  delete from public.pet_messages where created_at < v_cutoff;
  -- 特权卡使用记录
  delete from public.purchase_usage_records where used_at < v_cutoff;
  -- 背诵任务已提交实例（保留30天供家长复查）
  delete from public.recitation_instances where submitted_at is not null and submitted_at < v_cutoff;
  -- recitation_tasks 模板表永不自动清理（仅手动删除）
end;
$$;
grant execute on function public.cleanup_old_records() to anon, authenticated;

notify pgrst, 'reload schema';
