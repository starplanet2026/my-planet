-- ============================================================
-- 0020: 智慧星战 - 分级别奖励 + 知识点
-- 1. challenge_sets.reward_star 拆分为 reward_easy/reward_medium/reward_hard
-- 2. 新增 knowledge_points 字段（答题前/答题中可查看）
-- 3. answer_question 根据题目 difficulty 选择对应奖励
-- 4. answer_word 默认使用 reward_medium（单词无难度分级）
-- ============================================================

-- 1. 新增列（先允许 null，便于迁移存量数据）
alter table public.challenge_sets
  add column if not exists reward_easy int,
  add column if not exists reward_medium int,
  add column if not exists reward_hard int,
  add column if not exists knowledge_points text;

-- 2. 存量数据迁移：将原 reward_star 复制到三档；若 reward_star 为空则用默认 5
update public.challenge_sets
  set reward_easy = coalesce(reward_star, 5),
      reward_medium = coalesce(reward_star, 5),
      reward_hard = coalesce(reward_star, 5)
  where reward_easy is null;

-- 3. 设置 NOT NULL + 默认值
alter table public.challenge_sets
  alter column reward_easy set not null,
  alter column reward_easy set default 3,
  alter column reward_medium set not null,
  alter column reward_medium set default 5,
  alter column reward_hard set not null,
  alter column reward_hard set default 8;

-- 4. 删除旧字段 reward_star（question_records.reward_points 保留为实际发放记录，不动）
alter table public.challenge_sets drop column if exists reward_star;

-- ============================================================
-- 重建 RPC：answer_question（根据题目难度选择奖励）
-- 签名不变，仅函数体变化，按项目惯例先 DROP 再 CREATE
-- ============================================================
drop function if exists public.answer_question(uuid, uuid, text);

create function public.answer_question(
  p_member_id uuid,
  p_question_id uuid,
  p_answer text
)
returns table(is_correct boolean, reward int, new_star int)
language plpgsql security definer as $$
declare
  v_q public.questions%rowtype;
  v_set public.challenge_sets%rowtype;
  v_family_id uuid;
  v_star int;
  v_reward int := 0;
  v_correct boolean;
begin
  select * into v_q from public.questions where id = p_question_id;
  if not found then raise exception '题目不存在'; end if;

  select * into v_set from public.challenge_sets where id = v_q.challenge_set_id;
  v_family_id := v_set.family_id;

  -- 判分（去除空格后比较）
  v_correct := lower(trim(p_answer)) = lower(trim(v_q.correct_answer));

  if v_correct then
    -- 按题目难度选择奖励
    v_reward := case
      when v_q.difficulty = 'easy' then v_set.reward_easy
      when v_q.difficulty = 'hard' then v_set.reward_hard
      else v_set.reward_medium
    end;
    -- 加星光值
    select star_value into v_star from public.members where id = p_member_id for update;
    v_star := v_star + v_reward;
    update public.members set star_value = v_star, updated_at = now() where id = p_member_id;

    -- 检查错题本：如果在错题本中，答对则 correct_count+1，达到2次则移除
    update public.wrong_questions
    set correct_count = correct_count + 1,
        status = case when correct_count + 1 >= 2 then 'mastered' else status end
    where member_id = p_member_id and question_id = p_question_id and status = 'active';
  else
    -- 答错：加入或更新错题本
    insert into public.wrong_questions (family_id, member_id, question_id, challenge_set_id, wrong_count, last_wrong_at)
    values (v_family_id, p_member_id, p_question_id, v_q.challenge_set_id, 1, now())
    on conflict (member_id, question_id)
    do update set wrong_count = wrong_questions.wrong_count + 1, last_wrong_at = now(), status = 'active';
  end if;

  -- 记录答题
  insert into public.question_records (family_id, member_id, challenge_set_id, question_id, is_correct, reward_star)
  values (v_family_id, p_member_id, v_q.challenge_set_id, p_question_id, v_correct, v_reward);

  return query select v_correct, v_reward, v_star;
end;
$$;

-- ============================================================
-- 重建 RPC：answer_word（单词无难度，使用 reward_medium）
-- ============================================================
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
  v_review_stage int;
  v_next_review timestamptz;
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
    -- 加星光值
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
      -- 检查4项是否全通过
      select * into v_prog from public.word_progress where id = v_prog.id;
      if v_prog.pass_en2cn and v_prog.pass_cn2en and v_prog.pass_listen and v_prog.pass_spell then
        update public.word_progress set is_mastered = true where id = v_prog.id;
        v_mastered := true;
      end if;
    end if;

    -- 如果之前在错题本中，更新
    update public.wrong_questions
    set correct_count = correct_count + 1,
        status = case when correct_count + 1 >= 2 then 'mastered' else status end
    where member_id = p_member_id and word_id = p_word_id and status = 'active';

  else
    -- 答错：更新 wrong_count，当天不重考
    update public.word_progress
    set wrong_count = wrong_count + 1,
        next_review_at = now() + interval '1 day'  -- 艾宾浩斯第1阶段：1天后
    where id = v_prog.id;

    -- 加入错题本
    insert into public.wrong_questions (family_id, member_id, word_id, challenge_set_id, wrong_count, last_wrong_at)
    values (v_family_id, p_member_id, p_word_id, v_word.challenge_set_id, 1, now())
    on conflict (member_id, word_id)
    do update set wrong_count = wrong_questions.wrong_count + 1, last_wrong_at = now(), status = 'active';
  end if;

  -- 记录答题
  insert into public.question_records (family_id, member_id, challenge_set_id, word_id, is_correct, reward_star)
  values (v_family_id, p_member_id, v_word.challenge_set_id, p_word_id, v_correct, v_reward);

  return query select v_correct, v_reward, v_mastered, v_star;
end;
$$;

-- 重新授权（DROP 后需要重新授权）
grant execute on function public.answer_question(uuid, uuid, text) to anon, authenticated;
grant execute on function public.answer_word(uuid, uuid, text, text, boolean) to anon, authenticated;
