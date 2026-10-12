-- 0228: 修复家默快速复习星光奖励递减逻辑
-- 1. dictation_task_words 增加 wrong_count 字段
-- 2. 重写 save_quick_review_record：恢复正确参数签名 + 奖励 = star_per_word - wrong_count（最低0）

-- ============================================================
-- 一、dictation_task_words 增加 wrong_count 字段
-- ============================================================
alter table public.dictation_task_words
  add column if not exists wrong_count int not null default 0;

-- ============================================================
-- 二、重写 save_quick_review_record
-- 恢复与前端一致的参数签名，修复奖励递减逻辑
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
  v_member_rec record;
  v_star int := 0;
  v_new_star int := 0;
  v_wrong int := 0;
begin
  -- 校验任务
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

  if p_is_correct then
    -- 正确：奖励 = 基础星光 - 累计答错次数，最低 0
    select wrong_count into v_wrong from public.dictation_task_words where id = p_task_word_id;
    v_star := greatest(0, p_star_per_word - coalesce(v_wrong, 0));
    if v_star > 0 then
      select family_id, star_value into v_member_rec from public.members where id = p_member_id;
      v_new_star := coalesce(v_member_rec.star_value, 0) + v_star;
      update public.members set star_value = star_value + v_star where id = p_member_id;
      insert into public.coin_records (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by, balance_type)
      values (v_member_rec.family_id, p_member_id, v_star, v_new_star, '快速复习正确奖励', 'task', 'dictation_quick_review', p_task_id, p_member_id, 'star');
    end if;
  else
    -- 错误：wrong_count + 1，存入全局错词库
    update public.dictation_task_words set wrong_count = wrong_count + 1 where id = p_task_word_id;
    insert into public.dictation_error_words
      (member_id, subject, answer, cycle_start_date, current_node, next_review_date, status, review_history)
    select p_member_id, p_subject, p_answer,
           current_date, 1, current_date + interval '1 day', 'in_progress', '[]'
    where not exists (
      select 1 from public.dictation_error_words
      where member_id = p_member_id and subject = p_subject and answer = p_answer
    );
  end if;

  return query select true, 'ok', v_star;
end;
$$ language plpgsql security definer;

revoke all on function public.save_quick_review_record(uuid, uuid, uuid, text, text, boolean, text, int, int) from public;
grant execute on function public.save_quick_review_record(uuid, uuid, uuid, text, text, boolean, text, int, int) to anon, authenticated;

notify pgrst, 'reload schema';
