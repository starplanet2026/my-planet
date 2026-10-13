-- 0234: 错词库大重构
-- 1. 加 review_count / error_count 列，回溯历史数据
-- 2. 节点规则简化：答错→1，答对→下一节点(1→2→4→7→15)，不再判断间隔天数
-- 3. next_review_date 改为基准目标日期（静态，仅答题时更新 = today + 下一节点值）
-- 4. 存量全量重算节点
-- 5. 所属单元 unit_no 已存在，前端补展示+必填校验

-- ============================================================
-- 一、加列：review_count / error_count
-- ============================================================
alter table public.dictation_error_words
  add column if not exists review_count int not null default 0;
alter table public.dictation_error_words
  add column if not exists error_count int not null default 0;

-- ============================================================
-- 二、回溯 review_count / error_count
--    从 review_history JSONB 统计（同时统计默写和快速复习的历史记录）
-- ============================================================
update public.dictation_error_words ew
  set review_count = coalesce(
    (select count(*) from jsonb_array_elements(ew.review_history) where true),
    0
  ),
  error_count = coalesce(
    (select count(*) from jsonb_array_elements(ew.review_history) elem
     where (elem->>'correct')::boolean = false),
    0
  )
  where jsonb_array_length(ew.review_history) > 0;

-- 如果 dictation_quick_review_records 表存在，也统计
do $$
begin
  if exists (select 1 from information_schema.tables where table_name = 'dictation_quick_review_records') then
    -- 快速复习记录中：按 member_id + answer + subject 匹配，累加到 error word 的统计
    update public.dictation_error_words ew
      set review_count = ew.review_count + coalesce(qr.total, 0),
          error_count = ew.error_count + coalesce(qr.errors, 0)
      from (
        select member_id, answer, count(*) as total,
               count(*) filter (where is_correct = false) as errors
        from public.dictation_quick_review_records
        group by member_id, answer
      ) qr
      where ew.member_id = qr.member_id and ew.answer = qr.answer;
  end if;
end $$;

-- 如果 dictation_records 表存在，也统计默写记录
do $$
begin
  if exists (select 1 from information_schema.tables where table_name = 'dictation_records') then
    update public.dictation_error_words ew
      set review_count = ew.review_count + coalesce(dr.total, 0),
          error_count = ew.error_count + coalesce(dr.errors, 0)
      from (
        select member_id, answer, count(*) as total,
               count(*) filter (where is_correct = false) as errors
        from public.dictation_records
        group by member_id, answer
      ) dr
      where ew.member_id = dr.member_id and ew.answer = dr.answer;
  end if;
end $$;

-- ============================================================
-- 三、存量全量重算节点：按新规则重新计算 current_node
--    规则：从 node 1 开始，逐条遍历 review_history
--    correct → 进入下一节点(1→2→4→7→15→completed)
--    wrong → 重置为 1
--    同时重算 next_review_date（基准目标日期）
-- ============================================================
do $$
declare
  v_rec record;
  v_item jsonb;
  v_node int;
  v_next_node int;
  v_last_correct boolean := false;
  v_last_date text;
  v_today date := current_date;
  v_next_date date;
  v_status text;
begin
  for v_rec in select id, review_history from public.dictation_error_words where status = 'in_progress'
  loop
    v_node := 1;
    v_last_correct := false;
    v_last_date := null;

    for v_item in select * from jsonb_array_elements(v_rec.review_history)
    loop
      if (v_item->>'correct')::boolean then
        -- 答对：推进节点
        v_next_node := case v_node
          when 1 then 2 when 2 then 4 when 4 then 7 when 7 then 15
          else 15
        end;
        v_node := v_next_node;
        v_last_correct := true;
      else
        -- 答错：重置
        v_node := 1;
        v_last_correct := false;
      end if;
      v_last_date := v_item->>'date';
    end loop;

    -- 计算基准目标日期
    if v_node = 15 and v_last_correct then
      -- 第15天答对 → 完成
      v_status := 'completed';
      v_next_date := v_today;
    else
      v_status := 'in_progress';
      -- 基准目标日期 = 最后一次答题日期 + 当前节点天数
      if v_last_date is not null then
        v_next_date := (v_last_date::date) + v_node;
      else
        v_next_date := v_today + v_node;
      end if;
    end if;

    update public.dictation_error_words
      set current_node = v_node,
          next_review_date = v_next_date,
          status = v_status
      where id = v_rec.id;
  end loop;
end $$;

-- ============================================================
-- 四、重写 submit_dictation_result：简化节点逻辑
-- ============================================================
drop function if exists public.submit_dictation_result(uuid, uuid, jsonb);

