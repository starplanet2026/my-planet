-- 0236: 修复节点15不自动完成，保持 in_progress 并按 +15 天计算下次复习日

-- ============================================================
-- 一、修正存量数据：completed → in_progress, node=15, next_review_date = last_review_date + 15
-- ============================================================
update public.dictation_error_words
  set status = 'in_progress',
      current_node = 15,
      next_review_date = coalesce(last_review_date, current_date) + 15
  where status = 'completed';

-- 同步修正：所有 current_node=15 的 in_progress 词条，确保 next_review_date 正确
update public.dictation_error_words
  set next_review_date = coalesce(last_review_date, current_date) + 15
  where current_node = 15 and status = 'in_progress';

-- ============================================================
-- 二、重写 submit_dictation_result：节点15答对 → 保持15，next = today+15
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
  v_textbook text;
  v_unit_no int;
  v_unit_name text;
  v_page_no int;
  v_chinese text;
  v_pos text;
  v_pinyin text;
  v_text text;
  v_ew record;
  v_next_node int;
  v_today date := current_date;
  v_correct_count int := 0;
  v_error_count int := 0;
  v_total_star int := 0;
  v_star_per_word int;
  v_task record;
  v_word record;
begin
  -- 获取任务信息
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
    v_text := v_item->>'word_text';
    v_word_id := v_item->>'word_id';
    v_textbook := v_item->>'textbook_name';
    v_unit_no := (v_item->>'unit_no')::int;
    v_unit_name := v_item->>'unit_name';
    v_page_no := nullif(v_item->>'page_no', '')::int;
    v_chinese := v_item->>'chinese_meaning';
    v_pos := v_item->>'part_of_speech';
    v_pinyin := v_item->>'pinyin';

    if v_is_correct then
      v_correct_count := v_correct_count + 1;
    else
      v_error_count := v_error_count + 1;
    end if;

    -- 查找匹配的错词
    select * into v_ew from public.dictation_error_words
    where member_id = p_member_id and answer = v_answer and subject = v_subject
    limit 1;

    if not v_is_correct then
      -- 答错：重置节点为1
      if found then
        update public.dictation_error_words set
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
          (member_id, subject, textbook_name, unit_no, unit_name, page_no, chinese_meaning, part_of_speech, pinyin, answer,
           cycle_start_date, current_node, next_review_date, status, last_review_date, review_history, review_count, error_count)
        values
          (p_member_id, v_subject, coalesce(v_textbook,''), coalesce(v_unit_no,0), coalesce(v_unit_name,''), v_page_no,
           v_chinese, v_pos, v_pinyin, v_answer,
           v_today, 1, v_today + 1, 'in_progress', v_today,
           jsonb_build_array(jsonb_build_object('date', v_today::text, 'correct', false, 'action', 'new')),
           1, 1);
      end if;
    else
      -- 答对：推进节点
      if found and v_ew.status = 'in_progress' then
        if v_ew.current_node = 15 then
          -- 节点15答对 → 保持15，next = today + 15
          update public.dictation_error_words set
            current_node = 15,
            next_review_date = v_today + 15,
            last_review_date = v_today,
            review_count = review_count + 1,
            review_history = review_history || jsonb_build_object('date', v_today::text, 'correct', true, 'action', 'advance')
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
  end loop;

  v_total_star := v_correct_count * v_star_per_word;

  -- 更新任务状态为已完成
  update public.dictation_tasks set status = 'completed', updated_at = now() where id = p_task_id;

  return query select true, 'ok', v_correct_count, v_error_count, v_total_star, v_total_star;
end;
$$;

-- ============================================================
-- 三、重写 save_quick_review_record：节点15答对 → 保持15，next = today+15
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
  v_ew record;
  v_next_node int;
  v_today date := current_date;
  v_task record;
  v_word record;
begin
  -- 获取任务
  select * into v_task from public.dictation_tasks where id = p_task_id;
  if not found then
    return query select false, '任务不存在', 0;
    return;
  end if;

  -- 检查是否已记录过（同任务+同词条+同轮次）
  select * into v_word from public.dictation_quick_review_records
  where task_id = p_task_id and task_word_id = p_task_word_id and round_no = p_round_no
  limit 1;
  if found then
    return query select true, '已记录', 0;
    return;
  end if;

  -- 插入快速复习记录
  insert into public.dictation_quick_review_records
    (task_id, member_id, task_word_id, word_text, answer, is_correct, subject, round_no)
  values
    (p_task_id, p_member_id, p_task_word_id, p_word_text, p_answer, p_is_correct, p_subject, p_round_no);

  -- 查找匹配的错词
  select * into v_ew from public.dictation_error_words
  where member_id = p_member_id and answer = p_answer and subject = p_subject
  limit 1;

  if not p_is_correct then
    -- 答错：重置节点为1
    if found then
      update public.dictation_error_words set
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
    -- 答对：推进节点
    if found and v_ew.status = 'in_progress' then
      if v_ew.current_node = 15 then
        -- 节点15答对 → 保持15，next = today + 15
        update public.dictation_error_words set
          current_node = 15,
          next_review_date = v_today + 15,
          last_review_date = v_today,
          review_count = review_count + 1,
          review_history = review_history || jsonb_build_object('date', v_today::text, 'correct', true, 'action', 'advance')
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
$$;

notify pgrst, 'reload schema';
