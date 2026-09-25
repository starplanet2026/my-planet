-- 0118: 挑战会话星光汇总
-- 做题星光不每题单独生成流水，而是在会话内累积，退出时一次性汇总生成单条流水。
-- 异常关闭兜底：下次进入题集时自动补录上一轮未汇总的星光。

-- ====== 1. 会话表 ======
create table if not exists public.challenge_session (
  member_id uuid primary key references public.members(id) on delete cascade,
  set_id uuid,
  level_id uuid,
  set_title text,
  accumulated_stars int not null default 0,
  started_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now()
);

-- ====== 2. 开始会话：先补录上一轮未汇总的星光，再开启新会话 ======
create or replace function public.start_challenge_session(
  p_member_id uuid,
  p_set_id uuid default null,
  p_level_id uuid default null,
  p_set_title text default ''
) returns void language plpgsql security definer as $$
begin
  -- 兜底：补录上一轮未汇总的星光
  perform public.flush_challenge_session(p_member_id);
  -- 开启新会话
  insert into public.challenge_session (member_id, set_id, level_id, set_title, accumulated_stars, started_at, last_activity_at)
  values (p_member_id, p_set_id, p_level_id, coalesce(p_set_title, ''), 0, now(), now())
  on conflict (member_id) do update set
    set_id = excluded.set_id,
    level_id = excluded.level_id,
    set_title = excluded.set_title,
    accumulated_stars = 0,
    started_at = now(),
    last_activity_at = now();
end;
$$;
grant execute on function public.start_challenge_session(uuid, uuid, uuid, text) to anon, authenticated;

-- ====== 3. 累积星光（答题 RPC 调用） ======
create or replace function public.add_session_stars(p_member_id uuid, p_amount int)
returns void language plpgsql security definer as $$
begin
  if p_amount <= 0 then return; end if;
  update public.challenge_session
    set accumulated_stars = accumulated_stars + p_amount,
        last_activity_at = now()
  where member_id = p_member_id;
end;
$$;
grant execute on function public.add_session_stars(uuid, int) to anon, authenticated;

-- ====== 4. 汇总会话：生成单条星光流水，清零累积 ======
create or replace function public.flush_challenge_session(p_member_id uuid)
returns int language plpgsql security definer as $$
declare
  v_session public.challenge_session%rowtype;
  v_family_id uuid;
  v_new_star int;
  v_total int;
begin
  select * into v_session from public.challenge_session where member_id = p_member_id for update;
  if not found then return 0; end if;

  v_total := coalesce(v_session.accumulated_stars, 0);
  if v_total <= 0 then
    -- 无星光可汇总，直接重置会话
    update public.challenge_session set accumulated_stars = 0 where member_id = p_member_id;
    return 0;
  end if;

  select family_id into v_family_id from public.members where id = p_member_id;
  select star_value into v_new_star from public.members where id = p_member_id;

  -- 写入单条星光流水（balance_type='star', category='challenge'）
  insert into public.coin_records (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by, balance_type)
  values (
    v_family_id,
    p_member_id,
    v_total,
    v_new_star,
    '【会话汇总】' || coalesce(v_session.set_title, '做题') || '，获得星光值+' || v_total,
    'challenge',
    'challenge_session',
    v_session.set_id,
    p_member_id::text,
    'star'
  );

  -- 清零累积
  update public.challenge_session set accumulated_stars = 0 where member_id = p_member_id;
  return v_total;
end;
$$;
grant execute on function public.flush_challenge_session(uuid) to anon, authenticated;

-- ====== 5. 修改 answer_question：答题奖励累积到会话 ======
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
    -- 累积到会话
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

  insert into public.question_records (family_id, member_id, challenge_set_id, question_id, is_correct, reward_star)
  values (v_family_id, p_member_id, v_q.challenge_set_id, p_question_id, v_correct, v_reward);

  return query select v_correct, v_reward, v_now_mastered, v_bonus, v_star;
end;
$$;

revoke all on function public.answer_question(uuid, uuid, text) from public;
grant execute on function public.answer_question(uuid, uuid, text) to anon, authenticated;

-- ====== 6. 修改 answer_word：答题奖励累积到会话 ======
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
    -- 累积到会话
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

  return query select v_correct, v_reward, v_mastered, v_star;
end;
$$;
grant execute on function public.answer_word(uuid, uuid, text, text, boolean) to anon, authenticated;

-- ====== 7. 修改 finish_challenge_level：通关奖励累积到会话 ======
drop function if exists public.finish_challenge_level(uuid, uuid);

