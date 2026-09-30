-- 0179: 修复错题混战点击错误答案报错
-- 根因：wrong_battle_pool 只有部分唯一索引（WHERE status='active'），
--   0178 的 ON CONFLICT (member_id, question_id) 缺少 WHERE 子句，无法匹配部分索引，
--   PostgreSQL 抛出 "there is no unique or exclusion constraint matching the ON CONFLICT specification"
--   此错误仅在答错路径触发（答对路径用 UPDATE 不用 upsert），表现为"只有正确答案能点，错误答案报错"
-- 修复：将 wrong_battle_pool 的 upsert 改为 IF EXISTS 模式（与 0148 一致），避免 ON CONFLICT 匹配问题

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
  v_wrong public.wrong_questions%rowtype;
  v_wrong_found boolean;
  v_new_correct int;
  v_should_offline boolean := false;
  v_pool_exists boolean;
begin
  select * into v_q from public.questions where id = p_question_id;
  if not found then raise exception '题目不存在'; end if;

  select family_id into v_family_id from public.members where id = p_member_id;

  -- 判题逻辑
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
    v_reward := case v_q.difficulty
      when 'easy' then 1
      when 'hard' then 3
      else 2
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

    -- 查询 wrong_questions（不限制 status，统一处理）
    select * into v_wrong from public.wrong_questions
    where member_id = p_member_id and question_id = p_question_id;
    v_wrong_found := found;

    if v_wrong_found then
      v_new_correct := v_wrong.correct_count + 1;
      v_should_offline := v_new_correct >= v_wrong.wrong_count + 1;
      v_now_mastered := v_should_offline;

      update public.wrong_questions
      set correct_count = v_new_correct,
          status = case when v_should_offline then 'mastered' else 'active' end,
          offline_reason = case when v_should_offline then 'auto' else null end,
          offlined_at = case when v_should_offline then now() else null end
      where id = v_wrong.id;

      if v_should_offline then
        update public.wrong_battle_pool
        set status = 'offline', offline_reason = 'auto', offlined_at = now()
        where member_id = p_member_id and question_id = p_question_id and status = 'active';
      else
        update public.wrong_battle_pool
        set status = 'active', offline_reason = null, offlined_at = null
        where member_id = p_member_id and question_id = p_question_id;
      end if;
    else
      v_now_mastered := true;
    end if;
  else
    select star_value into v_star from public.members where id = p_member_id;

    update public.question_progress
    set attempt_count = attempt_count + 1,
        last_attempt_at = now()
    where id = v_prog.id;

    -- 答错：写入/更新 wrong_questions（有完整唯一约束，ON CONFLICT 可用）
    insert into public.wrong_questions
      (family_id, member_id, question_id, challenge_set_id, level_id, wrong_count, last_wrong_at, status)
    values
      (v_family_id, p_member_id, p_question_id, v_q.challenge_set_id, v_q.level_id, 1, now(), 'active')
    on conflict (member_id, question_id)
    do update set
      wrong_count = wrong_questions.wrong_count + 1,
      last_wrong_at = now(),
      status = 'active',
      offline_reason = null,
      offlined_at = null,
      level_id = coalesce(excluded.level_id, wrong_questions.level_id);

    -- 答错：确保错题大混战池有该题（active）
    -- 注意：wrong_battle_pool 只有部分唯一索引（WHERE status='active'），
    -- 不能用 ON CONFLICT (member_id, question_id)，改用 IF EXISTS 模式
    if exists (select 1 from public.wrong_battle_pool
               where member_id = p_member_id and question_id = p_question_id) then
      update public.wrong_battle_pool
      set status = 'active', offline_reason = null, offlined_at = null
      where member_id = p_member_id and question_id = p_question_id;
    else
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
