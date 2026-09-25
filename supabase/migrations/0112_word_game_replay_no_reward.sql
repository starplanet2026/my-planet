-- 0112_word_game_replay_no_reward.sql
-- ① 回退 0111 对 answer_question 的改动（恢复智慧星战等场景正常发奖）
-- ② finish_game_level：已通关关卡重做时不发放星光值（仅单词消除闯关生效）

-- ===== ① 恢复 answer_question 到 0111 之前的版本 =====
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
begin
  select * into v_q from public.questions where id = p_question_id;
  if not found then raise exception '题目不存在'; end if;

  select family_id into v_family_id from public.members where id = p_member_id;

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
    v_reward := case v_q.difficulty
      when 'easy' then 1
      when 'hard' then 3
      else 2
    end;
    select star_value into v_star from public.members where id = p_member_id for update;
    v_star := v_star + v_reward;
    update public.members set star_value = v_star, updated_at = now() where id = p_member_id;

    update public.question_progress
    set attempt_count = attempt_count + 1,
        correct_count = correct_count + 1,
        is_mastered = true,
        last_attempt_at = now(),
        mastered_at = coalesce(mastered_at, now())
    where id = v_prog.id;

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

  insert into public.question_records (family_id, member_id, challenge_set_id, question_id, is_correct, reward_star)
  values (v_family_id, p_member_id, v_q.challenge_set_id, p_question_id, v_correct, v_reward);

  return query select v_correct, v_reward, v_now_mastered, v_bonus, v_star;
end;
$$;

revoke all on function public.answer_question(uuid, uuid, text) from public;
grant execute on function public.answer_question(uuid, uuid, text) to anon, authenticated;

-- ===== ② finish_game_level：已通关关卡重做不发星光值 =====
create or replace function public.finish_game_level(
  p_member_id uuid,
  p_family_id uuid,
  p_level integer,
  p_stars integer,
  p_word_ids jsonb,
  p_wrong_word_ids jsonb,
  p_last_selected_word_ids jsonb
)
returns table(success boolean, reward_star integer, new_star integer, new_unlocked_level integer)
language plpgsql security definer as $$
declare
  v_member public.members%rowtype;
  v_base_reward int;
  v_reward int;
  v_star int;
  v_new_unlocked int;
  v_word_id uuid;
  v_word_ids_arr text[];
  v_wrong_ids_arr text[];
  v_last_ids_arr text[];
  v_review_ids_arr text[];
  v_correct_ids_arr text[];
  v_old_order int;
  v_target int;
  v_review_row record;
  v_correct_review_row record;
  v_max_order int;
  v_shifted_count int;
  v_correct_row record;
