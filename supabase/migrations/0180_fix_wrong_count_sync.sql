-- 0180: 错题作答次数统计异常修复 + 全局错题状态数据矫正
-- 根因：wrong_questions.correct_count 只统计「首次答错之后」的答对次数，
--   首次答错前的答对次数丢失，导致 答对次数 + 答错次数 != 总作答次数；
--   同时查看错题弹窗读 wrong_questions，错题混战池读 question_progress，两个模块数据源不一致。
-- 修复：
--   1. 以 question_records（原始答题日志）为唯一真值，重算 question_progress / wrong_questions 计数；
--   2. 按业务规则（答对次数 >= 错误次数 + 1）重新判定错题上线/下线状态；
--   3. 重写 answer_question，统一从 question_progress 推导掌握状态，并同步 wrong_questions 计数，
--      保证后续新增答题记录计数不再丢失。

-- ========== 1. 重算 question_progress（以 question_records 为真值） ==========
-- 过滤：question_id 非空、且题目在 questions 表中存在（防止脏数据违反非空/FK 约束）
with rec as (
  select
    r.member_id,
    r.question_id,
    count(*) as attempt_count,
    count(*) filter (where r.is_correct) as correct_count
  from public.question_records r
  where r.question_id is not null
    and exists (select 1 from public.questions q where q.id = r.question_id)
  group by r.member_id, r.question_id
)
insert into public.question_progress (member_id, question_id, attempt_count, correct_count, is_mastered, last_attempt_at)
select
  rec.member_id,
  rec.question_id,
  rec.attempt_count,
  rec.correct_count,
  (rec.correct_count >= (rec.attempt_count - rec.correct_count) + 1) as is_mastered,
  now()
from rec
on conflict (member_id, question_id)
do update set
  attempt_count = excluded.attempt_count,
  correct_count = excluded.correct_count,
  is_mastered = excluded.is_mastered;

-- ========== 2. 重算 wrong_questions（仅保留有答错记录的题目，计数来自 question_records） ==========
with rec as (
  select
    r.member_id,
    r.question_id,
    count(*) filter (where not r.is_correct) as wrong_count,
    count(*) filter (where r.is_correct) as correct_count,
    max(r.answered_at) filter (where not r.is_correct) as last_wrong_at,
    min(q.challenge_set_id) as challenge_set_id,
    min(q.level_id) as level_id
  from public.question_records r
  join public.questions q on q.id = r.question_id
  where r.question_id is not null
  group by r.member_id, r.question_id
  having count(*) filter (where not r.is_correct) > 0
),
fam as (
  select m.id as member_id, m.family_id from public.members m
)
insert into public.wrong_questions
  (family_id, member_id, question_id, challenge_set_id, level_id, wrong_count, correct_count, last_wrong_at, status, offline_reason, offlined_at)
select
  fam.family_id,
  rec.member_id,
  rec.question_id,
  rec.challenge_set_id,
  rec.level_id,
  rec.wrong_count,
  rec.correct_count,
  rec.last_wrong_at,
  case when rec.correct_count >= rec.wrong_count + 1 then 'mastered' else 'active' end,
  case when rec.correct_count >= rec.wrong_count + 1 then 'auto' else null end,
  case when rec.correct_count >= rec.wrong_count + 1 then now() else null end
from rec
join fam on fam.member_id = rec.member_id
on conflict (member_id, question_id)
do update set
  wrong_count = excluded.wrong_count,
  correct_count = excluded.correct_count,
  last_wrong_at = excluded.last_wrong_at,
  status = excluded.status,
  offline_reason = excluded.offline_reason,
  offlined_at = excluded.offlined_at,
  level_id = coalesce(excluded.level_id, wrong_questions.level_id);

-- 清理：没有任何答错记录的 wrong_questions（理论上不应存在，保险清理）
delete from public.wrong_questions wq
using public.question_progress qp
where wq.member_id = qp.member_id and wq.question_id = qp.question_id
  and (qp.attempt_count - qp.correct_count) <= 0;

