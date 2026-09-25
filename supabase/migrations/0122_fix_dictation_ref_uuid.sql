-- 0122: 修复 submit_dictation_result 中 coin_records 插入的 uuid 类型错误
-- 问题：coin_records.ref_id 是 uuid、created_by 是 uuid not null，
--       但 0120 中插入了 p_task_id::text 与 p_member_id::text，导致：
--       column "ref_id" is of type uuid but expression is of type text
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
  v_overdue int;
  v_i int;
  v_next_node int;
  v_next_date date;
  v_exists boolean;
  v_today date := current_date;
  v_textbook text; v_unit_no int; v_unit_name text; v_page_no int;
  v_chinese text; v_pos text; v_pinyin text;
  v_family_id uuid;
  v_total int;
  v_new_star int;
begin
  -- 校验任务归属且状态为 active
  select * into v_task from public.dictation_tasks
  where id = p_task_id and member_id = p_member_id and status = 'active';
  if not found then
    return query select false, '任务不存在、无权操作或已完成', 0, 0, 0, 0;
    return;
  end if;
  v_subject := v_task.subject;

  -- 锁定成员行，准备发放星光值
  select * into v_member from public.members where id = p_member_id for update;
  if not found then
    return query select false, '用户不存在', 0, 0, 0, 0;
    return;
  end if;
  v_family_id := v_member.family_id;

  -- 同一任务单日仅允许完成一次校验
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

    if v_is_correct then
      v_correct := v_correct + 1;
    else
      v_error := v_error + 1;
    end if;

    -- 获取词条字段副本（用于错词库）；若词条已删除，回退使用入参 answer
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

    -- 处理错词库：错误 → 新建或重置；正确 → 推进节点
    if not v_is_correct then
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
          review_history = review_history || jsonb_build_object('date', v_today::text, 'correct', false, 'action', 'reset')
        where id = v_ew.id;
      else
        insert into public.dictation_error_words
          (member_id, subject, word_id, textbook_name, unit_no, unit_name, page_no, chinese_meaning, part_of_speech, pinyin, answer,
           cycle_start_date, current_node, next_review_date, status, last_review_date, review_history)
        values
          (p_member_id, v_subject, v_word_id, coalesce(v_textbook,''), coalesce(v_unit_no,0), coalesce(v_unit_name,''), v_page_no,
           v_chinese, v_pos, v_pinyin, v_answer,
           v_today, 1, v_today + 1, 'in_progress', v_today,
           jsonb_build_array(jsonb_build_object('date', v_today::text, 'correct', false, 'action', 'new')));
      end if;
    else
      select * into v_ew from public.dictation_error_words
      where member_id = p_member_id and answer = v_answer and subject = v_subject
      limit 1;

      if found and v_ew.status = 'in_progress' then
        if v_ew.current_node = 15 then
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
  end loop;

  -- 发放星光值（与批改同一事务，原子性保证）
  v_total := v_correct * coalesce(v_task.star_per_word, 1);
  v_new_star := v_member.star_value + v_total;
  if v_total > 0 then
    update public.members set star_value = v_new_star, updated_at = now() where id = p_member_id;
    insert into public.coin_records
      (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by, balance_type)
    values
      (v_family_id, p_member_id, v_total, v_new_star,
       '家默批改获得星光值', 'dictation', 'dictation_task', p_task_id, p_member_id, 'star');
  end if;

  -- 标记任务完成
  update public.dictation_tasks set status = 'completed', updated_at = now() where id = p_task_id;

  return query select true, '批改完成', v_correct, v_error, v_total, v_new_star;
end;
$$;
grant execute on function public.submit_dictation_result(uuid, uuid, jsonb) to anon, authenticated;
