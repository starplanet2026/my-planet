-- ============================================================
-- 0054: 萌宠闯关游戏重构 v2
-- 1. 规范化 pet_words.display_order：NULL→0，加 NOT NULL + default 0
-- 2. 重写 finish_game_level：
--    a. 去掉星级分层奖励，全部消除即给固定奖励（与词数相等）
--    b. 错词 + 最后1个消除词 的 display_order 推到队尾（max+1, max+2, ...），
--       等待后续重复复习
-- 3. 关卡结果固定 stars=3（仅供UI兼容显示，不再用于奖励计算）
-- ============================================================

-- 1. 规范化 display_order
update public.pet_words set display_order = 0 where display_order is null;
alter table public.pet_words alter column display_order set default 0;
alter table public.pet_words alter column display_order set not null;

-- 2. 重写 finish_game_level
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
  v_review_ids_arr text[];
  v_max_order int;
  v_offset int := 0;
begin
  -- 基础奖励查表（与词数相等，不再按星级折算）
  v_base_reward := case
    when p_level between 1 and 20 then 5
    when p_level between 21 and 40 then 8
    when p_level between 41 and 60 then 10
    when p_level between 61 and 80 then 12
    when p_level between 81 and 100 then 15
    else 0
  end;
  -- 全部消除即通关，固定奖励
  v_reward := v_base_reward;

  -- 发放星光值
  select * into v_member from public.members where id = p_member_id for update;
  v_star := coalesce(v_member.star_value, 0) + v_reward;
  update public.members set star_value = v_star, updated_at = now() where id = p_member_id;

  -- 记录关卡结果（固定 stars=3，奖励固定为 v_reward）
  insert into public.game_level_results (family_id, member_id, level, stars, reward_star, word_ids, wrong_word_ids, last_selected_word_ids)
  values (p_family_id, p_member_id, p_level, 3, v_reward, p_word_ids, p_wrong_word_ids, p_last_selected_word_ids)
  on conflict (member_id, level) do update set
    stars = 3,
    reward_star = v_reward,
    word_ids = p_word_ids,
    wrong_word_ids = p_wrong_word_ids,
    last_selected_word_ids = p_last_selected_word_ids,
    completed_at = now();

  -- 把 jsonb 数组聚合为 text[] 数组变量（避免标量子查询错误）
  select array_agg(x::text) into v_word_ids_arr from jsonb_array_elements_text(p_word_ids) as x;
  select array_agg(x::text) into v_wrong_ids_arr from jsonb_array_elements_text(p_wrong_word_ids) as x;
  select array_agg(x::text) into v_last_ids_arr from jsonb_array_elements_text(p_last_selected_word_ids) as x;

  -- 合并错词 + 最后1个消除词（去重）
  select array_agg(distinct x) into v_review_ids_arr
  from unnest(
    array_cat(
      coalesce(v_wrong_ids_arr, ARRAY[]::text[]),
      coalesce(v_last_ids_arr, ARRAY[]::text[])
    )
  ) as x;

  -- 更新单词统计：每个使用的词 challenge_count+1，错词 wrong_count+1
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

  -- 把错词 + 最后1个消除词 的 display_order 推到队尾（max+1, max+2, ...），
  -- 等待后续重复复习
  select coalesce(max(display_order), 0) into v_max_order
  from public.pet_words where family_id = p_family_id;

  if v_review_ids_arr is not null then
    foreach v_word_id in array v_review_ids_arr loop
      v_offset := v_offset + 1;
      update public.pet_words
      set display_order = v_max_order + v_offset
      where id = v_word_id::uuid and family_id = p_family_id;
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
