-- ============================================================
-- 0056: 挑战赛错题不再写入「错题本」
-- 用户需求：题目做错不要加入错题本（错题本是独立模块）。
-- 挑战赛自身的「再次挑战只出现错题」逻辑由 question_progress.is_mastered
-- 过滤实现（fetchActiveQuestions 已过滤已掌握题），不依赖 wrong_questions 表。
-- 本迁移重建 answer_question / answer_word，移除对 wrong_questions 的所有写入。
-- 错题本（wrong_questions）UI 仍可保留历史数据，PetLevelUpQuiz 在错题为空时
-- 会自动回退到随机题库。
-- ============================================================

-- 1) 重建 answer_question：移除 wrong_questions 写入
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
  v_set public.challenge_sets%rowtype;
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

  select * into v_set from public.challenge_sets where id = v_q.challenge_set_id;
  v_family_id := v_set.family_id;

  v_correct := lower(trim(p_answer)) = lower(trim(v_q.correct_answer));

  -- 查找或创建进度记录
  select * into v_prog from public.question_progress
    where member_id = p_member_id and question_id = p_question_id;
  if not found then
    insert into public.question_progress (member_id, question_id, attempt_count, correct_count, is_mastered, last_attempt_at)
    values (p_member_id, p_question_id, 0, 0, false, now())
    returning * into v_prog;
  end if;

  if v_correct then
    -- 每对1题固定1星光奖励
    v_reward := 1;
    v_now_mastered := true;

    select star_value into v_star from public.members where id = p_member_id for update;
    v_star := v_star + v_reward;
    update public.members set star_value = v_star, updated_at = now() where id = p_member_id;

    -- 更新 question_progress：答对1次即掌握（再次挑战时自动下线）
    update public.question_progress
    set attempt_count = attempt_count + 1,
        correct_count = correct_count + 1,
        is_mastered = true,
        last_attempt_at = now(),
        mastered_at = coalesce(mastered_at, now())
    where id = v_prog.id;
    -- 不再同步错题本（wrong_questions 表）
  else
    -- 答错：只更新进度，不写入错题本
    update public.question_progress
    set attempt_count = attempt_count + 1,
        last_attempt_at = now()
    where id = v_prog.id;
  end if;

  -- 记录答题
  insert into public.question_records (family_id, member_id, challenge_set_id, question_id, is_correct, reward_star)
  values (v_family_id, p_member_id, v_q.challenge_set_id, p_question_id, v_correct, v_reward);

  return query select v_correct, v_reward, v_now_mastered, v_bonus, v_star;
end;
$$;

grant execute on function public.answer_question(uuid, uuid, text) to anon, authenticated;

-- 2) 重建 answer_word：移除 wrong_questions 写入
drop function if exists public.answer_word(uuid, uuid, text, text, boolean);

create function public.answer_word(
  p_member_id uuid,
  p_word_id uuid,
  p_question_type text,
  p_answer text,
  p_is_familiar boolean default false
)
returns table(is_correct boolean, reward int, is_mastered boolean, new_star int)
language plpgsql security definer as $$
declare
  v_word public.words%rowtype;
  v_set public.challenge_sets%rowtype;
  v_family_id uuid;
  v_star int;
  v_reward int := 0;
  v_correct boolean;
  v_prog public.word_progress%rowtype;
  v_mastered boolean := false;
begin
  select * into v_word from public.words where id = p_word_id;
  if not found then raise exception '单词不存在'; end if;

  select * into v_set from public.challenge_sets where id = v_word.challenge_set_id;
  v_family_id := v_set.family_id;

  -- 判分
  if p_question_type = 'en2cn' then
    v_correct := lower(trim(p_answer)) = lower(trim(v_word.word_cn));
  elsif p_question_type = 'cn2en' then
    v_correct := lower(trim(p_answer)) = lower(trim(v_word.word_en));
  elsif p_question_type = 'listen' then
    v_correct := lower(trim(p_answer)) = lower(trim(v_word.word_cn));
  elsif p_question_type = 'spell' then
    v_correct := lower(trim(p_answer)) = lower(trim(v_word.word_en));
  else
    raise exception '题型错误';
  end if;

  -- 查找或创建进度
  select * into v_prog from public.word_progress where word_id = p_word_id and member_id = p_member_id;
  if not found then
    insert into public.word_progress (word_id, member_id)
    values (p_word_id, p_member_id)
    returning * into v_prog;
  end if;

  if v_correct then
    -- 单词无难度，统一使用中等奖励
    v_reward := v_set.reward_medium;
    select star_value into v_star from public.members where id = p_member_id for update;
    v_star := v_star + v_reward;
    update public.members set star_value = v_star, updated_at = now() where id = p_member_id;

    -- 更新进度
    if p_question_type = 'en2cn' then
      update public.word_progress set pass_en2cn = true where id = v_prog.id;
    elsif p_question_type = 'cn2en' then
      update public.word_progress set pass_cn2en = true where id = v_prog.id;
    elsif p_question_type = 'listen' then
      update public.word_progress set pass_listen = true where id = v_prog.id;
    elsif p_question_type = 'spell' then
      update public.word_progress set pass_spell = true where id = v_prog.id;
    end if;

    -- 熟悉模式：只考拼写，对就算掌握
    if p_is_familiar then
      update public.word_progress
      set is_mastered = true, is_familiar = true,
          pass_en2cn = true, pass_cn2en = true, pass_listen = true, pass_spell = true
      where id = v_prog.id;
      v_mastered := true;
    else
      select * into v_prog from public.word_progress where id = v_prog.id;
      if v_prog.pass_en2cn and v_prog.pass_cn2en and v_prog.pass_listen and v_prog.pass_spell then
        update public.word_progress set is_mastered = true where id = v_prog.id;
        v_mastered := true;
      end if;
    end if;
    -- 不再同步错题本
  else
    -- 答错：只更新 wrong_count，不写入错题本
    update public.word_progress
    set wrong_count = wrong_count + 1
    where id = v_prog.id;
  end if;

  -- 记录答题
  insert into public.question_records (family_id, member_id, challenge_set_id, word_id, is_correct, reward_star)
  values (v_family_id, p_member_id, v_word.challenge_set_id, p_word_id, v_correct, v_reward);

  return query select v_correct, v_reward, v_mastered, v_star;
end;
$$;

grant execute on function public.answer_word(uuid, uuid, text, text, boolean) to anon, authenticated;
