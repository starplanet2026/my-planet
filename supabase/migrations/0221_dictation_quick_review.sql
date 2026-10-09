-- 0221: 家默快速复习模式
-- 1. dictation_tasks 表新增 mode 字段（默认 dictation，兼容存量）
alter table public.dictation_tasks
  add column if not exists mode text not null default 'dictation'
  check (mode in ('dictation', 'quick_review'));

-- 2. 快速复习单条判题 RPC（正确→加星光值，错误→存入错词库，原子操作）
-- 不标记任务完成、不校验单日限制（快速复习支持多次进入）
create or replace function public.judge_quick_review_word(
  p_task_id uuid,
  p_member_id uuid,
  p_word jsonb,
  p_is_correct boolean,
  p_star_per_word int
)
returns table(success boolean, message text, new_star int)
language plpgsql security definer as $$
declare
  v_task record;
  v_member record;
  v_word_id uuid;
  v_error_word_id uuid;
  v_answer text;
  v_word_text text;
  v_subject text;
  v_textbook text;
  v_unit_no int;
  v_unit_name text;
  v_page_no int;
  v_chinese text;
  v_pos text;
  v_pinyin text;
  v_ew record;
  v_today date := current_date;
  v_new_star int;
  v_family_id uuid;
  v_star_amount int;
begin
  -- 校验任务归属
  select * into v_task from public.dictation_tasks
  where id = p_task_id and member_id = p_member_id and status = 'active';
  if not found then
    return query select false, '任务不存在或已完成', 0;
    return;
  end if;

  -- 解析词条数据
  v_word_id := nullif((p_word->>'word_id')::text, '')::uuid;
  v_error_word_id := nullif((p_word->>'error_word_id')::text, '')::uuid;
  v_answer := p_word->>'answer';
  v_word_text := coalesce(p_word->>'word_text', '');
  v_subject := coalesce(p_word->>'subject', v_task.subject);
  v_textbook := coalesce(p_word->>'textbook_name', '');
  v_unit_no := coalesce((p_word->>'unit_no')::int, 0);
  v_unit_name := coalesce(p_word->>'unit_name', '');
  v_page_no := nullif((p_word->>'page_no')::text, '')::int;
  v_chinese := p_word->>'chinese_meaning';
  v_pos := p_word->>'part_of_speech';
  v_pinyin := p_word->>'pinyin';

  -- 锁定成员行
  select * into v_member from public.members where id = p_member_id for update;
  if not found then
    return query select false, '用户不存在', 0;
    return;
  end if;
  v_family_id := v_member.family_id;

  -- 写入永久记录
  insert into public.dictation_records (task_id, member_id, subject, word_text, answer, is_correct)
  values (p_task_id, p_member_id, v_subject, v_word_text, coalesce(v_answer, ''), p_is_correct);

  if p_is_correct then
    -- 正确：发放星光值
    v_star_amount := coalesce(p_star_per_word, 1);
    v_new_star := v_member.star_value + v_star_amount;
    update public.members set star_value = v_new_star, updated_at = now() where id = p_member_id;
    insert into public.coin_records
      (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by, balance_type)
    values
      (v_family_id, p_member_id, v_star_amount, v_new_star,
       '快速复习正确', 'dictation', 'dictation_task', p_task_id::text, p_member_id::text, 'star');
  else
    -- 错误：存入错词库（upsert：存在则重置 cycle，不存在则新建）
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
        (p_member_id, v_subject, v_word_id, v_textbook, v_unit_no, v_unit_name, v_page_no,
         v_chinese, v_pos, v_pinyin, v_answer,
         v_today, 1, v_today + 1, 'in_progress', v_today,
         jsonb_build_array(jsonb_build_object('date', v_today::text, 'correct', false, 'action', 'new')));
    end if;

    v_new_star := v_member.star_value;
  end if;

  return query select true, '判题成功', v_new_star;
end;
$$;

grant execute on function public.judge_quick_review_word(uuid, uuid, jsonb, boolean, int) to anon, authenticated;
