-- 0232: 家默审核体系完善
-- 1. dictation_submissions 增加 type：grading_access(查看答案授权)/grading_result(批改结果)/quick_review(快速复习积分)
-- 2. approve 按 type 分支处理
-- 3. 快速复习判题不再实时发星光，完成复习后统一提交审核发放（与陪伴学习一致）

-- ============================================================
-- 一、表结构：增加 type 列
-- ============================================================
alter table public.dictation_submissions
  add column if not exists type text not null default 'grading_result';

-- ============================================================
-- 二、重写 submit_dictation_review：支持类型与累计星光
-- ============================================================
drop function if exists public.submit_dictation_review(uuid, uuid, jsonb);

create or replace function public.submit_dictation_review(
  p_task_id uuid,
  p_member_id uuid,
  p_results jsonb default '[]',
  p_type text default 'grading_result',
  p_total_star int default null
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

  -- grading_access：已有 approved 授权则直接返回（无需重复审核）
  if p_type = 'grading_access' then
    select id into v_existing from public.dictation_submissions
      where task_id = p_task_id and member_id = p_member_id and type = 'grading_access' and status = 'approved';
    if v_existing is not null then
      return query select true, 'already_approved'::text, v_existing;
      return;
    end if;
  end if;

  -- 同任务同人同类型 pending 则覆盖更新
  select id into v_existing from public.dictation_submissions
    where task_id = p_task_id and member_id = p_member_id and type = p_type and status = 'pending';

  if v_existing is not null then
    update public.dictation_submissions
      set results = p_results, total_star = p_total_star, created_at = now()
      where id = v_existing;
    return query select true, 'ok'::text, v_existing;
    return;
  end if;

  insert into public.dictation_submissions (task_id, member_id, family_id, results, type, total_star)
  values (p_task_id, p_member_id, v_family_id, p_results, p_type, p_total_star)
  returning id into v_id;

  return query select true, 'ok'::text, v_id;
end;
$$ language plpgsql security definer;

-- ============================================================
-- 三、重写 approve：按类型分支
-- ============================================================
drop function if exists public.approve_dictation_submission(uuid, uuid);

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

  -- 类型1：查看答案授权——仅改状态，不发星光不判分
  if v_sub.type = 'grading_access' then
    update public.dictation_submissions set status = 'approved', reviewed_at = now() where id = p_submission_id;
    return query select true, 'ok'::text, 0, 0, 0;
    return;
  end if;

  -- 类型2：快速复习积分——按提交的 total_star 统一发放
  if v_sub.type = 'quick_review' then
    v_star := greatest(0, coalesce(v_sub.total_star, 0));
    if v_star > 0 then
      update public.members set star_value = star_value + v_star, updated_at = now() where id = v_sub.member_id;
      perform public.add_session_stars(v_sub.member_id, v_star);
    end if;
    update public.dictation_submissions
      set status = 'approved', total_star = v_star, reviewed_at = now()
      where id = p_submission_id;
    return query select true, 'ok'::text, 0, 0, v_star;
    return;
  end if;

  -- 类型3：批改结果——按明细判分
  select * into v_task from public.dictation_tasks where id = v_sub.task_id;

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

  update public.dictation_tasks
    set status = 'completed', completed_at = now(), updated_at = now()
    where id = v_sub.task_id;

  update public.dictation_submissions
    set status = 'approved', correct_count = v_correct, error_count = v_errors,
        total_star = v_star, reviewed_at = now()
    where id = p_submission_id;

  return query select true, 'ok'::text, v_correct, v_errors, v_star;
end;
$$ language plpgsql security definer;

-- ============================================================
-- 四、重写列表查询：返回 type
-- ============================================================
drop function if exists public.list_pending_dictation_submissions(uuid);

create or replace function public.list_pending_dictation_submissions(p_family_id uuid)
returns table(
  id uuid,
  task_id uuid,
  member_id uuid,
  member_name text,
  task_title text,
  subject text,
  type text,
  results jsonb,
  total_star int,
  created_at timestamptz
) as $$
  select s.id, s.task_id, s.member_id, m.name, t.title, t.subject, s.type, s.results, s.total_star, s.created_at
  from public.dictation_submissions s
  join public.members m on m.id = s.member_id
  join public.dictation_tasks t on t.id = s.task_id
  where s.family_id = p_family_id and s.status = 'pending'
  order by s.created_at desc;
$$ language sql security definer;

-- ============================================================
-- 五、重写状态查询：支持按类型查询
-- ============================================================
drop function if exists public.get_dictation_submission_status(uuid, uuid);

create or replace function public.get_dictation_submission_status(
  p_task_id uuid,
  p_member_id uuid,
  p_type text default 'grading_result'
) returns table(
  id uuid,
  status text,
  correct_count int,
  error_count int,
  total_star int
) as $$
  select s.id, s.status, s.correct_count, s.error_count, s.total_star
  from public.dictation_submissions s
  where s.task_id = p_task_id and s.member_id = p_member_id and s.type = p_type
  order by s.created_at desc
  limit 1;
$$ language sql security definer;

-- ============================================================
-- 六、快速复习判题：不再实时发星光（星光统一由完成复习审核发放）
-- 保留：判题记录、错题入库、wrong_count 累计
-- ============================================================
drop function if exists public.save_quick_review_record(uuid, uuid, uuid, text, text, boolean, text, int, int);

create or replace function public.save_quick_review_record(
  p_task_id uuid,
  p_member_id uuid,
  p_task_word_id uuid,
  p_word_text text,
  p_answer text,
  p_is_correct boolean,
  p_subject text,
  p_star_per_word int,
  p_round_no int default 1
) returns table(success boolean, message text, star_gained int) as $$
declare
  v_task record;
begin
  select * into v_task from public.dictation_tasks
  where id = p_task_id and member_id = p_member_id and status = 'active';
  if v_task is null then
    return query select false, '任务不存在或已下线', 0;
    return;
  end if;

  -- 写入/覆盖判题记录
  insert into public.dictation_quick_review_records
    (task_id, member_id, task_word_id, word_text, answer, is_correct, round_no)
  values
    (p_task_id, p_member_id, p_task_word_id, p_word_text, p_answer, p_is_correct, p_round_no)
  on conflict (task_id, member_id, task_word_id) do update
    set is_correct = excluded.is_correct,
        round_no = excluded.round_no,
        word_text = excluded.word_text,
        answer = excluded.answer;

  if not p_is_correct then
    -- 错误：wrong_count + 1，存入全局错词库
    update public.dictation_task_words set wrong_count = coalesce(wrong_count, 0) + 1 where id = p_task_word_id;
    insert into public.dictation_error_words
      (member_id, subject, answer, cycle_start_date, current_node, next_review_date, status, review_history)
    select p_member_id, p_subject, p_answer,
           current_date, 1, current_date + interval '1 day', 'in_progress', '[]'
    where not exists (
      select 1 from public.dictation_error_words
      where member_id = p_member_id and subject = p_subject and answer = p_answer
    );
  end if;

  -- 星光不再实时发放，统一由完成复习提交审核后发放
  return query select true, 'ok', 0;
end;
$$ language plpgsql security definer;

revoke all on function public.save_quick_review_record(uuid, uuid, uuid, text, text, boolean, text, int, int) from public;
grant execute on function public.save_quick_review_record(uuid, uuid, uuid, text, text, boolean, text, int, int) to anon, authenticated;
grant execute on function public.submit_dictation_review(uuid, uuid, jsonb, text, int) to anon, authenticated;
grant execute on function public.approve_dictation_submission(uuid, uuid) to anon, authenticated;
grant execute on function public.list_pending_dictation_submissions(uuid) to anon, authenticated;
grant execute on function public.get_dictation_submission_status(uuid, uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';
