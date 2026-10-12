-- 0227: 修复选择题 correct_answer 存储选项文本而非字母时判错的问题
-- 当 correct_answer 不是纯字母(A-H)时，在 options 中查找匹配项并转为对应字母再比较

drop function if exists public.answer_question(uuid, uuid, text, text);

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
  v_new_wrong int;
  v_should_offline boolean;
  v_eff_easy int;
  v_eff_medium int;
  v_eff_hard int;
  v_base_reward int;
  v_norm_correct text;
  v_opt text;
  v_opt_idx int;
begin
  select * into v_q from public.questions where id = p_question_id;
  if not found then raise exception '题目不存在'; end if;

  select * into v_set from public.challenge_sets where id = v_q.challenge_set_id;
  select * into v_level from public.challenge_levels where id = v_q.level_id;

  v_eff_easy   := coalesce(v_set.reward_easy,   v_level.reward_easy,   2);
  v_eff_medium := coalesce(v_set.reward_medium, v_level.reward_medium, 3);
  v_eff_hard   := coalesce(v_set.reward_hard,   v_level.reward_hard,   4);

  v_base_reward := case v_q.difficulty
    when 'easy' then v_eff_easy
    when 'hard' then v_eff_hard
    else v_eff_medium
  end;

  select family_id into v_family_id from public.members where id = p_member_id;

  if v_q.type = 'fill_blank' then
    v_user_answers := string_to_array(p_answer, '||');
    v_equiv_answers1 := string_to_array(coalesce(v_q.correct_answer, ''), '/');
    v_equiv_answers2 := string_to_array(coalesce(v_q.answer2, ''), '/');

    if v_user_answers[1] is not null then
      v_ua := lower(btrim(v_user_answers[1]));
      v_blank1_ok := false;
      if v_equiv_answers1 is not null then
        foreach v_ea in array v_equiv_answers1 loop
          if lower(btrim(v_ea)) = v_ua then v_blank1_ok := true; exit; end if;
        end loop;
      end if;
    end if;

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
    -- 兼容 correct_answer 存选项文本的情况：纯字母直接用，否则在 options 中查找匹配字母
    if v_q.correct_answer ~ '^[A-Ha-h]+$' then
      v_norm_correct := v_q.correct_answer;
    else
      v_norm_correct := '';
      if v_q.options is not null then
        v_opt_idx := 0;
        for v_opt in select jsonb_array_elements_text(v_q.options) loop
          if lower(btrim(regexp_replace(v_opt, '^[A-Ha-h][.、\s]*', ''))) = lower(btrim(coalesce(v_q.correct_answer, ''))) then
            v_norm_correct := v_norm_correct || chr(65 + v_opt_idx);
          end if;
          v_opt_idx := v_opt_idx + 1;
        end loop;
      end if;
    end if;

    v_correct := (
      (select string_agg(c, '' order by c) from (
        select lower(ch) as c from unnest(string_to_array(lower(trim(p_answer)), NULL)) as t(ch) where ch ~ '[a-z]'
      ) s)
      =
      (select string_agg(c, '' order by c) from (
        select lower(ch) as c from unnest(string_to_array(lower(trim(v_norm_correct)), NULL)) as t(ch) where ch ~ '[a-z]'
      ) s)
    );
  else
    v_correct := lower(trim(p_answer)) = lower(trim(v_q.correct_answer));
  end if;

  select * into v_prog from public.question_progress
    where member_id = p_member_id and question_id = p_question_id;
  if not found then
    insert into public.question_progress (member_id, question_id, attempt_count, correct_count, wrong_count, is_mastered, last_attempt_at)
    values (p_member_id, p_question_id, 0, 0, 0, false, now())
    returning * into v_prog;
  end if;

  if v_correct then
    v_reward := greatest(0, v_base_reward - v_prog.wrong_count);
    if v_reward > 0 then
      select star_value into v_star from public.members where id = p_member_id for update;
      v_star := v_star + v_reward;
      update public.members set star_value = v_star, updated_at = now() where id = p_member_id;
      perform public.add_session_stars(p_member_id, v_reward);
    else
      select star_value into v_star from public.members where id = p_member_id;
    end if;

    update public.question_progress
    set attempt_count = attempt_count + 1,
        correct_count = correct_count + 1,
        is_mastered = true,
        last_attempt_at = now(),
        mastered_at = coalesce(mastered_at, now())
    where id = v_prog.id;

    v_new_wrong := v_prog.wrong_count;
  else
    select star_value into v_star from public.members where id = p_member_id;
    update public.question_progress
    set attempt_count = attempt_count + 1,
        wrong_count = wrong_count + 1,
        last_attempt_at = now()
    where id = v_prog.id;

    v_new_wrong := v_prog.wrong_count + 1;
  end if;

  -- 错题混战离线逻辑
  if p_source = 'wrong_battle' then
    v_should_offline := false;
    if v_correct and v_prog.wrong_count >= 2 then
      v_should_offline := true;
    end if;
    if not v_correct and v_new_wrong >= 3 then
      v_should_offline := true;
    end if;
    if v_should_offline then
      update public.wrong_battle_pool
      set is_offline = true, offline_at = now()
      where member_id = p_member_id and question_id = p_question_id and is_offline = false;
    end if;
  end if;

  if v_correct and not v_prog.is_mastered then
    v_now_mastered := true;
  end if;

  return query select v_correct, v_reward, v_prog.is_mastered, v_bonus, v_star;
end;
$$;

-- save_quick_review_record 的修复见 0228
