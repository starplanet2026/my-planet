-- 0183: 修复英语天天练等独立关卡奖励星光值翻倍问题
-- 背景：0180 迁移重写 answer_question 时，将无题集配置时的默认奖励设为 2/4/6，
--   而英语天天练等独立关卡 challenge_set_id 为 null，读不到题集 reward 配置，
--   导致实际奖励 2/4/6，与后台设置的 1/2/3 不符。
-- 修复：当 challenge_set_id 为空时，从题目所属关卡(challenge_levels.subject)读取学科，
--   英语默认 1/2/3，其他学科默认 2/4/6；有题集配置时仍以题集 reward_easy/medium/hard 为准。

create or replace function public.answer_question(
  p_member_id uuid,
  p_question_id uuid,
  p_answer text,
  p_source text default null
)
returns table(is_correct boolean, reward integer, is_mastered boolean, bonus_reward integer, new_star integer)
language plpgsql security definer as $$
declare
  v_q public.questions%rowtype;
  v_set public.challenge_sets%rowtype;
  v_level public.challenge_levels%rowtype;
  v_family_id uuid;
  v_star int;
  v_reward int := 0;
  v_bonus int := 0;
  v_correct boolean;
  v_prog public.question_progress%rowtype;
  v_now_mastered boolean := false;
  v_source text;
  v_user_answers text[];
  v_equiv_answers1 text[];
  v_equiv_answers2 text[];
  v_blank1_ok boolean := false;
  v_blank2_ok boolean := true;
  v_ua text;
  v_ea text;
  v_new_attempt int;
  v_new_correct int;
  v_new_wrong int;
  v_should_offline boolean;
  -- 学科感知的默认奖励：英语 1/2/3，其他 2/4/6
  v_def_easy int;
  v_def_medium int;
  v_def_hard int;
  v_subject text;
begin
  select * into v_q from public.questions where id = p_question_id;
  if not found then raise exception '题目不存在'; end if;

  -- 读取题集奖励配置（challenge_set_id 可能为 null，如错题混战/独立关卡）
  select * into v_set from public.challenge_sets where id = v_q.challenge_set_id;

  -- 读取题目所属关卡（独立关卡场景下用于判定学科）
  select * into v_level from public.challenge_levels where id = v_q.level_id;

  -- 学科来源：关卡.subject（challenge_sets 无 subject 字段）
  v_subject := v_level.subject;

  -- 英语学科默认 1/2/3，其他学科默认 2/4/6
  if v_subject = '英语' then
    v_def_easy := 1; v_def_medium := 2; v_def_hard := 3;
  else
    v_def_easy := 2; v_def_medium := 4; v_def_hard := 6;
  end if;

  select family_id into v_family_id from public.members where id = p_member_id;

  -- 判题逻辑
  if v_q.type = 'fill_blank' then
    v_user_answers := string_to_array(p_answer, '||');
    v_equiv_answers1 := string_to_array(coalesce(v_q.correct_answer, ''), '/');
    v_equiv_answers2 := string_to_array(coalesce(v_q.answer2, ''), '/');

    -- 第一空
    if v_user_answers[1] is not null then
      v_ua := lower(btrim(v_user_answers[1]));
      v_blank1_ok := false;
      if v_equiv_answers1 is not null then
        foreach v_ea in array v_equiv_answers1 loop
          if lower(btrim(v_ea)) = v_ua then v_blank1_ok := true; exit; end if;
        end loop;
      end if;
    end if;

    -- 第二空（可选）
    v_blank2_ok := true;
    if v_q.answer2 is not null and btrim(v_q.answer2) <> '' then
      v_blank2_ok := false;
      if array_length(v_user_answers, 1) >= 2 and v_user_answers[2] is not null then
        v_ua := lower(btrim(v_user_answers[2]));
        if v_equiv_answers2 is not null then
          foreach v_ea in array v_equiv_answers2 loop
            if lower(btrim(v_ea)) = v_ua then v_blank2_ok := true; exit; end if;
          end loop;
        end if;
      end if;
    end if;

    v_correct := v_blank1_ok and v_blank2_ok;
  elsif v_q.type in ('choice','multi_choice','correct') then
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

  -- 更新 question_progress（单一真值来源）
  if v_correct then
    -- 按题目难度读取题集配置的奖励值；题集无配置时回退学科默认值（英语 1/2/3，其他 2/4/6）
    v_reward := case v_q.difficulty
      when 'easy' then coalesce(v_set.reward_easy, v_def_easy)
      when 'hard' then coalesce(v_set.reward_hard, v_def_hard)
      when 'medium' then coalesce(v_set.reward_medium, v_def_medium)
      else coalesce(v_set.reward_medium, v_def_medium)
    end;
    select star_value into v_star from public.members where id = p_member_id for update;
    v_star := v_star + v_reward;
    update public.members set star_value = v_star, updated_at = now() where id = p_member_id;
    perform public.add_session_stars(p_member_id, v_reward);

    update public.question_progress
    set attempt_count = attempt_count + 1,
        correct_count = correct_count + 1,
        is_mastered = true,
        last_attempt_at = now(),
        mastered_at = coalesce(mastered_at, now())
    where id = v_prog.id;
  else
    select star_value into v_star from public.members where id = p_member_id;
    update public.question_progress
    set attempt_count = attempt_count + 1,
        last_attempt_at = now()
    where id = v_prog.id;
  end if;

  -- 从 question_progress 推导最新计数（保证 答对 + 答错 = 总作答 恒成立）
  v_new_attempt := v_prog.attempt_count + 1;
  v_new_correct := v_prog.correct_count + (case when v_correct then 1 else 0 end);
  v_new_wrong := v_new_attempt - v_new_correct;
  v_should_offline := v_new_correct >= v_new_wrong + 1;
  v_now_mastered := v_should_offline;

  -- 同步 wrong_questions：答错时创建/更新；答对时若存在记录则同步计数与状态
  if not v_correct then
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

  -- 同步错题混战池状态
  if exists (select 1 from public.wrong_battle_pool
             where member_id = p_member_id and question_id = p_question_id) then
    update public.wrong_battle_pool
    set status = case when v_should_offline then 'offline' else 'active' end,
        offline_reason = case when v_should_offline then 'auto' else null end,
        offlined_at = case when v_should_offline then now() else null end
    where member_id = p_member_id and question_id = p_question_id;
  elsif not v_correct then
    insert into public.wrong_battle_pool
      (family_id, member_id, question_id, source_challenge_set_id, source_level_id, status)
    values
      (v_family_id, p_member_id, p_question_id, v_q.challenge_set_id, v_q.level_id, 'active');
  end if;

  v_source := coalesce(p_source, case when v_q.challenge_set_id is null then '错题混战' else null end);
  insert into public.question_records (family_id, member_id, challenge_set_id, question_id, is_correct, reward_star, source)
  values (v_family_id, p_member_id, v_q.challenge_set_id, p_question_id, v_correct, v_reward, v_source);

  return query select v_correct, v_reward, v_now_mastered, v_bonus, v_star;
end;
$$;
revoke all on function public.answer_question(uuid, uuid, text, text) from public;
grant execute on function public.answer_question(uuid, uuid, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
