-- 0261: 修复家默错词库节点逻辑漏洞
-- 背景（排查结论）：
--   1) 现行唯一判题链路「家长审核批改」approve_dictation_submission 的批改分支：
--      · 答对：对 dictation_error_words 完全无操作 → 节点永远不会推进、也不会完成；
--      · 答错：insert … where not exists 静默跳过已有词条 → 不重置节点、不计错误次数、不写复习历史。
--   2) 该链路不写 dictation_records → 答题目志缺失（孩子端 10-13 起的默写记录全部缺失）。
--   3) 完成语义（方案 B）：答对按 1→2→4→7→15 序列推进（到达第15节点共需 4 次连续答对），
--      在第15节点再答对 1 次（即第 5 次连续答对）才置为 status='completed'、next_review_date=null；
--      推进到第15节点时仍为 status='in_progress'、next_review_date = 当日 + 15。
--   4) submit_dictation_result（0237 起）丢失 dictation_records 写入，一并补回。

-- ============================================================
-- 一、重写 approve_dictation_submission：批改分支补齐错词库节点逻辑 + 补写答题日志
-- ============================================================
create or replace function public.approve_dictation_submission(p_submission_id uuid, p_reviewer_id uuid)
returns table(success boolean, message text, correct_count int, error_count int, total_star int)
language plpgsql security definer as $$
declare
  v_sub public.dictation_submissions%rowtype;
  v_task public.dictation_tasks%rowtype;
  v_item jsonb;
  v_correct int := 0;
  v_errors int := 0;
  v_star int := 0;
  v_family_id uuid;
  v_today date := current_date;
  v_ew public.dictation_error_words%rowtype;
  v_word_id uuid;
  v_error_word_id uuid;
  v_answer text;
  v_word_text text;
  v_is_correct boolean;
  v_next_node int;
  v_textbook text;
  v_unit_no int;
  v_unit_name text;
  v_page_no int;
  v_chinese text;
  v_pos text;
  v_pinyin text;
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

  -- 类型3：批改结果——按明细判分，并同步错词库节点/次数/历史、补写答题日志
  select * into v_task from public.dictation_tasks where id = v_sub.task_id;

  for v_item in select * from jsonb_array_elements(v_sub.results) loop
    v_word_id := nullif(v_item->>'word_id', '')::uuid;
    v_error_word_id := nullif(v_item->>'error_word_id', '')::uuid;
    v_answer := v_item->>'answer';
    v_word_text := coalesce(v_item->>'word_text', '');
    v_is_correct := (v_item->>'is_correct')::boolean;
    -- 每次迭代重置，避免沿用上一条明细的残留值
    v_textbook := null; v_unit_no := null; v_unit_name := null;
    v_page_no := null; v_chinese := null; v_pos := null; v_pinyin := null;

    -- 3.1 补写永久答题日志（此前审核链路完全缺失）
    insert into public.dictation_records (task_id, member_id, subject, word_text, answer, is_correct)
    values (v_sub.task_id, v_sub.member_id, v_task.subject, v_word_text, coalesce(v_answer, ''), v_is_correct);

    -- 3.2 词条元数据（用于新建错词）
    if v_word_id is not null then
      select textbook_name, unit_no, unit_name, page_no, chinese_meaning, part_of_speech, pinyin, answer
        into v_textbook, v_unit_no, v_unit_name, v_page_no, v_chinese, v_pos, v_pinyin, v_answer
      from public.dictation_words where id = v_word_id;
      if not found then
        v_answer := v_item->>'answer';
        v_textbook := null; v_unit_no := null; v_unit_name := null;
        v_page_no := null; v_chinese := null; v_pos := null; v_pinyin := null;
      end if;
    end if;

    -- 3.3 定位错词库记录：优先 error_word_id，其次按 answer 文本匹配
    v_ew := null;
    if v_error_word_id is not null then
      select * into v_ew from public.dictation_error_words where id = v_error_word_id;
    end if;
    if v_ew.id is null then
      select * into v_ew from public.dictation_error_words
       where member_id = v_sub.member_id and subject = v_task.subject and answer = v_answer
       limit 1;
    end if;
    -- 命中错词库：以库中答案文本为准，并与库中教材信息保持一致
    if v_ew.id is not null then
      v_answer := v_ew.answer;
      v_textbook := v_ew.textbook_name;
      v_unit_no := v_ew.unit_no;
      v_unit_name := v_ew.unit_name;
      v_page_no := v_ew.page_no;
      v_chinese := v_ew.chinese_meaning;
      v_pos := v_ew.part_of_speech;
      v_pinyin := v_ew.pinyin;
    end if;

    -- 3.4 同步错词库节点
    if v_is_correct then
      v_correct := v_correct + 1;
      if v_ew.id is not null and v_ew.status = 'in_progress' then
        if v_ew.current_node >= 15 then
          -- 已在第15节点答对 → 完成
          update public.dictation_error_words set
            status = 'completed',
            next_review_date = null,
            last_review_date = v_today,
            review_count = review_count + 1,
            review_history = review_history || jsonb_build_object('date', v_today::text, 'correct', true, 'action', 'completed')
          where id = v_ew.id;
        else
          v_next_node := case v_ew.current_node
            when 1 then 2 when 2 then 4 when 4 then 7 else 15
          end;
          -- 推进一级；推进到第15节点仍为进行中，需在第15节点再答对一次才完成
          update public.dictation_error_words set
            current_node = v_next_node,
            next_review_date = v_today + v_next_node,
            last_review_date = v_today,
            review_count = review_count + 1,
            review_history = review_history || jsonb_build_object('date', v_today::text, 'correct', true, 'action', 'advance')
          where id = v_ew.id;
        end if;
      end if;
    else
      v_errors := v_errors + 1;
      if v_ew.id is not null then
        -- 已有错词：重置到第1节点
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
        -- 新错词入库
        insert into public.dictation_error_words
          (member_id, subject, word_id, textbook_name, unit_no, unit_name, page_no, chinese_meaning, part_of_speech, pinyin, answer,
           cycle_start_date, current_node, next_review_date, status, last_review_date, review_history, review_count, error_count)
        values
          (v_sub.member_id, v_task.subject, v_word_id, coalesce(v_textbook, ''), coalesce(v_unit_no, 0), coalesce(v_unit_name, ''), v_page_no,
           v_chinese, v_pos, v_pinyin, coalesce(v_answer, ''),
           v_today, 1, v_today + 1, 'in_progress', v_today,
           jsonb_build_array(jsonb_build_object('date', v_today::text, 'correct', false, 'action', 'new')),
           1, 1);
      end if;
    end if;
  end loop;

  v_star := v_correct * coalesce(v_task.star_per_word, 1);
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
$$;

