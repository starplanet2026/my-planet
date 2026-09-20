-- ============================================================
-- 0048: 萌宠闯关游戏重构
-- 1. 扩展 pet_words：增加 part_of_speech（词性）和 display_order（出题排序）
-- 2. 新增 game_level_results：每关结果（星级/奖励/使用的单词/错词/最后选词）
-- 3. 新增 game_word_stats：每用户每词挑战统计（挑战次数/错误次数）
-- 4. 新增 RPC：finish_game_level（结算关卡，按星级分层奖励）
-- ============================================================

-- 1. 扩展 pet_words 表
alter table public.pet_words add column if not exists part_of_speech text;
alter table public.pet_words add column if not exists display_order int default 0;
create index if not exists idx_pet_words_family_order on public.pet_words(family_id, display_order);

-- 2. 关卡结果表
create table if not exists public.game_level_results (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  level int not null,
  stars int not null default 0,
  reward_star int not null default 0,
  word_ids jsonb not null default '[]'::jsonb,
  wrong_word_ids jsonb not null default '[]'::jsonb,
  last_selected_word_ids jsonb not null default '[]'::jsonb,
  completed_at timestamptz not null default now(),
  unique (member_id, level)
);
create index if not exists idx_game_level_results_member on public.game_level_results(member_id);

-- RLS
alter table public.game_level_results enable row level security;
drop policy if exists "game_level_results_all" on public.game_level_results;
create policy "game_level_results_all" on public.game_level_results for all using (true) with check (true);

-- 3. 单词挑战统计表
create table if not exists public.game_word_stats (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  word_id uuid not null references public.pet_words(id) on delete cascade,
  challenge_count int not null default 0,
  wrong_count int not null default 0,
  last_played_at timestamptz,
  unique (member_id, word_id)
);
create index if not exists idx_game_word_stats_member on public.game_word_stats(member_id);

-- RLS
alter table public.game_word_stats enable row level security;
drop policy if exists "game_word_stats_all" on public.game_word_stats;
create policy "game_word_stats_all" on public.game_word_stats for all using (true) with check (true);

-- 4. RPC：结算关卡
-- 按星级分层奖励：3星=全部 / 2星=2/3 / 1星=1/3
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
  v_star := v_member.star_value + v_reward;
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

  -- 更新单词统计：每个使用的词 challenge_count+1，错词 wrong_count+1
  foreach v_word_id in array (select jsonb_array_elements_text(p_word_ids))
  loop
    insert into public.game_word_stats (family_id, member_id, word_id, challenge_count, wrong_count, last_played_at)
    values (p_family_id, p_member_id, v_word_id, 1, 0, now())
    on conflict (member_id, word_id) do update set
      challenge_count = game_word_stats.challenge_count + 1,
      last_played_at = now();
  end loop;
  foreach v_word_id in array (select jsonb_array_elements_text(p_wrong_word_ids))
  loop
    update public.game_word_stats set wrong_count = wrong_count + 1
    where member_id = p_member_id and word_id = v_word_id;
  end loop;

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
