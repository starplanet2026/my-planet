-- 0184: 题集/关卡星光值奖励设定统一
-- 需求：
--   1. 如无设定，默认 1/2/3（easy/medium/hard）
--   2. 关卡(challenge_levels)增加 reward_easy/medium/hard 设定
--   3. 题集引用关卡时，题集与关卡奖励不一致以题集为准
-- 优先级：challenge_set.reward_* > challenge_level.reward_* > 默认 1/2/3

-- 一、challenge_levels 增加分难度奖励字段（可空，null 表示未设定，使用默认值）
alter table public.challenge_levels
  add column if not exists reward_easy int,
  add column if not exists reward_medium int,
  add column if not exists reward_hard int;

-- 二、重写 answer_question：按优先级计算奖励
create or replace function public.answer_question(
  p_member_id uuid,
  p_question_id uuid,
  p_answer text,
  p_source text default null
)
returns table(is_correct boolean, reward integer, is_mastered boolean, bonus_reward integer, new_star integer)
language plpgsql security definer as $$
declare
  v_q public.questions%rowtype;
  v_set public.challenge_sets%rowtype;
  v_level public.challenge_levels%rowtype;
  v_family_id uuid;
  v_star int;
  v_reward int := 0;
  v_bonus int := 0;
  v_correct boolean;
  v_prog public.question_progress%rowtype;
  v_now_mastered boolean := false;
  v_source text;
  v_user_answers text[];
  v_equiv_answers1 text[];
  v_equiv_answers2 text[];
  v_blank1_ok boolean := false;
  v_blank2_ok boolean := true;
  v_ua text;
  v_ea text;
  v_new_attempt int;
  v_new_correct int;
  v_new_wrong int;
  v_should_offline boolean;
  -- 按优先级解析出的实际奖励：题集 > 关卡 > 默认 1/2/3
  v_eff_easy int;
  v_eff_medium int;
  v_eff_hard int;
begin
  select * into v_q from public.questions where id = p_question_id;
  if not found then raise exception '题目不存在'; end if;

  -- 读取题集奖励配置（challenge_set_id 可能为 null）
  select * into v_set from public.challenge_sets where id = v_q.challenge_set_id;

  -- 读取题目所属关卡奖励配置
  select * into v_level from public.challenge_levels where id = v_q.level_id;

  -- 奖励优先级：题集配置 > 关卡配置 > 默认 1/2/3
  v_eff_easy   := coalesce(v_set.reward_easy,   v_level.reward_easy,   1);
  v_eff_medium := coalesce(v_set.reward_medium, v_level.reward_medium, 2);
  v_eff_hard   := coalesce(v_set.reward_hard,   v_level.reward_hard,   3);

  select family_id into v_family_id from public.members where id = p_member_id;

  -- 判题逻辑
  if v_q.type = 'fill_blank' then
    v_user_answers := string_to_array(p_answer, '||');
    v_equiv_answers1 := string_to_array(coalesce(v_q.correct_answer, ''), '/');
    v_equiv_answers2 := string_to_array(coalesce(v_q.answer2, ''), '/');

    if v_user_answers[1] is not null then
      v_ua := lower(btrim(v_user_answers[1]));
      v_blank1_ok := false;
      if v_equiv_answers1 is not null then
        foreach v_ea in array v_equiv_answers1 loop
          if lower(btrim(v_ea)) = v_ua then v_blank1_ok := true; exit; end if;
        end loop;
      end if;
    end if;

    v_blank2_ok := true;
    if v_q.answer2 is not null and btrim(v_q.answer2) <> '' then
      v_blank2_ok := false;
      if array_length(v_user_answers, 1) >= 2 and v_user_answers[2] is not null then
        v_ua := lower(btrim(v_user_answers[2]));
        if v_equiv_answers2 is not null then
          foreach v_ea in array v_equiv_answers2 loop
            if lower(btrim(v_ea)) = v_ua then v_blank2_ok := true; exit; end if;
          end loop;
        end if;
      end if;
    end if;

    v_correct := v_blank1_ok and v_blank2_ok;
  elsif v_q.type in ('choice','multi_choice','correct') then
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
    -- 按难度取解析后的奖励
    v_reward := case v_q.difficulty
      when 'easy' then v_eff_easy
      when 'hard' then v_eff_hard
      else v_eff_medium
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
  else
    select star_value into v_star from public.members where id = p_member_id;
    update public.question_progress
    set attempt_count = attempt_count + 1,
        last_attempt_at = now()
    where id = v_prog.id;
  end if;

  v_new_attempt := v_prog.attempt_count + 1;
  v_new_correct := v_prog.correct_count + (case when v_correct then 1 else 0 end);
  v_new_wrong := v_new_attempt - v_new_correct;
  v_should_offline := v_new_correct >= v_new_wrong + 1;
  v_now_mastered := v_should_offline;

  if not v_correct then
    insert into public.wrong_questions
      (family_id, member_id, question_id, challenge_set_id, level_id, wrong_count, correct_count, last_wrong_at, status)
    values
      (v_family_id, p_member_id, p_question_id, v_q.challenge_set_id, v_q.level_id, v_new_wrong, v_new_correct, now(), 'active')
    on conflict (member_id, question_id)
    do update set
      wrong_count = v_new_wrong,
      correct_count = v_new_correct,
      last_wrong_at = now(),
      status = 'active',
      offline_reason = null,
      offlined_at = null,
      level_id = coalesce(excluded.level_id, wrong_questions.level_id);
  else
    update public.wrong_questions
    set wrong_count = v_new_wrong,
        correct_count = v_new_correct,
        status = case when v_should_offline then 'mastered' else 'active' end,
        offline_reason = case when v_should_offline then 'auto' else null end,
        offlined_at = case when v_should_offline then now() else null end
    where member_id = p_member_id and question_id = p_question_id;
  end if;

  if exists (select 1 from public.wrong_battle_pool
             where member_id = p_member_id and question_id = p_question_id) then
    update public.wrong_battle_pool
    set status = case when v_should_offline then 'offline' else 'active' end,
        offline_reason = case when v_should_offline then 'auto' else null end,
        offlined_at = case when v_should_offline then now() else null end
    where member_id = p_member_id and question_id = p_question_id;
  elsif not v_correct then
    insert into public.wrong_battle_pool
      (family_id, member_id, question_id, source_challenge_set_id, source_level_id, status)
    values
      (v_family_id, p_member_id, p_question_id, v_q.challenge_set_id, v_q.level_id, 'active');
  end if;

  v_source := coalesce(p_source, case when v_q.challenge_set_id is null then '错题混战' else null end);
  insert into public.question_records (family_id, member_id, challenge_set_id, question_id, is_correct, reward_star, source)
  values (v_family_id, p_member_id, v_q.challenge_set_id, p_question_id, v_correct, v_reward, v_source);

  return query select v_correct, v_reward, v_now_mastered, v_bonus, v_star;