-- ============================================================
-- 二、重写 submit_dictation_result：补回 dictation_records 写入 + 方案B节点语义
-- ============================================================
create or replace function public.submit_dictation_result(
  p_task_id uuid,
  p_member_id uuid,
  p_results jsonb
) returns table(success boolean, message text, correct_count int, error_count int, total_star int, new_star int)
language plpgsql security definer as $$
declare
  v_item jsonb;
  v_answer text;
  v_is_correct boolean;
  v_subject text;
  v_word_id text;
  v_error_word_id text;
  v_textbook text;
  v_unit_no int;
  v_unit_name text;
  v_page_no int;
  v_chinese text;
  v_pos text;
  v_pinyin text;
  v_text text;
  v_ew public.dictation_error_words%rowtype;
  v_next_node int;
  v_today date := current_date;
  v_correct_count int := 0;
  v_error_count int := 0;
  v_total_star int := 0;
  v_star_per_word int;
  v_task record;
begin
  select * into v_task from public.dictation_tasks where id = p_task_id;
  if not found then
    return query select false, '任务不存在', 0, 0, 0, 0;
    return;
  end if;
  v_subject := v_task.subject;
  v_star_per_word := coalesce(v_task.star_per_word, 1);

  for v_item in select * from jsonb_array_elements(p_results)
  loop
    v_answer := v_item->>'answer';
    v_is_correct := (v_item->>'is_correct')::boolean;
    v_text := coalesce(v_item->>'word_text', '');
    v_word_id := nullif(v_item->>'word_id', '');
    v_error_word_id := nullif(v_item->>'error_word_id', '');
    v_textbook := null; v_unit_no := null; v_unit_name := null;
    v_page_no := null; v_chinese := null; v_pos := null; v_pinyin := null;

    -- 写入永久答题日志
    insert into public.dictation_records (task_id, member_id, subject, word_text, answer, is_correct)
    values (p_task_id, p_member_id, v_subject, v_text, coalesce(v_answer, ''), v_is_correct);

    if v_is_correct then
      v_correct_count := v_correct_count + 1;
    else
      v_error_count := v_error_count + 1;
    end if;

    -- 词条元数据（用于新建错词）
    if v_word_id is not null then
      select textbook_name, unit_no, unit_name, page_no, chinese_meaning, part_of_speech, pinyin, answer
        into v_textbook, v_unit_no, v_unit_name, v_page_no, v_chinese, v_pos, v_pinyin, v_answer
      from public.dictation_words where id = v_word_id::uuid;
      if not found then
        v_answer := v_item->>'answer';
        v_textbook := null; v_unit_no := null; v_unit_name := null;
        v_page_no := null; v_chinese := null; v_pos := null; v_pinyin := null;
      end if;
    end if;
    if v_error_word_id is not null then
      select * into v_ew from public.dictation_error_words where id = v_error_word_id::uuid;
      if found then
        v_answer := v_ew.answer;
        v_textbook := v_ew.textbook_name; v_unit_no := v_ew.unit_no; v_unit_name := v_ew.unit_name;
        v_page_no := v_ew.page_no; v_chinese := v_ew.chinese_meaning; v_pos := v_ew.part_of_speech; v_pinyin := v_ew.pinyin;
      end if;
    end if;

    select * into v_ew from public.dictation_error_words
    where member_id = p_member_id and answer = v_answer and subject = v_subject
    limit 1;

    if not v_is_correct then
      if v_ew.id is not null then
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
           cycle_start_date, current_node, next_review_date, status, last_review_date, review_history, review_count, error_count)
        values
          (p_member_id, v_subject, v_word_id::uuid, coalesce(v_textbook, ''), coalesce(v_unit_no, 0), coalesce(v_unit_name, ''), v_page_no,
           v_chinese, v_pos, v_pinyin, coalesce(v_answer, ''),
           v_today, 1, v_today + 1, 'in_progress', v_today,
           jsonb_build_array(jsonb_build_object('date', v_today::text, 'correct', false, 'action', 'new')),
           1, 1);
      end if;
    else
      if v_ew.id is not null and v_ew.status = 'in_progress' then
        if v_ew.current_node >= 15 then
          update public.dictation_error_words set
            status = 'completed',
            next_review_date = null,
            last_review_date = v_today,
            review_count = review_count + 1,
            review_history = review_history || jsonb_build_object('date', v_today::text, 'correct', true, 'action', 'completed')
          where id = v_ew.id;
        else
          v_next_node := case v_ew.current_node
            when 1 then 2 when 2 then 4 when 4 then 7 else 15
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

  v_total_star := v_correct_count * v_star_per_word;
  update public.dictation_tasks set status = 'completed', updated_at = now() where id = p_task_id;
  return query select true, 'ok', v_correct_count, v_error_count, v_total_star, v_total_star;
