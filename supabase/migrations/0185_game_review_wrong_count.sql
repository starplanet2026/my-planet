-- 0185: 萌宠闯通关检测修复 —— 新增 review_wrong_count（待复习错误次数）
-- 背景：isBookCleared 要求 wrong_count===0，但 wrong_count 是历史累计错误且只增不减，
--       导致只要答错过任何词，词书就永远无法通关、无法自动进入下一本。
-- 方案：game_word_stats 新增 review_wrong_count（当前待复习错误次数）：
--   - 答错时：wrong_count + 1（历史累计，后台展示用，永不清零）
--              review_wrong_count + 1（通关判定用）
--   - 复习答对时（needs_review=true 且本关不在错词列表）：review_wrong_count = 0
--   - isBookCleared 判定改为 review_wrong_count === 0
-- 这样既保留历史错误次数供后台查看，又能让复习成功的词通过通关检测。

-- 1. 新增字段
alter table public.game_word_stats
  add column if not exists review_wrong_count int not null default 0;

-- 2. 回填：已有记录的 review_wrong_count = wrong_count（保留"未通关"状态，避免误清关）
update public.game_word_stats
set review_wrong_count = wrong_count
where review_wrong_count = 0 and wrong_count > 0;

-- 3. 重写 finish_game_level（基于 0154 版本，仅增加 review_wrong_count 处理）
CREATE OR REPLACE FUNCTION public.finish_game_level(
  p_member_id uuid,
  p_family_id uuid,
  p_level int,
  p_stars int,
  p_word_ids jsonb,
  p_wrong_word_ids jsonb,
  p_last_selected_word_ids jsonb
)
RETURNS TABLE(success boolean, reward_star int, new_star int, new_unlocked_level int)
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
declare
  v_member public.members%rowtype;
  v_base_reward int := 5;
  v_bonus int := 0;
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
  -- 统一奖励：基础5 + 每5关额外5
  if p_level % 5 = 0 then
    v_bonus := 5;
  end if;
  v_reward := v_base_reward + v_bonus;

  -- 发放星光值
  select * into v_member from public.members where id = p_member_id for update;
  v_star := coalesce(v_member.star_value, 0) + v_reward;
  update public.members set star_value = v_star, updated_at = now() where id = p_member_id;

  -- 记录关卡结果
  insert into public.game_level_results (family_id, member_id, level, stars, reward_star, word_ids, wrong_word_ids, last_selected_word_ids)
  values (p_family_id, p_member_id, p_level, 3, v_reward, p_word_ids, p_wrong_word_ids, p_last_selected_word_ids)
  on conflict (member_id, level) do update set
    stars = 3, reward_star = v_reward, word_ids = p_word_ids,
    wrong_word_ids = p_wrong_word_ids, last_selected_word_ids = p_last_selected_word_ids, completed_at = now();

  -- jsonb → text[]
  select array_agg(x::text) into v_word_ids_arr from jsonb_array_elements_text(p_word_ids) as x;
  select array_agg(x::text) into v_wrong_ids_arr from jsonb_array_elements_text(p_wrong_word_ids) as x;
  select array_agg(x::text) into v_last_ids_arr from jsonb_array_elements_text(p_last_selected_word_ids) as x;

  -- 合并错词 + 最后1个消除词（去重）→ 待复习词列表
  select array_agg(distinct x) into v_review_ids_arr
  from unnest(array_cat(coalesce(v_wrong_ids_arr, ARRAY[]::text[]), coalesce(v_last_ids_arr, ARRAY[]::text[]))) as x;

  -- 正确消除的词（不在复习列表中的）
  select array_agg(distinct x) into v_correct_ids_arr
  from unnest(array_cat(coalesce(v_word_ids_arr, ARRAY[]::text[]), ARRAY[]::text[])) as x
  where x <> all(coalesce(v_review_ids_arr, ARRAY[]::text[]));

  -- ★ 更新单词统计
  -- 所有本关出现的词：challenge_count + 1（review_wrong_count 不变）
  if v_word_ids_arr is not null then
    foreach v_word_id in array v_word_ids_arr loop
      insert into public.game_word_stats (family_id, member_id, word_id, challenge_count, wrong_count, review_wrong_count, last_played_at)
      values (p_family_id, p_member_id, v_word_id, 1, 0, 0, now())
      on conflict (member_id, word_id) do update set challenge_count = game_word_stats.challenge_count + 1, last_played_at = now();
    end loop;
  end if;

  -- 答错的词：wrong_count + 1（历史累计），review_wrong_count + 1（待复习）
  if v_wrong_ids_arr is not null then
    foreach v_word_id in array v_wrong_ids_arr loop
      update public.game_word_stats
      set wrong_count = wrong_count + 1,
          review_wrong_count = review_wrong_count + 1
      where member_id = p_member_id and word_id = v_word_id;
    end loop;
  end if;

  -- ★ 步骤 A：复习成功的词回原位 + review_wrong_count 清零
  -- 本关正确消除的词中，needs_review=true 且不在错词列表 → 复习成功
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

      -- 复习成功：该成员此词的待复习错误次数清零
      update public.game_word_stats
      set review_wrong_count = 0
      where member_id = p_member_id and word_id = v_correct_review_row.wid::uuid;
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

  -- 解锁下一关
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

REVOKE ALL ON FUNCTION public.finish_game_level(uuid, uuid, int, int, jsonb, jsonb, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.finish_game_level(uuid, uuid, int, int, jsonb, jsonb, jsonb) TO anon, authenticated;
