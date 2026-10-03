-- 0189: 宠物升级挑战答题逻辑与普通答题一致（计入进度、答对达标下线错题池）
-- 目的：升级挑战从错题池取题，答对达标后题目下线，确保每次刷新能拿到不同的题。
-- 与 answer_question 的区别：不发星光、不加 session stars，source='宠物升级挑战'。
-- 下线判定与 answer_question 完全一致：correct_count >= wrong_count + 1。

drop function if exists public.record_levelup_quiz_answer(uuid, uuid, boolean);

create function public.record_levelup_quiz_answer(
  p_member_id uuid,
  p_question_id uuid,
  p_is_correct boolean
)
returns void
language plpgsql security definer as $$
declare
  v_family_id uuid;
  v_q public.questions%rowtype;
  v_prog public.question_progress%rowtype;
  v_new_attempt int;
  v_new_correct int;
  v_new_wrong int;
  v_should_offline boolean;
begin
  select family_id into v_family_id from public.members where id = p_member_id;
  if not found then return; end if;

  select * into v_q from public.questions where id = p_question_id;
  if not found then return; end if;

  -- 1. upsert question_progress（与 answer_question 同一数据源）
  select * into v_prog from public.question_progress
    where member_id = p_member_id and question_id = p_question_id;
  if not found then
    insert into public.question_progress (member_id, question_id, attempt_count, correct_count, is_mastered, last_attempt_at)
    values (p_member_id, p_question_id, 0, 0, false, now())
    returning * into v_prog;
  end if;

  if p_is_correct then
    update public.question_progress
    set attempt_count = attempt_count + 1,
        correct_count = correct_count + 1,
        is_mastered = true,
        last_attempt_at = now(),
        mastered_at = coalesce(mastered_at, now())
    where id = v_prog.id;
  else
    update public.question_progress
    set attempt_count = attempt_count + 1,
        last_attempt_at = now()
    where id = v_prog.id;
  end if;

  -- 2. 下线判定（与 answer_question 完全一致）
  v_new_attempt := v_prog.attempt_count + 1;
  v_new_correct := v_prog.correct_count + (case when p_is_correct then 1 else 0 end);
  v_new_wrong := v_new_attempt - v_new_correct;
  v_should_offline := v_new_correct >= v_new_wrong + 1;

  -- 3. 同步 wrong_questions（保持与 question_progress 一致，向后兼容）
  if not p_is_correct then
    insert into public.wrong_questions
      (family_id, member_id, question_id, challenge_set_id, level_id, wrong_count, correct_count, last_wrong_at, status)
    values
      (v_family_id, p_member_id, p_question_id, v_q.challenge_set_id, v_q.level_id, v_new_wrong, v_new_correct, now(), 'active')
    on conflict (member_id, question_id)
    do update set
      wrong_count = v_new_wrong,
      correct_count = v_new_correct,
      last_wrong_at = now(),
      status = 'active',
      offline_reason = null,
      offlined_at = null,
      level_id = coalesce(excluded.level_id, wrong_questions.level_id);
  else
    update public.wrong_questions
    set wrong_count = v_new_wrong,
        correct_count = v_new_correct,
        status = case when v_should_offline then 'mastered' else 'active' end,
        offline_reason = case when v_should_offline then 'auto' else null end,
        offlined_at = case when v_should_offline then now() else null end
    where member_id = p_member_id and question_id = p_question_id;
  end if;

  -- 4. 更新 wrong_battle_pool 状态（答对达标下线，答错重新上线/入池）
  if exists (select 1 from public.wrong_battle_pool
             where member_id = p_member_id and question_id = p_question_id) then
    update public.wrong_battle_pool
    set status = case when v_should_offline then 'offline' else 'active' end,
        offline_reason = case when v_should_offline then 'auto' else null end,
        offlined_at = case when v_should_offline then now() else null end
    where member_id = p_member_id and question_id = p_question_id;
  elsif not p_is_correct then
    insert into public.wrong_battle_pool
      (family_id, member_id, question_id, source_challenge_set_id, source_level_id, status)
    values
      (v_family_id, p_member_id, p_question_id, v_q.challenge_set_id, v_q.level_id, 'active');
  end if;

  -- 5. 记录答题流水（不发星光）
  insert into public.question_records (family_id, member_id, challenge_set_id, question_id, is_correct, reward_star, source)
  values (v_family_id, p_member_id, v_q.challenge_set_id, p_question_id, p_is_correct, 0, '宠物升级挑战');
end;
$$;

grant execute on function public.record_levelup_quiz_answer(uuid, uuid, boolean) to anon, authenticated;
