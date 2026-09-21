-- ============================================================
-- 0053: 修复 finish_game_level RPC 的子查询错误
-- 问题：foreach v_word_id in array (select jsonb_array_elements_text(...)) 触发
-- "more than one row returned by a subquery used as an expression" 错误
-- 原因：array (select ...) 带空格的写法被 PostgreSQL 解析为标量子查询，
--       而 jsonb_array_elements_text 是集合返回函数，返回多行，触发错误
-- 修复：使用 array_agg 显式聚合到数组变量，再 foreach 遍历
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
begin
  -- 基础奖励查表
  v_base_reward := case
    when p_level between 1 and 20 then 9
    when p_level between 21 and 40 then 15
    when p_level between 41 and 60 then 21
    when p_level between 61 and 80 then 30
    when p_level between 81 and 100 then 36
    else 0
  end;
  -- 按星级折算
  if p_stars = 3 then v_reward := v_base_reward;
  elsif p_stars = 2 then v_reward := floor(v_base_reward * 2 / 3);
  elsif p_stars = 1 then v_reward := floor(v_base_reward / 3);
  else v_reward := 0;
  end if;

  -- 发放星光值
  select * into v_member from public.members where id = p_member_id for update;
  v_star := coalesce(v_member.star_value, 0) + v_reward;
  update public.members set star_value = v_star, updated_at = now() where id = p_member_id;

  -- 记录关卡结果（取最高星级）
  insert into public.game_level_results (family_id, member_id, level, stars, reward_star, word_ids, wrong_word_ids, last_selected_word_ids)
  values (p_family_id, p_member_id, p_level, p_stars, v_reward, p_word_ids, p_wrong_word_ids, p_last_selected_word_ids)
  on conflict (member_id, level) do update set
    stars = case when game_level_results.stars >= p_stars then game_level_results.stars else p_stars end,
    reward_star = case when game_level_results.stars >= p_stars then game_level_results.reward_star else v_reward end,
    word_ids = p_word_ids,
    wrong_word_ids = p_wrong_word_ids,
    last_selected_word_ids = p_last_selected_word_ids,
    completed_at = now();

  -- 把 jsonb 数组聚合为 text[] 数组变量（避免标量子查询错误）
  select array_agg(x::text) into v_word_ids_arr from jsonb_array_elements_text(p_word_ids) as x;
  select array_agg(x::text) into v_wrong_ids_arr from jsonb_array_elements_text(p_wrong_word_ids) as x;

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

  -- 解锁下一关（更新 pet_word_progress.unlocked_level）
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
