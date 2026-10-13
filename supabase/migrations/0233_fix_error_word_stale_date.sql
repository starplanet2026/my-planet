-- 0233: 修复错词库 next_review_date 停留在过去的问题
-- 1. 一次性修正：所有 in_progress 且 next_review_date < today 的错词，日期改为 today
-- 2. save_quick_review_record 答对时推进错词节点（与 submit_dictation_result 一致）

-- ============================================================
-- 一、一次性数据修正
-- ============================================================
update public.dictation_error_words
  set next_review_date = current_date
  where status = 'in_progress'
    and next_review_date < current_date;

-- ============================================================
-- 二、重写 save_quick_review_record：答对时推进错词节点
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
  v_i int;
  v_next_node int;
  v_next_date date;
  v_overdue int;
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
    -- 错误：wrong_count + 1，存入/重置错词库
    update public.dictation_task_words set wrong_count = coalesce(wrong_count, 0) + 1 where id = p_task_word_id;

    if v_ew is null then
      -- 新错词
      insert into public.dictation_error_words
        (member_id, subject, answer, cycle_start_date, current_node, next_review_date, status, last_review_date, review_history)
      values
        (p_member_id, p_subject, p_answer, v_today, 1, v_today + 1, 'in_progress', v_today,
         jsonb_build_array(jsonb_build_object('date', v_today::text, 'correct', false, 'action', 'new')));
    else
      -- 已有错词：重置为第1天
      update public.dictation_error_words set
        cycle_start_date = v_today,
        current_node = 1,
        next_review_date = v_today + 1,
        status = 'in_progress',
        last_review_date = v_today,
        review_history = review_history || jsonb_build_object('date', v_today::text, 'correct', false, 'action', 'reset')
      where id = v_ew.id;
    end if;
  else
    -- 正确：推进错词节点（与 submit_dictation_result 逻辑一致）
    if v_ew is not null and v_ew.status = 'in_progress' then
      -- 先修正过时日期
      if v_ew.next_review_date < v_today then
        v_ew.next_review_date := v_today;
      end if;

      if v_ew.current_node = 15 then
        -- 完成
        update public.dictation_error_words set
          status = 'completed',
          last_review_date = v_today,
          review_history = review_history || jsonb_build_object('date', v_today::text, 'correct', true, 'action', 'completed')
        where id = v_ew.id;
      else
        v_i := case v_ew.current_node
          when 1 then 1 when 2 then 2 when 4 then 3 when 7 then 8 else 1
        end;
        v_next_node := case v_ew.current_node
          when 1 then 2 when 2 then 4 when 4 then 7 when 7 then 15 else 15
        end;
        v_overdue := (v_today - v_ew.next_review_date)::int;
        if v_overdue < 0 then v_overdue := 0; end if;

        if v_overdue > 2 * v_i or v_overdue > 7 then
          -- 严重逾期：重置
          update public.dictation_error_words set
            cycle_start_date = v_today,
            current_node = 1,
            next_review_date = v_today + 1,
            status = 'in_progress',
            last_review_date = v_today,
            review_history = review_history || jsonb_build_object('date', v_today::text, 'correct', true, 'action', 'reset_severe')
          where id = v_ew.id;
        elsif v_overdue > v_i then
          v_next_date := v_today + greatest(1, ceil(v_i::numeric / 2)::int);
          update public.dictation_error_words set
            current_node = v_next_node,
            next_review_date = v_next_date,
            last_review_date = v_today,
            review_history = review_history || jsonb_build_object('date', v_today::text, 'correct', true, 'action', 'moderate')
          where id = v_ew.id;
        else
          v_next_date := v_today + v_i;
          update public.dictation_error_words set
            current_node = v_next_node,
            next_review_date = v_next_date,
            last_review_date = v_today,
            review_history = review_history || jsonb_build_object('date', v_today::text, 'correct', true, 'action', 'mild')
          where id = v_ew.id;
        end if;
      end if;
    end if;
  end if;

  -- 星光不再实时发放，统一由完成复习提交审核后发放
  return query select true, 'ok', 0;
end;
$$ language plpgsql security definer;

revoke all on function public.save_quick_review_record(uuid, uuid, uuid, text, text, boolean, text, int, int) from public;
grant execute on function public.save_quick_review_record(uuid, uuid, uuid, text, text, boolean, text, int, int) to anon, authenticated;

notify pgrst, 'reload schema';
