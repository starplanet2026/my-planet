-- 0108_record_wrong_questions.sql
-- 修复：关卡错题未进入"查看错题"
-- 根因：answer_question（0088/0106版）答错分支只更新 question_progress + 写入 wrong_battle_pool，
--       不再写入 wrong_questions 错题本表；而"查看错题"（fetchLevelWrongQuestionStats）
--       正是从 wrong_questions 读取，导致永远为空。
-- 修复：
--   1. wrong_questions 表新增 level_id 列（补齐关卡来源维度，原 challenge_set_id 保留）
--   2. 重写 answer_question：
--      - 答错：upsert 到 wrong_questions（wrong_count+1, status='active', 记录 set_id+level_id）
--      - 答对：若该题在错题本中且 status='active'，correct_count+1，>=2 则 status='mastered'
--   3. 保留 0106 的 wrong_battle_pool 自动入池逻辑
--   4. 萌宠闯关走 answer_word，本迁移不动 → 单词错词不进智慧星战错题本

-- ① wrong_questions 补关卡来源列
alter table public.wrong_questions
  add column if not exists level_id uuid references public.challenge_levels(id) on delete set null;

create index if not exists idx_wrong_questions_level on public.wrong_questions(level_id);

-- ② 重写 answer_question（基于 0106 版，追加 wrong_questions 写入）
drop function if exists public.answer_question(uuid, uuid, text);

create function public.answer_question(
  p_member_id uuid,
  p_question_id uuid,
  p_answer text
)
returns table(is_correct boolean, reward int, is_mastered boolean, bonus_reward int, new_star int)
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
    v_reward := case v_q.difficulty
      when 'easy' then 1
      when 'hard' then 3
      else 2
    end;
    v_now_mastered := true;

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

    -- 答对：若在错题本中，correct_count+1，达到2次则标记 mastered（移出活跃错题）
    update public.wrong_questions
    set correct_count = correct_count + 1,
        status = case when correct_count + 1 >= 2 then 'mastered' else status end
    where member_id = p_member_id and question_id = p_question_id and status = 'active';
  else
    update public.question_progress
    set attempt_count = attempt_count + 1,
        last_attempt_at = now()
    where id = v_prog.id;

    -- 答错：写入错题本（upsert，复用 (member_id, question_id) 部分唯一索引去重）
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

    -- 答错：自动进入错题混战池（智慧星战所有关卡/题集来源）
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

grant execute on function public.answer_question(uuid, uuid, text) to anon, authenticated;
notify pgrst, 'reload schema';
