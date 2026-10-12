-- 0231: 家默默写模式批改需家长审核后才展示结果
-- 1. 新增 dictation_submissions 表存待审核的批改提交
-- 2. submit_dictation_review：孩子提交批改（只存记录，不判分不发星光）
-- 3. approve_dictation_submission：家长审核通过，内部走原判分逻辑
-- 4. reject_dictation_submission：家长驳回

create table if not exists public.dictation_submissions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.dictation_tasks(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  family_id uuid not null,
  results jsonb not null default '[]',
  status text not null default 'pending', -- pending / approved / rejected
  correct_count int,
  error_count int,
  total_star int,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_dictation_submissions_task on public.dictation_submissions(task_id, status);
create index if not exists idx_dictation_submissions_member on public.dictation_submissions(member_id, status);

-- 孩子提交批改（仅入库，待审核）
create or replace function public.submit_dictation_review(
  p_task_id uuid,
  p_member_id uuid,
  p_results jsonb
) returns table(success boolean, message text, submission_id uuid) as $$
declare
  v_family_id uuid;
  v_id uuid;
  v_existing uuid;
begin
  select family_id into v_family_id from public.members where id = p_member_id;
  if not found then
    return query select false, '成员不存在'::text, null::uuid;
    return;
  end if;

  -- 同任务已有 pending 提交则覆盖（以最新为准）
  select id into v_existing from public.dictation_submissions
    where task_id = p_task_id and member_id = p_member_id and status = 'pending';

  if v_existing is not null then
    update public.dictation_submissions
      set results = p_results, created_at = now()
      where id = v_existing;
    return query select true, 'ok'::text, v_existing;
    return;
  end if;

  insert into public.dictation_submissions (task_id, member_id, family_id, results)
  values (p_task_id, p_member_id, v_family_id, p_results)
  returning id into v_id;

  return query select true, 'ok'::text, v_id;
end;
$$ language plpgsql security definer;

-- 家长审核通过：内部执行原判分逻辑
create or replace function public.approve_dictation_submission(
  p_submission_id uuid,
  p_reviewer_id uuid
) returns table(success boolean, message text, correct_count int, error_count int, total_star int) as $$
declare
  v_sub public.dictation_submissions%rowtype;
  v_task public.dictation_tasks%rowtype;
  v_item jsonb;
  v_correct int := 0;
  v_errors int := 0;
  v_star int := 0;
  v_family_id uuid;
begin
  select * into v_sub from public.dictation_submissions where id = p_submission_id;
  if not found then
    return query select false, '提交不存在'::text, 0, 0, 0;
    return;
  end if;
  if v_sub.status <> 'pending' then
    return query select false, '该提交已审核'::text, 0, 0, 0;
    return;
  end if;

  select family_id into v_family_id from public.members where id = p_reviewer_id;
  if v_family_id is null or v_family_id <> v_sub.family_id then
    return query select false, '无权审核'::text, 0, 0, 0;
    return;
  end if;

  select * into v_task from public.dictation_tasks where id = v_sub.task_id;

  -- 判分：correct × star_per_word，错题入错词库
  for v_item in select * from jsonb_array_elements(v_sub.results) loop
    if (v_item->>'is_correct')::boolean then
      v_correct := v_correct + 1;
    else
      v_errors := v_errors + 1;
      insert into public.dictation_error_words
        (member_id, subject, answer, cycle_start_date, current_node, next_review_date, status, review_history)
      select v_sub.member_id, v_task.subject, v_item->>'answer',
             current_date, 1, current_date + interval '1 day', 'in_progress', '[]'
      where not exists (
        select 1 from public.dictation_error_words
        where member_id = v_sub.member_id and subject = v_task.subject and answer = (v_item->>'answer')
      );
    end if;
  end loop;

  v_star := v_correct * v_task.star_per_word;
  if v_star > 0 then
    update public.members set star_value = star_value + v_star, updated_at = now() where id = v_sub.member_id;
    perform public.add_session_stars(v_sub.member_id, v_star);
  end if;

  -- 标记任务完成
  update public.dictation_tasks
    set status = 'completed', completed_at = now(), updated_at = now()
    where id = v_sub.task_id;

  -- 更新提交状态
  update public.dictation_submissions
    set status = 'approved', correct_count = v_correct, error_count = v_errors,
        total_star = v_star, reviewed_at = now()
    where id = p_submission_id;

  return query select true, 'ok'::text, v_correct, v_errors, v_star;
end;
$$ language plpgsql security definer;

-- 家长驳回
create or replace function public.reject_dictation_submission(
  p_submission_id uuid,
  p_reviewer_id uuid
) returns table(success boolean, message text) as $$
declare
  v_sub public.dictation_submissions%rowtype;
  v_family_id uuid;
begin
  select * into v_sub from public.dictation_submissions where id = p_submission_id;
  if not found then
    return query select false, '提交不存在'::text;
    return;
  end if;
  if v_sub.status <> 'pending' then
    return query select false, '该提交已审核'::text;
    return;
  end if;

  select family_id into v_family_id from public.members where id = p_reviewer_id;
  if v_family_id is null or v_family_id <> v_sub.family_id then
    return query select false, '无权审核'::text;
    return;
  end if;

  update public.dictation_submissions
    set status = 'rejected', reviewed_at = now()
    where id = p_submission_id;

  return query select true, 'ok'::text;
end;
$$ language plpgsql security definer;

-- 查询家庭待审核列表（家长后台）
create or replace function public.list_pending_dictation_submissions(p_family_id uuid)
returns table(
  id uuid,
  task_id uuid,
  member_id uuid,
  member_name text,
  task_title text,
  subject text,
  results jsonb,
  created_at timestamptz
) as $$
  select s.id, s.task_id, s.member_id, m.name, t.title, t.subject, s.results, s.created_at
  from public.dictation_submissions s
  join public.members m on m.id = s.member_id
  join public.dictation_tasks t on t.id = s.task_id
  where s.family_id = p_family_id and s.status = 'pending'
  order by s.created_at desc;
$$ language sql security definer;

-- 孩子查询自己某任务的最新提交状态
create or replace function public.get_dictation_submission_status(
  p_task_id uuid,
  p_member_id uuid
) returns table(
  id uuid,
  status text,
  correct_count int,
  error_count int,
  total_star int
) as $$
  select s.id, s.status, s.correct_count, s.error_count, s.total_star
  from public.dictation_submissions s
  where s.task_id = p_task_id and s.member_id = p_member_id
  order by s.created_at desc
  limit 1;
$$ language sql security definer;

grant select, insert, update on public.dictation_submissions to anon, authenticated;
grant execute on function public.submit_dictation_review(uuid, uuid, jsonb) to anon, authenticated;
grant execute on function public.approve_dictation_submission(uuid, uuid) to anon, authenticated;
grant execute on function public.reject_dictation_submission(uuid, uuid) to anon, authenticated;
grant execute on function public.list_pending_dictation_submissions(uuid) to anon, authenticated;
grant execute on function public.get_dictation_submission_status(uuid, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