begin
  v_base_reward := case
    when p_level between 1 and 20 then 5
    when p_level between 21 and 40 then 8
    when p_level between 41 and 60 then 10
    when p_level between 61 and 80 then 12
    when p_level between 81 and 100 then 15
    else 0
  end;
  v_reward := v_base_reward;

  -- 已通关关卡重做：不发星光值，保留原始通关奖励记录
  if exists (select 1 from public.game_level_results where member_id = p_member_id and level = p_level) then
    v_reward := 0;
  end if;

  if v_reward > 0 then
    select * into v_member from public.members where id = p_member_id for update;
    v_star := coalesce(v_member.star_value, 0) + v_reward;
    update public.members set star_value = v_star, updated_at = now() where id = p_member_id;
  else
    select star_value into v_star from public.members where id = p_member_id;
  end if;

  -- 记录关卡结果：重做时不覆盖原 reward_star
  insert into public.game_level_results (family_id, member_id, level, stars, reward_star, word_ids, wrong_word_ids, last_selected_word_ids)
  values (p_family_id, p_member_id, p_level, 3, v_reward, p_word_ids, p_wrong_word_ids, p_last_selected_word_ids)
  on conflict (member_id, level) do update set
    stars = 3,
    word_ids = p_word_ids,
    wrong_word_ids = p_wrong_word_ids,
    last_selected_word_ids = p_last_selected_word_ids,
    completed_at = now();

  select array_agg(x::text) into v_word_ids_arr from jsonb_array_elements_text(p_word_ids) as x;
  select array_agg(x::text) into v_wrong_ids_arr from jsonb_array_elements_text(p_wrong_word_ids) as x;
  select array_agg(x::text) into v_last_ids_arr from jsonb_array_elements_text(p_last_selected_word_ids) as x;

  select array_agg(distinct x) into v_review_ids_arr
  from unnest(array_cat(coalesce(v_wrong_ids_arr, ARRAY[]::text[]), coalesce(v_last_ids_arr, ARRAY[]::text[]))) as x;

  select array_agg(distinct x) into v_correct_ids_arr
  from unnest(array_cat(coalesce(v_word_ids_arr, ARRAY[]::text[]), ARRAY[]::text[])) as x
  where x <> all(coalesce(v_review_ids_arr, ARRAY[]::text[]));

  if v_word_ids_arr is not null then
    foreach v_word_id in array v_word_ids_arr loop
      insert into public.game_word_stats (family_id, member_id, word_id, challenge_count, wrong_count, last_played_at)
      values (p_family_id, p_member_id, v_word_id, 1, 0, now())
      on conflict (member_id, word_id) do update set challenge_count = game_word_stats.challenge_count + 1, last_played_at = now();
    end loop;
  end if;

  if v_wrong_ids_arr is not null then
    foreach v_word_id in array v_wrong_ids_arr loop
      update public.game_word_stats set wrong_count = wrong_count + 1
      where member_id = p_member_id and word_id = v_word_id;
    end loop;
  end if;

  -- ★ 步骤 A：复习成功的词回原位
  if v_word_ids_arr is not null then
    for v_correct_review_row in
      select id::text as wid, original_display_order as orig_order
      from public.pet_words
      where needs_review = true
        and id = any(v_word_ids_arr::uuid[])
        and (v_review_ids_arr is null or id <> all(v_review_ids_arr::uuid[]))
    loop
      if v_correct_review_row.orig_order is not null then
        update public.pet_words
        set display_order = display_order + 1
        where display_order >= v_correct_review_row.orig_order
          and id <> v_correct_review_row.wid::uuid;
        update public.pet_words
        set display_order = v_correct_review_row.orig_order, needs_review = false, original_display_order = null
        where id = v_correct_review_row.wid::uuid;
      else
        update public.pet_words set needs_review = false where id = v_correct_review_row.wid::uuid;
      end if;
    end loop;
  end if;

  select coalesce(max(display_order), 0) into v_max_order from public.pet_words;

  -- ★ 步骤 B：错词 + 最后消除词 往后移 20 位
  if v_review_ids_arr is not null then
    for v_review_row in
      select id::text as wid, display_order as old_order, needs_review as already_review, original_display_order as orig_order
      from public.pet_words
      where id = any(v_review_ids_arr::uuid[])
      order by display_order desc
    loop
      v_old_order := v_review_row.old_order;
      v_target := v_old_order + 20;

      update public.pet_words
      set display_order = display_order - 1
      where display_order > v_old_order and display_order <= v_target;

      update public.pet_words
      set display_order = v_target
      where id = v_review_row.wid::uuid;

      if v_review_row.already_review = false or v_review_row.already_review is null then
        update public.pet_words
        set needs_review = true, original_display_order = coalesce(v_review_row.orig_order, v_old_order)
        where id = v_review_row.wid::uuid;
      end if;
    end loop;
  end if;

  select coalesce(max(display_order), 0) into v_max_order from public.pet_words;

  -- ★ 步骤 C：正确消除的词移到词库末尾
  if v_correct_ids_arr is not null then
    for v_correct_row in
      select id::text as wid, display_order as old_order
      from public.pet_words
      where id = any(v_correct_ids_arr::uuid[])
        and (v_review_ids_arr is null or id <> all(v_review_ids_arr::uuid[]))
      order by display_order asc
    loop
      v_max_order := v_max_order + 1;
      update public.pet_words set display_order = v_max_order where id = v_correct_row.wid::uuid;
    end loop;
  end if;

  v_new_unlocked := p_level + 1;
  insert into public.pet_word_progress (family_id, member_id, total_rounds, total_matched, best_score, last_played_at, unlocked_level)
  values (p_family_id, p_member_id, 1, 0, 0, now(), v_new_unlocked)
  on conflict (member_id) do update set
    unlocked_level = greatest(pet_word_progress.unlocked_level, v_new_unlocked),
    last_played_at = now(),
    total_rounds = pet_word_progress.total_rounds + 1;

  return query select true, v_reward, v_star, v_new_unlocked;
end;
$$;

revoke all on function public.finish_game_level(uuid, uuid, int, int, jsonb, jsonb, jsonb) from public;
grant execute on function public.finish_game_level(uuid, uuid, int, int, jsonb, jsonb, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