-- ========== 3. 重新判定错题混战池上线/下线状态 ==========
-- 下线条件：答对次数 >= 错误次数 + 1（即 correct_count >= wrong_count + 1）
update public.wrong_battle_pool wbp
set
  status = case
    when qp.correct_count >= (qp.attempt_count - qp.correct_count) + 1 then 'offline'
    else 'active'
  end,
  offline_reason = case
    when qp.correct_count >= (qp.attempt_count - qp.correct_count) + 1 then 'auto'
    else null
  end,
  offlined_at = case
    when qp.correct_count >= (qp.attempt_count - qp.correct_count) + 1 then now()
    else null
  end
from public.question_progress qp
where wbp.member_id = qp.member_id and wbp.question_id = qp.question_id;

-- ========== 4. 重写 answer_question：从 question_progress 推导掌握状态，同步 wrong_questions 计数 ==========
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
  v_set public.challenge_sets%rowtype;
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
begin
  select * into v_q from public.questions where id = p_question_id;
  if not found then raise exception '题目不存在'; end if;

  -- 读取题集奖励配置（challenge_set_id 可能为 null，如错题混战/独立关卡）
  select * into v_set from public.challenge_sets where id = v_q.challenge_set_id;

  select family_id into v_family_id from public.members where id = p_member_id;

  -- 判题逻辑
  if v_q.type = 'fill_blank' then
    v_user_answers := string_to_array(p_answer, '||');
    v_equiv_answers1 := string_to_array(coalesce(v_q.correct_answer, ''), '/');
    v_equiv_answers2 := string_to_array(coalesce(v_q.answer2, ''), '/');

    v_ua := normalize_answer(coalesce(v_user_answers[1], ''));
    foreach v_ea in array v_equiv_answers1 loop
      if v_ua = normalize_answer(v_ea) and v_ua <> '' then
        v_blank1_ok := true;
      end if;
    end loop;

    if coalesce(v_q.answer2, '') <> '' then
      v_blank2_ok := false;
      v_ua := normalize_answer(coalesce(v_user_answers[2], ''));
      foreach v_ea in array v_equiv_answers2 loop
        if v_ua = normalize_answer(v_ea) and v_ua <> '' then
          v_blank2_ok := true;
        end if;
      end loop;
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

  -- 更新 question_progress（单一真值来源）
  if v_correct then
    -- 按题目难度读取题集配置的奖励值；题集无配置或为空时回退默认 2/4/6
    v_reward := case v_q.difficulty
      when 'easy' then coalesce(v_set.reward_easy, 2)
      when 'hard' then coalesce(v_set.reward_hard, 6)
      when 'medium' then coalesce(v_set.reward_medium, 4)
      else coalesce(v_set.reward_medium, 4)
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

  -- 从 question_progress 推导最新计数（保证 答对 + 答错 = 总作答 恒成立）
  v_new_attempt := v_prog.attempt_count + 1;
  v_new_correct := v_prog.correct_count + (case when v_correct then 1 else 0 end);
  v_new_wrong := v_new_attempt - v_new_correct;
  v_should_offline := v_new_correct >= v_new_wrong + 1;
  v_now_mastered := v_should_offline;

  -- 同步 wrong_questions：答错时创建/更新；答对时若存在记录则同步计数与状态
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
    -- 答对：若存在错题记录，同步计数并按规则判定状态
    update public.wrong_questions
    set wrong_count = v_new_wrong,
        correct_count = v_new_correct,
        status = case when v_should_offline then 'mastered' else 'active' end,
        offline_reason = case when v_should_offline then 'auto' else null end,
        offlined_at = case when v_should_offline then now() else null end
    where member_id = p_member_id and question_id = p_question_id;
  end if;

  -- 同步错题混战池状态
  if exists (select 1 from public.wrong_battle_pool
             where member_id = p_member_id and question_id = p_question_id) then
    update public.wrong_battle_pool
    set status = case when v_should_offline then 'offline' else 'active' end,
        offline_reason = case when v_should_offline then 'auto' else null end,
        offlined_at = case when v_should_offline then now() else null end
    where member_id = p_member_id and question_id = p_question_id;
  elsif not v_correct then
    -- 答错且池中无记录：加入池子
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

notify pgrst, 'reload schema';
