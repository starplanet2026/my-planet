-- 0072: 修复 RPC 函数中对系统表 family_id 的引用
-- award_perfect_challenge_bonus: challenge_sets 不再有 family_id
-- finish_game_level: pet_words 不再有 family_id

-- ====== award_perfect_challenge_bonus ======
CREATE OR REPLACE FUNCTION public.award_perfect_challenge_bonus(p_member_id uuid, p_challenge_set_id uuid)
 RETURNS TABLE(awarded boolean, bonus integer, new_star integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_star int;
  v_bonus int := 10;
  v_total_count int;
  v_mastered_count int;
begin
  select count(*) into v_total_count from public.questions where challenge_set_id = p_challenge_set_id;
  select count(*) into v_mastered_count from public.question_progress
    where member_id = p_member_id and is_mastered = true
    and question_id in (select id from public.questions where challenge_set_id = p_challenge_set_id);

  if v_total_count = 0 or v_mastered_count < v_total_count then
    return query select false, 0, (select star_value from public.members where id = p_member_id);
    return;
  end if;

  begin
    insert into public.perfect_bonus_log (member_id, challenge_set_id, reward)
    values (p_member_id, p_challenge_set_id, v_bonus);
  exception when unique_violation then
    return query select false, 0, (select star_value from public.members where id = p_member_id);
    return;
  end;

  select star_value into v_star from public.members where id = p_member_id for update;
  v_star := v_star + v_bonus;
  update public.members set star_value = v_star, updated_at = now() where id = p_member_id;

  return query select true, v_bonus, v_star;
end;
$function$;

-- ====== finish_game_level ======
CREATE OR REPLACE FUNCTION public.finish_game_level(p_member_id uuid, p_family_id uuid, p_level integer, p_stars integer, p_word_ids jsonb, p_wrong_word_ids jsonb, p_last_selected_word_ids jsonb)
 RETURNS TABLE(success boolean, reward_star integer, new_star integer, new_unlocked_level integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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

  select * into v_member from public.members where id = p_member_id for update;
  v_star := coalesce(v_member.star_value, 0) + v_reward;
  update public.members set star_value = v_star, updated_at = now() where id = p_member_id;

  insert into public.game_level_results (family_id, member_id, level, stars, reward_star, word_ids, wrong_word_ids, last_selected_word_ids)
  values (p_family_id, p_member_id, p_level, 3, v_reward, p_word_ids, p_wrong_word_ids, p_last_selected_word_ids)
  on conflict (member_id, level) do update set
    stars = 3, reward_star = v_reward, word_ids = p_word_ids,
    wrong_word_ids = p_wrong_word_ids, last_selected_word_ids = p_last_selected_word_ids, completed_at = now();

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

  -- ★ 步骤 A：复习成功的词回原位（pet_words 已全局化，去掉 family_id 过滤）
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
$function$;