create or replace function public.submit_dictation_result(
  p_task_id uuid,
  p_member_id uuid,
  p_results jsonb
)
returns table(success boolean, message text, correct_count int, error_count int, total_star int, new_star int)
language plpgsql security definer as $$
declare
  v_task record;
  v_member record;
  v_item jsonb;
  v_word_id uuid;
  v_error_word_id uuid;
  v_answer text;
  v_word_text text;
  v_is_correct boolean;
  v_subject text;
  v_correct int := 0;
  v_error int := 0;
  v_ew record;
  v_next_node int;
  v_today date := current_date;
  v_textbook text; v_unit_no int; v_unit_name text; v_page_no int;
  v_chinese text; v_pos text; v_pinyin text;
  v_family_id uuid;
  v_total int;
  v_new_star int;
  v_exists boolean;
begin
  select * into v_task from public.dictation_tasks
  where id = p_task_id and member_id = p_member_id and status = 'active';
  if not found then
    return query select false, '任务不存在、无权操作或已完成', 0, 0, 0, 0;
    return;
  end if;
  v_subject := v_task.subject;

  select * into v_member from public.members where id = p_member_id for update;
  if not found then
    return query select false, '用户不存在', 0, 0, 0, 0;
    return;
  end if;
  v_family_id := v_member.family_id;

  select exists(
    select 1 from public.dictation_records
    where task_id = p_task_id and date_trunc('day', created_at) = v_today
  ) into v_exists;
  if v_exists then
    return query select false, '该任务今日已完成批改', 0, 0, 0, v_member.star_value;
    return;
  end if;

  for v_item in select * from jsonb_array_elements(p_results)
  loop
    v_word_id := (v_item->>'word_id')::uuid;
    v_error_word_id := (v_item->>'error_word_id')::uuid;
    v_answer := v_item->>'answer';
    v_word_text := v_item->>'word_text';
    v_is_correct := (v_item->>'is_correct')::boolean;

    -- 写入永久记录
    insert into public.dictation_records (task_id, member_id, subject, word_text, answer, is_correct)
    values (p_task_id, p_member_id, v_subject, coalesce(v_word_text, ''), coalesce(v_answer, ''), v_is_correct);

    if v_is_correct then v_correct := v_correct + 1;
    else v_error := v_error + 1; end if;

    -- 获取词条字段
    if v_word_id is not null then
      select textbook_name, unit_no, unit_name, page_no, chinese_meaning, part_of_speech, pinyin, answer
        into v_textbook, v_unit_no, v_unit_name, v_page_no, v_chinese, v_pos, v_pinyin, v_answer
      from public.dictation_words where id = v_word_id;
      if not found then v_answer := v_item->>'answer'; end if;
    elsif v_error_word_id is not null then
      select textbook_name, unit_no, unit_name, page_no, chinese_meaning, part_of_speech, pinyin, answer
        into v_textbook, v_unit_no, v_unit_name, v_page_no, v_chinese, v_pos, v_pinyin, v_answer
      from public.dictation_error_words where id = v_error_word_id;
      if not found then v_answer := v_item->>'answer'; end if;
    end if;

    -- 处理错词库（简化规则）
    if not v_is_correct then
      -- 答错：新建或重置为第1节点
      select * into v_ew from public.dictation_error_words
      where member_id = p_member_id and answer = v_answer and subject = v_subject
      limit 1;

      if found then
        update public.dictation_error_words set
          cycle_start_date = v_today,
          current_node = 1,
          next_review_date = v_today + 1,
          status = 'in_progress',
          last_review_date = v_today,
          review_count = review_count + 1,
          error_count = error_count + 1,
          review_history = review_history || jsonb_build_object('date', v_today::text, 'correct', false, 'action', 'reset')
        where id = v_ew.id;
      else
        insert into public.dictation_error_words
          (member_id, subject, word_id, textbook_name, unit_no, unit_name, page_no, chinese_meaning, part_of_speech, pinyin, answer,
           cycle_start_date, current_node, next_review_date, status, last_review_date, review_history,
           review_count, error_count)
        values
          (p_member_id, v_subject, v_word_id, coalesce(v_textbook,''), coalesce(v_unit_no,0), coalesce(v_unit_name,''), v_page_no,
           v_chinese, v_pos, v_pinyin, v_answer,
           v_today, 1, v_today + 1, 'in_progress', v_today,
           jsonb_build_array(jsonb_build_object('date', v_today::text, 'correct', false, 'action', 'new')),
           1, 1);
      end if;
    else
      -- 答对：推进节点（不看间隔，直接晋级）
      select * into v_ew from public.dictation_error_words
      where member_id = p_member_id and answer = v_answer and subject = v_subject
      limit 1;

      if found and v_ew.status = 'in_progress' then
        if v_ew.current_node = 15 then
          -- 第15天答对 → 完成
          update public.dictation_error_words set
            status = 'completed',
            last_review_date = v_today,
            review_count = review_count + 1,
            review_history = review_history || jsonb_build_object('date', v_today::text, 'correct', true, 'action', 'completed')
          where id = v_ew.id;
        else
          -- 推进到下一节点
          v_next_node := case v_ew.current_node
            when 1 then 2 when 2 then 4 when 4 then 7 when 7 then 15
            else 15
          end;
          update public.dictation_error_words set
            current_node = v_next_node,
            next_review_date = v_today + v_next_node,
            last_review_date = v_today,
            review_count = review_count + 1,
            review_history = review_history || jsonb_build_object('date', v_today::text, 'correct', true, 'action', 'advance')
          where id = v_ew.id;
        end if;
      end if;
    end if;
  end loop;

  -- 发放星光值
  v_total := v_correct * coalesce(v_task.star_per_word, 1);
  v_new_star := v_member.star_value + v_total;
  update public.members set star_value = v_new_star, updated_at = now() where id = p_member_id;
  if v_total > 0 then
    perform public.add_session_stars(p_member_id, v_total);
  end if;

  -- 标记任务完成
  update public.dictation_tasks
    set status = 'completed', completed_at = now(), updated_at = now()
    where id = p_task_id;

  return query select true, 'ok', v_correct, v_error, v_total, v_new_star;