create or replace function public.finish_challenge_level(
  p_member_id uuid,
  p_level_id uuid
)
returns table(level_awarded boolean, level_reward int, set_awarded boolean, set_reward int, new_star int)
language plpgsql security definer as $$
declare
  v_level public.challenge_levels%rowtype;
  v_set_id uuid;
  v_total int;
  v_mastered int;
  v_star int;
  v_level_reward int := 3;
  v_set_reward int := 0;
  v_level_awarded boolean := false;
  v_set_awarded boolean := false;
  v_family_id uuid;
begin
  select * into v_level from public.challenge_levels where id = p_level_id;
  if not found then raise exception '关卡不存在'; end if;

  v_set_id := v_level.challenge_set_id;

  select count(*) into v_total from public.questions
    where level_id = p_level_id and is_active = true;
  select count(*) into v_mastered from public.question_progress p
    where p.member_id = p_member_id and p.is_mastered = true
      and p.question_id in (select id from public.questions where level_id = p_level_id and is_active = true);

  if v_total = 0 or v_mastered < v_total then
    select star_value into v_star from public.members where id = p_member_id;
    return query select false, 0, false, 0, v_star;
    return;
  end if;

  select family_id into v_family_id from public.members where id = p_member_id;

  begin
    insert into public.level_clear_log (member_id, level_id, reward_star)
    values (p_member_id, p_level_id, v_level_reward);
    v_level_awarded := true;
    select star_value into v_star from public.members where id = p_member_id for update;
    v_star := v_star + v_level_reward;
    update public.members set star_value = v_star, updated_at = now() where id = p_member_id;
    perform public.add_session_stars(p_member_id, v_level_reward);
  exception when unique_violation then
    v_level_awarded := false;
    select star_value into v_star from public.members where id = p_member_id;
  end;

  select count(*) into v_total from public.questions q
    join public.challenge_levels l on l.id = q.level_id
    where l.challenge_set_id = v_set_id and q.is_active = true;
  select count(*) into v_mastered from public.question_progress p
    where p.member_id = p_member_id and p.is_mastered = true
      and p.question_id in (
        select q.id from public.questions q
        join public.challenge_levels l on l.id = q.level_id
        where l.challenge_set_id = v_set_id and q.is_active = true
      );

  if v_total > 0 and v_mastered >= v_total then
    v_set_reward := floor(v_total::numeric / 5)::int;
    if v_set_reward > 0 then
      begin
        insert into public.set_clear_log (member_id, challenge_set_id, reward_star)
        values (p_member_id, v_set_id, v_set_reward);
        v_set_awarded := true;
        select star_value into v_star from public.members where id = p_member_id for update;
        v_star := v_star + v_set_reward;
        update public.members set star_value = v_star, updated_at = now() where id = p_member_id;
        perform public.add_session_stars(p_member_id, v_set_reward);
      exception when unique_violation then
        v_set_awarded := false;
        select star_value into v_star from public.members where id = p_member_id;
      end;
    end if;
  end if;

  return query select v_level_awarded, v_level_reward, v_set_awarded, v_set_reward, v_star;
end;
$$;
grant execute on function public.finish_challenge_level(uuid, uuid) to anon, authenticated;

-- ====== 8. 修改 award_perfect_challenge_bonus：完美奖励累积到会话 ======
drop function if exists public.award_perfect_challenge_bonus(uuid, uuid);

create or replace function public.award_perfect_challenge_bonus(
  p_member_id uuid,
  p_challenge_set_id uuid
)
returns table(awarded boolean, bonus int, new_star int)
language plpgsql security definer as $$
declare
  v_star int;
  v_bonus int := 10;
  v_total_count int;
  v_mastered_count int;
  v_family_id uuid;
begin
  select count(*) into v_total_count from public.questions where challenge_set_id = p_challenge_set_id;
  select count(*) into v_mastered_count from public.question_progress
    where member_id = p_member_id and is_mastered = true
    and question_id in (select id from public.questions where challenge_set_id = p_challenge_set_id);

  if v_total_count = 0 or v_mastered_count < v_total_count then
    return query select false, 0, (select star_value from public.members where id = p_member_id);
    return;
  end if;

  begin
    select family_id into v_family_id from public.challenge_sets where id = p_challenge_set_id;
    insert into public.perfect_bonus_log (member_id, challenge_set_id, reward)
    values (p_member_id, p_challenge_set_id, v_bonus);
  exception when unique_violation then
    return query select false, 0, (select star_value from public.members where id = p_member_id);
    return;
  end;

  select star_value into v_star from public.members where id = p_member_id for update;
  v_star := v_star + v_bonus;
  update public.members set star_value = v_star, updated_at = now() where id = p_member_id;
  perform public.add_session_stars(p_member_id, v_bonus);

  return query select true, v_bonus, v_star;
end;
$$;
grant execute on function public.award_perfect_challenge_bonus(uuid, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
