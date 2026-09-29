-- 0148: 错题下线与后台管理
-- 1. 表结构变更：wrong_battle_pool 和 wrong_questions 新增 offline_reason / offlined_at
-- 2. wrong_battle_pool.status 从 ('active','removed') 改为 ('active','offline')
-- 3. answer_question / answer_word / review_wrong_question：下线规则改为 correct_count >= wrong_count + 1
-- 4. 后台管理 RPC：手动下线、重新上线、永久删除、获取已下线池

-- ============================================================
-- ① 表结构变更
-- ============================================================

-- wrong_battle_pool 新增下线相关字段
alter table public.wrong_battle_pool
  add column if not exists offline_reason text,
  add column if not exists offlined_at timestamptz;

-- wrong_questions 新增下线相关字段
alter table public.wrong_questions
  add column if not exists offline_reason text,
  add column if not exists offlined_at timestamptz;

-- 迁移历史 status='removed' 为 'offline'
update public.wrong_battle_pool set status = 'offline', offline_reason = 'manual' where status = 'removed';

-- 更新 wrong_battle_pool.status check 约束
alter table public.wrong_battle_pool drop constraint if exists wrong_battle_pool_status_check;
alter table public.wrong_battle_pool
  add constraint wrong_battle_pool_status_check
  check (status in ('active','offline')) not valid;

-- wrong_questions.status 已有 ('active','mastered')，mastered 表示自动下线，无需改约束

-- ============================================================
-- ② answer_question：下线规则 correct_count >= wrong_count + 1
-- ============================================================

