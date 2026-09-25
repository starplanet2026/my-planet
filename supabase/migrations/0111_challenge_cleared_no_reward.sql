-- 0111_challenge_cleared_no_reward.sql
-- 萌宠闯关：已通关关卡再次作答不再发放星光值（level_clear_log 已存在则 reward=0）
-- 保持 answer_question 原返回签名：is_correct, reward, is_mastered, bonus_reward, new_star

drop function if exists public.answer_question(uuid, uuid, text);

create function public.answer_question(
  p_member_id uuid,
  p_question_id uuid,
  p_answer text
)
returns table(is_correct boolean, reward integer, is_mastered boolean, bonus_reward integer, new_star integer)
language plpgsql security definer as $$
declare
  v_q public.questions%rowtype;
  v_family_id uuid;
  v_star int;
  v_reward int := 0;
  v_bonus int := 0;
  v_correct boolean;
  v_prog public.question_progress%rowtype;
  v_now_mastered boolean := false;
  v_level_cleared boolean := false;
begin
  select * into v_q from public.questions where id = p_question_id;
  if not found then raise exception '题目不存在'; end if;

  select family_id into v_family_id from public.members where id = p_member_id;

  -- 是否已通关该关卡（已通关则不再发星光值）
  select exists (
    select 1 from public.level_clear_log
    where member_id = p_member_id and level_id = v_q.level_id
  ) into v_level_cleared;

  if v_q.type in ('choice','multi_choice','correct') then
    v_correct := (
      (select string_agg(c, '' order by c) from (
        select lower(ch) as c from unnest(string_to_array(lower(trim(p_answer)), NULL)) as t(ch) where ch ~ '[a-z]'
      ) s)
      =
      (select string_agg(c, '' order by c) from (
        select lower(ch) as c from unnest(string_to_array(lower(trim(v_q.correct_answer)), NULL)) as t(ch) where ch ~ '[a-z]'
      ) s)
    );
  else
    v_correct := lower(trim(p_answer)) = lower(trim(v_q.correct_answer));
  end if;

  select * into v_prog from public.question_progress
    where member_id = p_member_id and question_id = p_question_id;
  if not found then
    insert into public.question_progress (member_id, question_id, attempt_count, correct_count, is_mastered, last_attempt_at)
    values (p_member_id, p_question_id, 0, 0, false, now())
    returning * into v_prog;
  end if;

  if v_correct then
    v_now_mastered := true;

    if v_level_cleared then
      -- 已通关关卡：不发星光值，仅更新掌握状态与错题本
      v_reward := 0;
      select star_value into v_star from public.members where id = p_member_id;
    else
      v_reward := case v_q.difficulty
        when 'easy' then 1
        when 'hard' then 3
        else 2
      end;
      select star_value into v_star from public.members where id = p_member_id for update;
      v_star := v_star + v_reward;
      update public.members set star_value = v_star, updated_at = now() where id = p_member_id;
    end if;

    update public.question_progress
    set attempt_count = attempt_count + 1,
        correct_count = correct_count + 1,
        is_mastered = true,
        last_attempt_at = now(),
        mastered_at = coalesce(mastered_at, now())
    where id = v_prog.id;

    -- 答对：若在错题本中，correct_count+1，达到2次则标记 mastered（移出活跃错题）
    update public.wrong_questions
    set correct_count = correct_count + 1,
        status = case when correct_count + 1 >= 2 then 'mastered' else status end
    where member_id = p_member_id and question_id = p_question_id and status = 'active';
  else
    select star_value into v_star from public.members where id = p_member_id;

    update public.question_progress
    set attempt_count = attempt_count + 1,
        last_attempt_at = now()
    where id = v_prog.id;

    -- 答错：写入错题本（upsert，复用 (member_id, question_id) 部分唯一索引去重）
    insert into public.wrong_questions
      (family_id, member_id, question_id, challenge_set_id, level_id, wrong_count, last_wrong_at, status)
    values
      (v_family_id, p_member_id, p_question_id, v_q.challenge_set_id, v_q.level_id, 1, now(), 'active')
    on conflict (member_id, question_id)
    do update set
      wrong_count = wrong_questions.wrong_count + 1,
      last_wrong_at = now(),
      status = 'active',
      level_id = coalesce(excluded.level_id, wrong_questions.level_id);

    -- 答错：自动进入错题混战池（智慧星战所有关卡/题集来源）
    if not exists (
      select 1 from public.wrong_battle_pool
      where member_id = p_member_id and question_id = p_question_id and status = 'active'
    ) then
      insert into public.wrong_battle_pool
        (family_id, member_id, question_id, source_challenge_set_id, source_level_id, status)
      values
        (v_family_id, p_member_id, p_question_id, v_q.challenge_set_id, v_q.level_id, 'active');
    end if;
  end if;

  insert into public.question_records (family_id, member_id, challenge_set_id, question_id, is_correct, reward_star)
  values (v_family_id, p_member_id, v_q.challenge_set_id, p_question_id, v_correct, v_reward);

  return query select v_correct, v_reward, v_now_mastered, v_bonus, v_star;
end;
$$;

revoke all on function public.answer_question(uuid, uuid, text) from public;
grant execute on function public.answer_question(uuid, uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';
