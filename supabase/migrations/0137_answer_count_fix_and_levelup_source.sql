-- 0137: 修复今日答题数统计 + 纳入宠物升级挑战答题
--
-- 根因分析：
-- 1. 0118 重写 answer_word 时移除了写入 question_records 的语句，导致背单词答题不计入
-- 2. 错题混战池题目 challenge_set_id 为 null，前端加了 challenge_set_id is not null 过滤后
--    把全部答题记录排除，今日答题数归 0
--
-- 修复方案：
-- 1. question_records 新增 source 列，标记答题来源（错题混战/宠物升级挑战）
-- 2. answer_question: challenge_set_id 为 null 时 source='错题混战'
-- 3. answer_word: 恢复写入 question_records（source 留空，面板取 challenge_sets.title）
-- 4. 新增 record_levelup_quiz_answer RPC：宠物升级挑战答题记录（source='宠物升级挑战'）

-- ====== 1. question_records 新增 source 列 ======
alter table public.question_records
  add column if not exists source text;

comment on column public.question_records.source is '答题来源标识：错题混战/宠物升级挑战等，普通题集留空取 challenge_sets.title';

-- 回填历史数据：challenge_set_id 为空的旧记录标记为错题混战
update public.question_records set source = '错题混战'
where challenge_set_id is null and source is null;

-- ====== 2. 修复 answer_question：challenge_set_id 为 null 时标记来源 ======
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
  v_source text;
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
    perform public.add_session_stars(p_member_id, v_reward);

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

  -- 记录答题：错题混战（challenge_set_id 为空）标记 source
  v_source := case when v_q.challenge_set_id is null then '错题混战' else null end;
  insert into public.question_records (family_id, member_id, challenge_set_id, question_id, is_correct, reward_star, source)
  values (v_family_id, p_member_id, v_q.challenge_set_id, p_question_id, v_correct, v_reward, v_source);

  return query select v_correct, v_reward, v_now_mastered, v_bonus, v_star;
end;
$$;
revoke all on function public.answer_question(uuid, uuid, text) from public;
grant execute on function public.answer_question(uuid, uuid, text) to anon, authenticated;

-- ====== 3. 修复 answer_word：恢复写入 question_records ======
drop function if exists public.answer_word(uuid, uuid, text, text, boolean);
create or replace function public.answer_word(
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

  select * into v_prog from public.word_progress where word_id = p_word_id and member_id = p_member_id;
  if not found then
    insert into public.word_progress (word_id, member_id)
    values (p_word_id, p_member_id)
    returning * into v_prog;
  end if;

  if v_correct then
    v_reward := v_set.reward_star;
    select star_value into v_star from public.members where id = p_member_id for update;
    v_star := v_star + v_reward;
    update public.members set star_value = v_star, updated_at = now() where id = p_member_id;
    perform public.add_session_stars(p_member_id, v_reward);

    if p_question_type = 'en2cn' then
      update public.word_progress set pass_en2cn = true where id = v_prog.id;
    elsif p_question_type = 'cn2en' then
      update public.word_progress set pass_cn2en = true where id = v_prog.id;
    elsif p_question_type = 'listen' then
      update public.word_progress set pass_listen = true where id = v_prog.id;
    elsif p_question_type = 'spell' then
      update public.word_progress set pass_spell = true where id = v_prog.id;
    end if;

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

    update public.wrong_questions
    set correct_count = correct_count + 1,
        status = case when correct_count + 1 >= 2 then 'mastered' else status end
    where member_id = p_member_id and word_id = p_word_id and status = 'active';
  else
    select star_value into v_star from public.members where id = p_member_id;

    update public.word_progress set wrong_count = wrong_count + 1 where id = v_prog.id;

    insert into public.wrong_questions
      (family_id, member_id, word_id, challenge_set_id, wrong_count, last_wrong_at, status)
    values
      (v_family_id, p_member_id, p_word_id, v_word.challenge_set_id, 1, now(), 'active')
    on conflict (member_id, word_id)
    do update set
      wrong_count = wrong_questions.wrong_count + 1,
      last_wrong_at = now(),
      status = 'active';
  end if;

  -- 恢复写入答题记录（source 留空，面板取 challenge_sets.title 作为来源名）
  insert into public.question_records (family_id, member_id, challenge_set_id, word_id, is_correct, reward_star)
  values (v_family_id, p_member_id, v_word.challenge_set_id, p_word_id, v_correct, v_reward);

  return query select v_correct, v_reward, v_mastered, v_star;
end;
$$;
grant execute on function public.answer_word(uuid, uuid, text, text, boolean) to anon, authenticated;

-- ====== 4. 新增：宠物升级挑战答题记录 RPC ======
-- 宠物升级挑战在前端本地判分，调用此 RPC 记录每题答题（不发星光、不改进度）
create or replace function public.record_levelup_quiz_answer(
  p_member_id uuid,
  p_question_id uuid,
  p_is_correct boolean
)
returns void
language plpgsql security definer as $$
declare
  v_family_id uuid;
begin
  select family_id into v_family_id from public.members where id = p_member_id;
  if not found then return; end if;

  insert into public.question_records (family_id, member_id, question_id, is_correct, reward_star, source)
  values (v_family_id, p_member_id, p_question_id, p_is_correct, 0, '宠物升级挑战');
end;
$$;
grant execute on function public.record_levelup_quiz_answer(uuid, uuid, boolean) to anon, authenticated;

notify pgrst, 'reload schema';