end;
$$;

-- ============================================================
-- 三、重写 save_quick_review_record（9参）：方案B节点语义
-- ============================================================
create or replace function public.save_quick_review_record(
  p_task_id uuid,
  p_member_id uuid,
  p_task_word_id uuid,
  p_word_text text,
  p_answer text,
  p_is_correct boolean,
  p_subject text,
  p_star_per_word int default 1,
  p_round_no int default 1
) returns table(success boolean, message text, star_gained int)
language plpgsql security definer as $$
declare
  v_ew public.dictation_error_words%rowtype;
  v_next_node int;
  v_today date := current_date;
  v_task record;
  v_word record;
begin
  select * into v_task from public.dictation_tasks where id = p_task_id;
  if not found then
    return query select false, '任务不存在', 0;
    return;
  end if;

  select * into v_word from public.dictation_quick_review_records
  where task_id = p_task_id and task_word_id = p_task_word_id and round_no = p_round_no
  limit 1;
  if found then
    return query select true, '已记录', 0;
    return;
  end if;

  insert into public.dictation_quick_review_records
    (task_id, member_id, task_word_id, word_text, answer, is_correct, subject, round_no)
  values
    (p_task_id, p_member_id, p_task_word_id, p_word_text, p_answer, p_is_correct, p_subject, p_round_no);

  select * into v_ew from public.dictation_error_words
  where member_id = p_member_id and answer = p_answer and subject = p_subject
  limit 1;

  if not p_is_correct then
    if v_ew.id is not null then
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
        (member_id, subject, textbook_name, unit_no, unit_name, page_no, chinese_meaning, part_of_speech, pinyin, answer,
         cycle_start_date, current_node, next_review_date, status, last_review_date, review_history, review_count, error_count)
      values
        (p_member_id, p_subject, '', 0, '', null, null, null, null, p_answer,
         v_today, 1, v_today + 1, 'in_progress', v_today,
         jsonb_build_array(jsonb_build_object('date', v_today::text, 'correct', false, 'action', 'new')),
         1, 1);
    end if;
  else
    if v_ew.id is not null and v_ew.status = 'in_progress' then
      if v_ew.current_node >= 15 then
        update public.dictation_error_words set
          status = 'completed',
          next_review_date = null,
          last_review_date = v_today,
          review_count = review_count + 1,
          review_history = review_history || jsonb_build_object('date', v_today::text, 'correct', true, 'action', 'completed')
        where id = v_ew.id;
      else
        v_next_node := case v_ew.current_node
          when 1 then 2 when 2 then 4 when 4 then 7 else 15
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

  return query select true, 'ok', 0;
end;
$$;

revoke all on function public.save_quick_review_record(uuid, uuid, uuid, text, text, boolean, text, int, int) from public;
grant execute on function public.save_quick_review_record(uuid, uuid, uuid, text, text, boolean, text, int, int) to anon, authenticated;
grant execute on function public.submit_dictation_result(uuid, uuid, jsonb) to anon, authenticated;
grant execute on function public.approve_dictation_submission(uuid, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