drop function if exists public.answer_question(uuid, uuid, text, text);
create function public.answer_question(
  p_member_id uuid,
  p_question_id uuid,
  p_answer text,
  p_source text default null
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
  v_wrong public.wrong_questions%rowtype;
  v_should_offline boolean := false;
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
    v_now_mastered := false;
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

    -- 答对：错题本 correct_count+1，达标则自动下线
    select * into v_wrong from public.wrong_questions
    where member_id = p_member_id and question_id = p_question_id and status = 'active';

    if found then
      v_should_offline := (v_wrong.correct_count + 1) >= (v_wrong.wrong_count + 1);
      v_now_mastered := v_should_offline;

      update public.wrong_questions
      set correct_count = correct_count + 1,
          status = case when v_should_offline then 'mastered' else status end,
          offline_reason = case when v_should_offline then 'auto' else offline_reason end,
          offlined_at = case when v_should_offline then now() else offlined_at end
      where id = v_wrong.id;

      -- 同步将错题大混战池中该题下线
      if v_should_offline then
        update public.wrong_battle_pool
        set status = 'offline', offline_reason = 'auto', offlined_at = now()
        where member_id = p_member_id and question_id = p_question_id and status = 'active';
      end if;
    end if;
  else
    select star_value into v_star from public.members where id = p_member_id;

    update public.question_progress
    set attempt_count = attempt_count + 1,
        last_attempt_at = now()
    where id = v_prog.id;

    -- 答错：写入错题本（upsert）
    insert into public.wrong_questions
      (family_id, member_id, question_id, challenge_set_id, level_id, wrong_count, last_wrong_at, status)
    values
      (v_family_id, p_member_id, p_question_id, v_q.challenge_set_id, v_q.level_id, 1, now(), 'active')
    on conflict (member_id, question_id)
    do update set
      wrong_count = wrong_questions.wrong_count + 1,
      last_wrong_at = now(),
      status = 'active',
      offline_reason = null,
      offlined_at = null,
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

  -- 记录答题来源
  v_source := coalesce(p_source, case when v_q.challenge_set_id is null then '错题混战' else null end);
  insert into public.question_records (family_id, member_id, challenge_set_id, question_id, is_correct, reward_star, source)
  values (v_family_id, p_member_id, v_q.challenge_set_id, p_question_id, v_correct, v_reward, v_source);

  return query select v_correct, v_reward, v_now_mastered, v_bonus, v_star;
end;
$$;
revoke all on function public.answer_question(uuid, uuid, text, text) from public;
grant execute on function public.answer_question(uuid, uuid, text, text) to anon, authenticated;

-- ============================================================
-- ③ answer_word：萌宠闯关单词，下线规则同上，但不进混战池
-- ============================================================

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
  v_wrong public.wrong_questions%rowtype;
  v_should_offline boolean := false;
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

    -- 答对：错题本 correct_count+1，达标则下线（萌宠单词不进混战池，无需同步）
    select * into v_wrong from public.wrong_questions
    where member_id = p_member_id and word_id = p_word_id and status = 'active';

    if found then
      v_should_offline := (v_wrong.correct_count + 1) >= (v_wrong.wrong_count + 1);
      update public.wrong_questions
      set correct_count = correct_count + 1,
          status = case when v_should_offline then 'mastered' else status end,
          offline_reason = case when v_should_offline then 'auto' else offline_reason end,
          offlined_at = case when v_should_offline then now() else offlined_at end
      where id = v_wrong.id;
    end if;
  else
    select star_value into v_star from public.members where id = p_member_id;

    update public.word_progress set wrong_count = wrong_count + 1 where id = v_prog.id;

    -- 答错：只写错题本，不进错题混战池（萌宠闯关单词）
    insert into public.wrong_questions
      (family_id, member_id, word_id, challenge_set_id, wrong_count, last_wrong_at, status)
    values
      (v_family_id, p_member_id, p_word_id, v_word.challenge_set_id, 1, now(), 'active')
    on conflict (member_id, word_id)
    do update set
      wrong_count = wrong_questions.wrong_count + 1,
      last_wrong_at = now(),
      status = 'active',
      offline_reason = null,
      offlined_at = null;
  end if;

  insert into public.question_records (family_id, member_id, challenge_set_id, word_id, is_correct, reward_star, source)
  values (v_family_id, p_member_id, v_word.challenge_set_id, p_word_id, v_correct, v_reward, v_set.title);

  return query select v_correct, v_reward, v_mastered, v_star;
end;
$$;
grant execute on function public.answer_word(uuid, uuid, text, text, boolean) to anon, authenticated;

-- ============================================================
-- ④ review_wrong_question：下线规则 correct_count >= wrong_count + 1
-- ============================================================

drop function if exists public.review_wrong_question(uuid, uuid, boolean);
create or replace function public.review_wrong_question(
  p_wrong_id uuid,
  p_member_id uuid,
  p_is_correct boolean
)
returns table(removed boolean, new_star int)
language plpgsql security definer as $$
declare
  v_wrong public.wrong_questions%rowtype;
  v_star int;
  v_removed boolean := false;
  v_should_offline boolean := false;
begin
  select * into v_wrong from public.wrong_questions where id = p_wrong_id;
  if not found then raise exception '错题不存在'; end if;
  if v_wrong.member_id <> p_member_id then raise exception '无权操作'; end if;

  if p_is_correct then
    v_should_offline := (v_wrong.correct_count + 1) >= (v_wrong.wrong_count + 1);
    update public.wrong_questions
    set correct_count = correct_count + 1,
        status = case when v_should_offline then 'mastered' else status end,
        offline_reason = case when v_should_offline then 'auto' else offline_reason end,
        offlined_at = case when v_should_offline then now() else offlined_at end
    where id = p_wrong_id;

    -- 同步下线错题大混战池
    if v_should_offline then
      update public.wrong_battle_pool
      set status = 'offline', offline_reason = 'auto', offlined_at = now()
      where member_id = p_member_id and question_id = v_wrong.question_id and status = 'active';
      v_removed := true;
    end if;
  else
    update public.wrong_questions
    set wrong_count = wrong_count + 1, last_wrong_at = now()
    where id = p_wrong_id;
  end if;

  select star_value into v_star from public.members where id = p_member_id;
  return query select v_removed, v_star;
end;
$$;
grant execute on function public.review_wrong_question(uuid, uuid, boolean) to anon, authenticated;

-- ============================================================
-- ④-bis record_levelup_quiz_answer：宠物升级挑战答题也计入错题统计
-- ============================================================

drop function if exists public.record_levelup_quiz_answer(uuid, uuid, boolean);
create or replace function public.record_levelup_quiz_answer(
  p_member_id uuid,
  p_question_id uuid,
  p_is_correct boolean
)
returns void
language plpgsql security definer as $$
declare
  v_family_id uuid;
  v_q public.questions%rowtype;
  v_wrong public.wrong_questions%rowtype;
  v_should_offline boolean := false;
begin
  select family_id into v_family_id from public.members where id = p_member_id;
  if not found then return; end if;

  select * into v_q from public.questions where id = p_question_id;

  insert into public.question_records (family_id, member_id, question_id, is_correct, reward_star, source)
  values (v_family_id, p_member_id, p_question_id, p_is_correct, 0, '宠物升级挑战');

  if p_is_correct then
    -- 答对：错题本 correct_count+1，达标则下线
    select * into v_wrong from public.wrong_questions
    where member_id = p_member_id and question_id = p_question_id and status = 'active';

    if found then
      v_should_offline := (v_wrong.correct_count + 1) >= (v_wrong.wrong_count + 1);
      update public.wrong_questions
      set correct_count = correct_count + 1,
          status = case when v_should_offline then 'mastered' else status end,
          offline_reason = case when v_should_offline then 'auto' else offline_reason end,
          offlined_at = case when v_should_offline then now() else offlined_at end
      where id = v_wrong.id;

      if v_should_offline then
        update public.wrong_battle_pool
        set status = 'offline', offline_reason = 'auto', offlined_at = now()
        where member_id = p_member_id and question_id = p_question_id and status = 'active';
      end if;
    end if;
  else
    -- 答错：upsert 错题本，确保在混战池中
    insert into public.wrong_questions
      (family_id, member_id, question_id, challenge_set_id, level_id, wrong_count, last_wrong_at, status)
    values
      (v_family_id, p_member_id, p_question_id, v_q.challenge_set_id, v_q.level_id, 1, now(), 'active')
    on conflict (member_id, question_id)
    do update set
      wrong_count = wrong_questions.wrong_count + 1,
      last_wrong_at = now(),
      status = 'active',
      offline_reason = null,
      offlined_at = null,
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
end;
$$;
grant execute on function public.record_levelup_quiz_answer(uuid, uuid, boolean) to anon, authenticated;

-- ============================================================
-- ⑤ 后台管理 RPC
-- ============================================================

-- 手动下线（兼容旧 remove_wrong_from_battle_pool）
drop function if exists public.remove_wrong_from_battle_pool(uuid[]);
create or replace function public.remove_wrong_from_battle_pool(p_pool_ids uuid[])
returns int language plpgsql security definer as $$
declare v_count int;
begin
  update public.wrong_battle_pool
  set status = 'offline', offline_reason = 'manual', offlined_at = now()
  where id = any(p_pool_ids) and status = 'active';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
grant execute on function public.remove_wrong_from_battle_pool(uuid[]) to anon, authenticated;

-- 手动下线（新函数，语义更清晰）
create or replace function public.offline_wrong_battle_questions(p_pool_ids uuid[])
returns int language plpgsql security definer as $$
declare v_count int;
begin
  update public.wrong_battle_pool
  set status = 'offline', offline_reason = 'manual', offlined_at = now()
  where id = any(p_pool_ids) and status = 'active';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
grant execute on function public.offline_wrong_battle_questions(uuid[]) to anon, authenticated;

-- 重新上线
create or replace function public.reonline_wrong_battle_questions(p_pool_ids uuid[])
returns int language plpgsql security definer as $$
declare v_count int;
begin
  update public.wrong_battle_pool
  set status = 'active', offline_reason = null, offlined_at = null
  where id = any(p_pool_ids) and status = 'offline';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
grant execute on function public.reonline_wrong_battle_questions(uuid[]) to anon, authenticated;

-- 永久删除
create or replace function public.delete_wrong_battle_questions(p_pool_ids uuid[])
returns int language plpgsql security definer as $$
declare v_count int;
begin
  delete from public.wrong_battle_pool where id = any(p_pool_ids);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
grant execute on function public.delete_wrong_battle_questions(uuid[]) to anon, authenticated;

-- 获取已下线错题池
create or replace function public.get_wrong_battle_pool_offline(p_member_id uuid)
returns table(
  pool_id uuid,
  question_id uuid,
  source_challenge_set_id uuid,
  offline_reason text,
  offlined_at timestamptz,
  added_at timestamptz,
  question_text text,
  options jsonb,
  correct_answer text,
  explanation text,
  type text,
  difficulty text
)
language plpgsql security definer as $$
begin
  return query
  select
    wbp.id as pool_id,
    q.id as question_id,
    wbp.source_challenge_set_id,
    wbp.offline_reason,
    wbp.offlined_at,
    wbp.added_at,
    q.question_text,
    q.options,
    q.correct_answer,
    q.explanation,
    q.type,
    q.difficulty
  from public.wrong_battle_pool wbp
  join public.questions q on q.id = wbp.question_id
  where wbp.member_id = p_member_id and wbp.status = 'offline'
  order by wbp.offlined_at desc nulls last;
end;
$$;
grant execute on function public.get_wrong_battle_pool_offline(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
