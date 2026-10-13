-- 0237: 恢复节点15+答对=completed逻辑，next_review_date设为null

-- 先去掉 next_review_date 的 NOT NULL 约束
alter table public.dictation_error_words alter column next_review_date drop not null;

-- ============================================================
-- 一、修正存量数据：
--    review_history 中最后一条 correct=true 且 current_node=15 → status=completed, next_review_date=null
--    review_history 中最后一条 correct=false → status=in_progress (确保不误标)
-- ============================================================
update public.dictation_error_words ew
  set status = 'completed',
      next_review_date = null
  where current_node = 15
    and status = 'in_progress'
    and jsonb_typeof(ew.review_history) = 'array'
    and jsonb_array_length(ew.review_history) > 0
    and (ew.review_history -> jsonb_array_length(ew.review_history) - 1 ->> 'correct')::boolean = true;

-- 确保 last correct=false 的都是 in_progress
update public.dictation_error_words ew
  set status = 'in_progress'
  where current_node = 15
    and status = 'completed'
    and jsonb_typeof(ew.review_history) = 'array'
    and jsonb_array_length(ew.review_history) > 0
    and (ew.review_history -> jsonb_array_length(ew.review_history) - 1 ->> 'correct')::boolean = false;

-- completed 词条 next_review_date 统一设为 null
update public.dictation_error_words
  set next_review_date = null
  where status = 'completed';

-- ============================================================
-- 二、重写 submit_dictation_result RPC：
--    节点15答对 → completed, next_review_date=null
--    其他节点答对 → 推进, next=today+node
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

    select * into v_ew from public.dictation_error_words
    where member_id = p_member_id and answer = v_answer and subject = v_subject
    limit 1;

    if not v_is_correct then
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
          (p_member_id, v_subject, coalesce(v_textbook,''), coalesce(v_unit_no,0), coalesce(v_unit_name,''), v_page_no,
           v_chinese, v_pos, v_pinyin, v_answer,
           v_today, 1, v_today + 1, 'in_progress', v_today,
           jsonb_build_array(jsonb_build_object('date', v_today::text, 'correct', false, 'action', 'new')),
           1, 1);
      end if;
    else
      if found and v_ew.status = 'in_progress' then
        if v_ew.current_node = 15 then
          -- 节点15答对 → completed
          update public.dictation_error_words set
            status = 'completed',
            next_review_date = null,
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
  end loop;

  v_total_star := v_correct_count * v_star_per_word;
  update public.dictation_tasks set status = 'completed', updated_at = now() where id = p_task_id;
  return query select true, 'ok', v_correct_count, v_error_count, v_total_star, v_total_star;
end;
$$;

-- ============================================================
-- 三、重写 save_quick_review_record RPC：同上逻辑
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
    if found and v_ew.status = 'in_progress' then
      if v_ew.current_node = 15 then
        update public.dictation_error_words set
          status = 'completed',
          next_review_date = null,
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

  return query select true, 'ok', 0;
end;
$$;

notify pgrst, 'reload schema';
