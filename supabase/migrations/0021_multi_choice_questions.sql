-- ============================================================
-- 0021: 选择题增强 - 多选题型 + 多选判分
-- 1. questions.type 增加 'multi_choice'（多选）
-- 2. answer_question 重写：多选时将答案字母排序后比较（不区分顺序）
-- ============================================================

-- 1. 更新 type 约束
alter table public.questions drop constraint if exists questions_type_check;
alter table public.questions add constraint questions_type_check
  check (type in ('choice','math','multi_choice'));

-- ============================================================
-- 2. 重写 answer_question：支持多选判分
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
  v_norm_answer text;
  v_norm_correct text;
begin
  select * into v_q from public.questions where id = p_question_id;
  if not found then raise exception '题目不存在'; end if;

  select * into v_set from public.challenge_sets where id = v_q.challenge_set_id;
  v_family_id := v_set.family_id;

  -- 判分
  if v_q.type in ('choice', 'multi_choice') then
    -- 选择题（单选/多选）：提取所有字母，排序后比较
    -- 这样可兼容 correct_answer 含不可见字符/多选顺序不同/带分隔符等情况
    select string_agg(c, '' order by c) into v_norm_answer
      from (select lower(ch) as c from unnest(string_to_array(lower(trim(p_answer)), NULL)) as t(ch) where ch ~ '[a-z]') s;
    select string_agg(c, '' order by c) into v_norm_correct
      from (select lower(ch) as c from unnest(string_to_array(lower(trim(v_q.correct_answer)), NULL)) as t(ch) where ch ~ '[a-z]') s;
    v_correct := v_norm_answer = v_norm_correct and v_norm_answer is not null and v_norm_answer <> '';
  else
    -- 数学：去除空格后比较
    v_correct := lower(trim(p_answer)) = lower(trim(v_q.correct_answer));
  end if;

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

    -- 错题本：答对则 correct_count+1，达到2次则移除
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

grant execute on function public.answer_question(uuid, uuid, text) to anon, authenticated;
