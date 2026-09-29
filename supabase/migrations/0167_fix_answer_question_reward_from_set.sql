-- ====== 修复：answer_question 应读取题集 reward_easy/medium/hard，而非硬编码 1/2/3 ======
-- 根因：0165 重写 answer_question 时把奖励值硬编码为 easy=1 / hard=3 / 其他=2，
--       丢失了 0020 中"按题集配置的难度奖励"逻辑。
-- 用户反馈：数学天天练后台设定简单2、中级4、困难6，但实际简单题只发1星。
-- 修复：恢复读取 challenge_sets.reward_easy/medium/hard，按题目 difficulty 选择对应奖励；
--       题集无配置（错题混战等场景）时回退默认 easy=2/medium=4/hard=6。
-- 其他 0165 的逻辑（mastered 阈值、填空题判分、错题本、混战池、source 参数）保持不变。

drop function if exists public.answer_question(uuid, uuid, text, text);
create function public.answer_question(
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
  v_i int;
  v_ua text;
  v_ea text;
begin
  select * into v_q from public.questions where id = p_question_id;
  if not found then raise exception '题目不存在'; end if;

  -- 读取题集配置（challenge_set_id 可能为 null，如错题混战）
  select * into v_set from public.challenge_sets where id = v_q.challenge_set_id;

  select family_id into v_family_id from public.members where id = p_member_id;

  if v_q.type = 'fill_blank' then
    v_user_answers := string_to_array(p_answer, '||');
    v_equiv_answers1 := string_to_array(coalesce(v_q.correct_answer, ''), '/');
    v_equiv_answers2 := string_to_array(coalesce(v_q.answer2, ''), '/');

    v_ua := normalize_answer(coalesce(v_user_answers[1], ''));
    foreach v_ea in array v_equiv_answers1 loop
      if v_ua = normalize_answer(v_ea) and v_ua <> '' then
        v_blank1_ok := true;
      end if;
    end loop;

    if coalesce(v_q.answer2, '') <> '' then
      v_blank2_ok := false;
      v_ua := normalize_answer(coalesce(v_user_answers[2], ''));
      foreach v_ea in array v_equiv_answers2 loop
        if v_ua = normalize_answer(v_ea) and v_ua <> '' then
          v_blank2_ok := true;
        end if;
      end loop;
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

  if v_correct then
    v_now_mastered := true;
    -- 修复：按题目难度读取题集配置的奖励值；题集无配置或为空时回退默认 2/4/6
    v_reward := case v_q.difficulty
      when 'easy' then coalesce(v_set.reward_easy, 2)
      when 'hard' then coalesce(v_set.reward_hard, 6)
      when 'medium' then coalesce(v_set.reward_medium, 4)
      else coalesce(v_set.reward_medium, 4)
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

    -- 修复：正确次数须超过错误次数才标记 mastered
    update public.wrong_questions
    set correct_count = correct_count + 1,
        status = case when correct_count + 1 > wrong_count then 'mastered' else status end
    where member_id = p_member_id and question_id = p_question_id and status = 'active';
  else
    select star_value into v_star from public.members where id = p_member_id;

    update public.question_progress
    set attempt_count = attempt_count + 1,
        last_attempt_at = now()
    where id = v_prog.id;

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

  v_source := coalesce(p_source, case when v_q.challenge_set_id is null then '错题混战' else null end);
  insert into public.question_records (family_id, member_id, challenge_set_id, question_id, is_correct, reward_star, source)
  values (v_family_id, p_member_id, v_q.challenge_set_id, p_question_id, v_correct, v_reward, v_source);

  return query select v_correct, v_reward, v_now_mastered, v_bonus, v_star;
end;
$$;
revoke all on function public.answer_question(uuid, uuid, text, text) from public;
grant execute on function public.answer_question(uuid, uuid, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