end;
$$;

-- ============================================================
-- 五、重写 save_quick_review_record：同步简化节点逻辑
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
  v_today date := current_date;
  v_ew public.dictation_error_words%rowtype;
  v_next_node int;
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

  -- 查找对应的错词库记录
  select * into v_ew from public.dictation_error_words
  where member_id = p_member_id and subject = p_subject and answer = p_answer
  limit 1;

  if not p_is_correct then
    -- 答错：wrong_count + 1，新建或重置错词
    update public.dictation_task_words set wrong_count = coalesce(wrong_count, 0) + 1 where id = p_task_word_id;

    if v_ew is null then
      insert into public.dictation_error_words
        (member_id, subject, answer, cycle_start_date, current_node, next_review_date, status, last_review_date, review_history,
         review_count, error_count)
      values
        (p_member_id, p_subject, p_answer, v_today, 1, v_today + 1, 'in_progress', v_today,
         jsonb_build_array(jsonb_build_object('date', v_today::text, 'correct', false, 'action', 'new')),
         1, 1);
    else
      update public.dictation_error_words set
        cycle_start_date = v_today,
        current_node = 1,
        next_review_date = v_today + 1,
        status = 'in_progress',
        last_review_date = v_today,
        review_count = review_count + 1,
        error_count = error_count + 1,
        review_history = review_history || jsonb_build_object('date', v_today::text, 'correct', false, 'action', 'reset')
      where id = v_ew.id;
    end if;
  else
    -- 答对：推进节点（不看间隔，直接晋级）
    if v_ew is not null and v_ew.status = 'in_progress' then
      if v_ew.current_node = 15 then
        update public.dictation_error_words set
          status = 'completed',
          last_review_date = v_today,
          review_count = review_count + 1,
          review_history = review_history || jsonb_build_object('date', v_today::text, 'correct', true, 'action', 'completed')
        where id = v_ew.id;
      else
        v_next_node := case v_ew.current_node
          when 1 then 2 when 2 then 4 when 4 then 7 when 7 then 15
          else 15
        end;
        update public.dictation_error_words set
          current_node = v_next_node,
          next_review_date = v_today + v_next_node,
          last_review_date = v_today,
          review_count = review_count + 1,
          review_history = review_history || jsonb_build_object('date', v_today::text, 'correct', true, 'action', 'advance')
        where id = v_ew.id;
      end if;
    end if;
  end if;

  -- 星光不再实时发放
  return query select true, 'ok', 0;
end;
$$ language plpgsql security definer;

revoke all on function public.save_quick_review_record(uuid, uuid, uuid, text, text, boolean, text, int, int) from public;
grant execute on function public.save_quick_review_record(uuid, uuid, uuid, text, text, boolean, text, int, int) to anon, authenticated;
grant execute on function public.submit_dictation_result(uuid, uuid, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