end;
$$;
revoke all on function public.answer_question(uuid, uuid, text, text) from public;
grant execute on function public.answer_question(uuid, uuid, text, text) to anon, authenticated;

-- 三、更新 get_challenge_boards：关卡返回 reward_easy/medium/hard 供前端展示
drop function if exists public.get_challenge_boards(uuid);

create function public.get_challenge_boards(p_member_id uuid)
returns jsonb
language plpgsql security definer as $$
declare
  v_result jsonb;
begin
  select jsonb_agg(
    jsonb_build_object(
      'board', s.board,
      'sets', (
        select coalesce(jsonb_agg(
          jsonb_build_object(
            'id', cs.id,
            'title', cs.title,
            'description', cs.description,
            'type', cs.type,
            'status', cs.status,
            'reward_easy', cs.reward_easy,
            'reward_medium', cs.reward_medium,
            'reward_hard', cs.reward_hard,
            'knowledge_points', cs.knowledge_points,
            'easy_count', (
              select count(*) from public.questions q
              join public.challenge_set_levels csl on csl.level_id = q.level_id
              where csl.set_id = cs.id and q.is_active = true and q.difficulty = 'easy'
            ),
            'medium_count', (
              select count(*) from public.questions q
              join public.challenge_set_levels csl on csl.level_id = q.level_id
              where csl.set_id = cs.id and q.is_active = true and q.difficulty = 'medium'
            ),
            'hard_count', (
              select count(*) from public.questions q
              join public.challenge_set_levels csl on csl.level_id = q.level_id
              where csl.set_id = cs.id and q.is_active = true and q.difficulty = 'hard'
            ),
            'levels', (
              select coalesce(jsonb_agg(
                jsonb_build_object(
                  'id', lv.id,
                  'level_no', lv.level_no,
                  'sort_order', csl.sort_order,
                  'title', lv.title,
                  'description', lv.description,
                  'pass_reward', lv.pass_reward,
                  'reward_easy', lv.reward_easy,
                  'reward_medium', lv.reward_medium,
                  'reward_hard', lv.reward_hard,
                  'status', lv.status,
                  'subject', lv.subject,
                  'target_section', lv.target_section,
                  'total', (select count(*) from public.questions q where q.level_id = lv.id and q.is_active = true),
                  'mastered', (
                    select count(*) from public.question_progress p
                    where p.question_id in (select id from public.questions where level_id = lv.id and is_active = true)
                      and p.member_id = p_member_id
                      and p.is_mastered = true
                  ),
                  'is_cleared', (
                    (select count(*) from public.questions q where q.level_id = lv.id and q.is_active = true) > 0
                    and
                    (select count(*) from public.questions q where q.level_id = lv.id and q.is_active = true) =
                    (select count(*) from public.question_progress p
                     where p.question_id in (select id from public.questions where level_id = lv.id and is_active = true)
                       and p.member_id = p_member_id and p.is_mastered = true)
                  ),
                  'is_paused', (
                    select exists(
                      select 1 from public.challenge_level_progress clp
                      where clp.level_id = lv.id and clp.member_id = p_member_id and clp.is_paused = true
                    )
                  ),
                  'cleared_ids', (
                    select coalesce(array_agg(p.question_id), '{}')
                    from public.question_progress p
                    where p.question_id in (select id from public.questions where level_id = lv.id and is_active = true)
                      and p.member_id = p_member_id
                      and p.is_mastered = true
                  )
                )
                order by csl.sort_order
              ), '[]'::jsonb)
              from public.challenge_set_levels csl
              join public.challenge_levels lv on lv.id = csl.level_id
              where csl.set_id = cs.id and lv.status = 'active'
            )
          )
          order by cs.created_at desc
        ), '[]'::jsonb)
        from public.challenge_sets cs
        where cs.board = s.board
          and cs.status = 'active'
      ),
      'levels', (
        select coalesce(jsonb_agg(
          jsonb_build_object(
            'id', lv.id,
            'level_no', lv.level_no,
            'sort_order', 0,
            'title', lv.title,
            'description', lv.description,
            'pass_reward', lv.pass_reward,
            'reward_easy', lv.reward_easy,
            'reward_medium', lv.reward_medium,
            'reward_hard', lv.reward_hard,
            'status', lv.status,
            'subject', lv.subject,
            'target_section', lv.target_section,
            'total', (select count(*) from public.questions q where q.level_id = lv.id and q.is_active = true),
            'easy_count', (select count(*) from public.questions q where q.level_id = lv.id and q.is_active = true and q.difficulty = 'easy'),
            'medium_count', (select count(*) from public.questions q where q.level_id = lv.id and q.is_active = true and q.difficulty = 'medium'),
            'hard_count', (select count(*) from public.questions q where q.level_id = lv.id and q.is_active = true and q.difficulty = 'hard'),
            'mastered', (
              select count(*) from public.question_progress p
              where p.question_id in (select id from public.questions where level_id = lv.id and is_active = true)
                and p.member_id = p_member_id
                and p.is_mastered = true
            ),
            'is_cleared', (
              (select count(*) from public.questions q where q.level_id = lv.id and q.is_active = true) > 0
              and
              (select count(*) from public.questions q where q.level_id = lv.id and q.is_active = true) =
              (select count(*) from public.question_progress p
               where p.question_id in (select id from public.questions where level_id = lv.id and is_active = true)
                 and p.member_id = p_member_id and p.is_mastered = true)
            ),
            'is_paused', (
              select exists(
                select 1 from public.challenge_level_progress clp
                where clp.level_id = lv.id and clp.member_id = p_member_id and clp.is_paused = true
              )
            ),
            'cleared_ids', (
              select coalesce(array_agg(p.question_id), '{}')
              from public.question_progress p
              where p.question_id in (select id from public.questions where level_id = lv.id and is_active = true)
                and p.member_id = p_member_id
                and p.is_mastered = true
            )
          )
          order by lv.created_at desc
        ), '[]'::jsonb)
        from public.challenge_levels lv
        where lv.published = true
          and lv.target_section = s.board
          and s.board in ('today_review','gap_check','advance')
      )
    )
  )
  into v_result
  from (
    select 'today_review' as board
    union all select 'gap_check'
    union all select 'wrong_battle'
    union all select 'advance'
  ) s;

  return coalesce(v_result, '[]'::jsonb);
end;
$$;

grant execute on function public.get_challenge_boards(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
