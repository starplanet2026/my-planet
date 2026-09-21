-- ============================================================
-- 0061: 正确消除的词移到词库末尾，不再重复出现
-- 用户需求：
--   - 按单词表顺序出现，每关取 display_order 最小的 N 个
--   - 正确消除的词（没选错，不是最后1个）→ 移到末尾，不再出现
--   - 错词 + 最后1个消除词 → 往后移 20 位，重复 1 次复习
--
-- 逻辑顺序：A（复习成功回原位）→ B（错词+最后消除词往后移20）→ C（正确消除的词移到末尾）
-- ============================================================

create or replace function public.finish_game_level(
  p_member_id uuid,
  p_family_id uuid,
  p_level int,
  p_stars int,
  p_word_ids jsonb,
  p_wrong_word_ids jsonb,
  p_last_selected_word_ids jsonb
)
returns table(success boolean, reward_star int, new_star int, new_unlocked_level int)
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
  v_review_ids_arr text[];        -- 错词 + 最后消除词（需要往后移20位）
  v_correct_ids_arr text[];       -- 正确消除的词（移到末尾）
  v_old_order int;
  v_target int;
  v_review_row record;
  v_correct_review_row record;
  v_max_order int;
  v_shifted_count int;
  v_correct_row record;
begin
  -- 基础奖励查表（与词数相等）
  v_base_reward := case
    when p_level between 1 and 20 then 5
    when p_level between 21 and 40 then 8
    when p_level between 41 and 60 then 10
    when p_level between 61 and 80 then 12
    when p_level between 81 and 100 then 15
    else 0
  end;
  v_reward := v_base_reward;

  -- 发放星光值
  select * into v_member from public.members where id = p_member_id for update;
  v_star := coalesce(v_member.star_value, 0) + v_reward;
  update public.members set star_value = v_star, updated_at = now() where id = p_member_id;

  -- 记录关卡结果
  insert into public.game_level_results (family_id, member_id, level, stars, reward_star, word_ids, wrong_word_ids, last_selected_word_ids)
  values (p_family_id, p_member_id, p_level, 3, v_reward, p_word_ids, p_wrong_word_ids, p_last_selected_word_ids)
  on conflict (member_id, level) do update set
    stars = 3,
    reward_star = v_reward,
    word_ids = p_word_ids,
    wrong_word_ids = p_wrong_word_ids,
    last_selected_word_ids = p_last_selected_word_ids,
    completed_at = now();

  -- jsonb → text[]
  select array_agg(x::text) into v_word_ids_arr from jsonb_array_elements_text(p_word_ids) as x;
  select array_agg(x::text) into v_wrong_ids_arr from jsonb_array_elements_text(p_wrong_word_ids) as x;
  select array_agg(x::text) into v_last_ids_arr from jsonb_array_elements_text(p_last_selected_word_ids) as x;

  -- 合并错词 + 最后1个消除词（去重）→ 需要往后移20位的词
  select array_agg(distinct x) into v_review_ids_arr
  from unnest(
    array_cat(
      coalesce(v_wrong_ids_arr, ARRAY[]::text[]),
      coalesce(v_last_ids_arr, ARRAY[]::text[])
    )
  ) as x;

  -- 正确消除的词 = 这一关用过的词 - 错词 - 最后1个消除词
  select array_agg(distinct x) into v_correct_ids_arr
  from unnest(
    array_cat(
      coalesce(v_word_ids_arr, ARRAY[]::text[]),
      ARRAY[]::text[]
    )
  ) as x
  where x <> all(coalesce(v_review_ids_arr, ARRAY[]::text[]));

  -- 更新单词统计
  if v_word_ids_arr is not null then
    foreach v_word_id in array v_word_ids_arr loop
      insert into public.game_word_stats (family_id, member_id, word_id, challenge_count, wrong_count, last_played_at)
      values (p_family_id, p_member_id, v_word_id, 1, 0, now())
      on conflict (member_id, word_id) do update set
        challenge_count = game_word_stats.challenge_count + 1,
        last_played_at = now();
    end loop;
  end if;

  if v_wrong_ids_arr is not null then
    foreach v_word_id in array v_wrong_ids_arr loop
      update public.game_word_stats set wrong_count = wrong_count + 1
      where member_id = p_member_id and word_id = v_word_id;
    end loop;
  end if;

  -- ★ 步骤 A：处理"复习成功"的词
  -- 这一关正确消除的词中，如果有 needs_review=true 且不在错词/最后消除词列表 → 复习成功，回原位
  if v_word_ids_arr is not null then
    for v_correct_review_row in
      select id::text as wid, original_display_order as orig_order
      from public.pet_words
      where family_id = p_family_id
        and needs_review = true
        and id = any(v_word_ids_arr::uuid[])
        and (
          v_review_ids_arr is null
          or id <> all(v_review_ids_arr::uuid[])
        )
    loop
      if v_correct_review_row.orig_order is not null then
        -- 先腾出原位（把原位及之后的词下移1位）
        update public.pet_words
        set display_order = display_order + 1
        where family_id = p_family_id
          and display_order >= v_correct_review_row.orig_order
          and id <> v_correct_review_row.wid::uuid;
        -- 把词放回原位
        update public.pet_words
        set display_order = v_correct_review_row.orig_order,
            needs_review = false,
            original_display_order = null
        where id = v_correct_review_row.wid::uuid and family_id = p_family_id;
      else
        update public.pet_words
        set needs_review = false
        where id = v_correct_review_row.wid::uuid and family_id = p_family_id;
      end if;
    end loop;
  end if;

  -- 重新计算 max_order（A 步骤可能改变了一些位置）
  select coalesce(max(display_order), 0) into v_max_order
  from public.pet_words where family_id = p_family_id;

  -- ★ 步骤 B：错词 + 最后消除词 往后移 20 位（shift-and-insert）
  -- 按 display_order 降序处理，避免移位干扰
  if v_review_ids_arr is not null then
    for v_review_row in
      select id::text as wid,
             display_order as old_order,
             needs_review as already_review,
             original_display_order as orig_order
      from public.pet_words
      where family_id = p_family_id
        and id = any(v_review_ids_arr::uuid[])
      order by display_order desc
    loop
      v_old_order := v_review_row.old_order;
      v_target := v_old_order + 20;

      -- 把 (v_old_order, v_target] 区间的词整体下移 1 位
      update public.pet_words
      set display_order = display_order - 1
      where family_id = p_family_id
        and display_order > v_old_order
        and display_order <= v_target;

      -- 把 review 词放到目标位置
      update public.pet_words
      set display_order = v_target
      where id = v_review_row.wid::uuid and family_id = p_family_id;

      -- 标记 needs_review + 记录原位（如果是首次成为错词）
      if v_review_row.already_review = false or v_review_row.already_review is null then
        update public.pet_words
        set needs_review = true,
            original_display_order = coalesce(v_review_row.orig_order, v_old_order)
        where id = v_review_row.wid::uuid and family_id = p_family_id;
      end if;
    end loop;
  end if;

  -- 重新计算 max_order（B 步骤改变了位置）
  select coalesce(max(display_order), 0) into v_max_order
  from public.pet_words where family_id = p_family_id;

  -- ★ 步骤 C：正确消除的词（不在错词列表，不是最后1个）移到词库末尾
  -- 这些词不再出现在接下来的关卡中
  if v_correct_ids_arr is not null then
    for v_correct_row in
      select id::text as wid, display_order as old_order
      from public.pet_words
      where family_id = p_family_id
        and id = any(v_correct_ids_arr::uuid[])
        and (
          v_review_ids_arr is null
          or id <> all(v_review_ids_arr::uuid[])
        )
      order by display_order asc
    loop
      v_max_order := v_max_order + 1;
      update public.pet_words
      set display_order = v_max_order
      where id = v_correct_row.wid::uuid and family_id = p_family_id;
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
$$;

grant execute on function public.finish_game_level(uuid, uuid, int, int, jsonb, jsonb, jsonb) to anon, authenticated;
