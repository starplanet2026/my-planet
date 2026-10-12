-- 0226: 智慧星战做题规则重置
-- 一、单题星光递减：得分 = 基础星光 - 累计答错次数，最低0
-- 二、答错次数直接记录（wrong_count 字段），不再用 attempt_count - correct_count
-- 三、默认基础星光 1/2/3 → 2/3/4
-- 四、选择题选项乱序开关（默认开启）
-- 五、家默快速复习星光同样递减

-- ============================================================
-- 一、question_progress 加 wrong_count 字段
-- ============================================================
alter table public.question_progress
  add column if not exists wrong_count int not null default 0;

-- 历史数据回填：wrong_count = attempt_count - correct_count
update public.question_progress
set wrong_count = greatest(0, attempt_count - correct_count)
where wrong_count = 0 and attempt_count > correct_count;

-- ============================================================
-- 二、dictation_error_words 加 wrong_count 字段（家默快速复习用）
-- ============================================================
alter table public.dictation_error_words
  add column if not exists wrong_count int not null default 0;

-- ============================================================
-- 三、challenge_sets 加选项乱序开关
-- ============================================================
alter table public.challenge_sets
  add column if not exists shuffle_options boolean not null default true;

-- ============================================================
-- 四、重写 answer_question：星光递减 + wrong_count 直接计数
-- ============================================================
drop function if exists public.answer_question(uuid, uuid, text, text);

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
  v_new_wrong int;
  v_should_offline boolean;
  -- 按优先级解析出的实际奖励：题集 > 关卡 > 默认 2/3/4
  v_eff_easy int;
  v_eff_medium int;
  v_eff_hard int;
  v_base_reward int;
begin
  select * into v_q from public.questions where id = p_question_id;
  if not found then raise exception '题目不存在'; end if;

  select * into v_set from public.challenge_sets where id = v_q.challenge_set_id;
  select * into v_level from public.challenge_levels where id = v_q.level_id;

  -- 奖励优先级：题集配置 > 关卡配置 > 默认 2/3/4
  v_eff_easy   := coalesce(v_set.reward_easy,   v_level.reward_easy,   2);
  v_eff_medium := coalesce(v_set.reward_medium, v_level.reward_medium, 3);
  v_eff_hard   := coalesce(v_set.reward_hard,   v_level.reward_hard,   4);

  -- 基础星光（按难度）
  v_base_reward := case v_q.difficulty
    when 'easy' then v_eff_easy
    when 'hard' then v_eff_hard
    else v_eff_medium
  end;

  select family_id into v_family_id from public.members where id = p_member_id;

  -- 判题逻辑（保持不变）
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

  -- 读取/创建进度
  select * into v_prog from public.question_progress
    where member_id = p_member_id and question_id = p_question_id;
  if not found then
    insert into public.question_progress (member_id, question_id, attempt_count, correct_count, wrong_count, is_mastered, last_attempt_at)
    values (p_member_id, p_question_id, 0, 0, 0, false, now())
    returning * into v_prog;
  end if;

  if v_correct then
    -- 答对：得分 = 基础星光 - 累计答错次数，最低0
    v_reward := greatest(0, v_base_reward - v_prog.wrong_count);
    if v_reward > 0 then
      select star_value into v_star from public.members where id = p_member_id for update;
      v_star := v_star + v_reward;
      update public.members set star_value = v_star, updated_at = now() where id = p_member_id;
      perform public.add_session_stars(p_member_id, v_reward);
    else
      select star_value into v_star from public.members where id = p_member_id;
    end if;

    update public.question_progress
    set attempt_count = attempt_count + 1,
        correct_count = correct_count + 1,
        is_mastered = true,
        last_attempt_at = now(),
        mastered_at = coalesce(mastered_at, now())
    where id = v_prog.id;

    v_new_wrong := v_prog.wrong_count;
  else
    -- 答错：wrong_count + 1，不给星光
    select star_value into v_star from public.members where id = p_member_id;
    update public.question_progress
    set attempt_count = attempt_count + 1,
        wrong_count = wrong_count + 1,
        last_attempt_at = now()
    where id = v_prog.id;

    v_new_wrong := v_prog.wrong_count + 1;
  end if;

  -- 下线判定：正确次数 >= 错误次数 + 1
  v_should_offline := (v_prog.correct_count + (case when v_correct then 1 else 0 end))
                    >= v_new_wrong + 1;
  v_now_mastered := v_should_offline;

  -- 错题表同步
  if not v_correct then
    insert into public.wrong_questions
      (family_id, member_id, question_id, challenge_set_id, level_id, wrong_count, correct_count, last_wrong_at, status)
    values
      (v_family_id, p_member_id, p_question_id, v_q.challenge_set_id, v_q.level_id, v_new_wrong, v_prog.correct_count, now(), 'active')
    on conflict (member_id, question_id)
    do update set
      wrong_count = v_new_wrong,
      correct_count = v_prog.correct_count,
      last_wrong_at = now(),
      status = 'active',
      offline_reason = null,
      offlined_at = null,
      level_id = coalesce(excluded.level_id, wrong_questions.level_id);
  else
    update public.wrong_questions
    set wrong_count = v_new_wrong,
        correct_count = v_prog.correct_count + 1,
        status = case when v_should_offline then 'mastered' else 'active' end,
        offline_reason = case when v_should_offline then 'auto' else null end,
        offlined_at = case when v_should_offline then now() else null end
    where member_id = p_member_id and question_id = p_question_id;
  end if;

  -- 错题混战池
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

-- ============================================================
-- 五、重写 save_quick_review_record：家默快速复习星光递减
-- ============================================================
drop function if exists public.save_quick_review_record(uuid, uuid, uuid, text, text, boolean, text, int, int);

create or replace function public.save_quick_review_record(
  p_task_id uuid,
  p_member_id uuid,
  p_task_word_id uuid,
  p_word_text text,
  p_answer text,
  p_is_correct boolean,
  p_subject text,
  p_star_per_word int,
  p_round_no int default 1
) returns table(success boolean, message text, star_gained int) as $$
declare
  v_task record;
  v_member_rec record;
  v_star int := 0;
  v_new_star int := 0;
  v_existing record;
begin
  -- 校验任务
  select * into v_task from public.dictation_tasks
  where id = p_task_id and member_id = p_member_id and status = 'active';
  if v_task is null then
    return query select false, '任务不存在或已下线', 0;
    return;
  end if;

  -- 写入/覆盖判题记录
  insert into public.dictation_quick_review_records
    (task_id, member_id, task_word_id, word_text, answer, is_correct, round_no)
  values
    (p_task_id, p_member_id, p_task_word_id, p_word_text, p_answer, p_is_correct, p_round_no)
  on conflict (task_id, member_id, task_word_id) do update
    set is_correct = excluded.is_correct,
        round_no = excluded.round_no,
        word_text = excluded.word_text,
        answer = excluded.answer;

  if p_is_correct then
    -- 正确：得分 = star_per_word - 累计答错次数，最低0
    select wrong_count into v_existing from public.dictation_error_words
    where member_id = p_member_id and subject = p_subject and answer = p_answer;
    v_star := greatest(0, p_star_per_word - coalesce(v_existing.wrong_count, 0));
    if v_star > 0 then
      select family_id, star_value into v_member_rec from public.members where id = p_member_id;
      v_new_star := coalesce(v_member_rec.star_value, 0) + v_star;
      update public.members set star_value = star_value + v_star where id = p_member_id;
      insert into public.coin_records (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by, balance_type)
      values (v_member_rec.family_id, p_member_id, v_star, v_new_star, '快速复习正确奖励', 'task', 'dictation_quick_review', p_task_id, p_member_id, 'star');
    end if;
  else
    -- 错误：存入全局错词库，wrong_count + 1
    insert into public.dictation_error_words
      (member_id, subject, answer, cycle_start_date, current_node, next_review_date, status, review_history, wrong_count)
    select p_member_id, p_subject, p_answer,
           current_date, 1, current_date + interval '1 day', 'in_progress', '[]', 1
    where not exists (
      select 1 from public.dictation_error_words
      where member_id = p_member_id and subject = p_subject and answer = p_answer
    );
    -- 已存在则 wrong_count + 1
    update public.dictation_error_words
    set wrong_count = wrong_count + 1
    where member_id = p_member_id and subject = p_subject and answer = p_answer;
  end if;

  return query select true, 'ok', v_star;
end;
$$ language plpgsql security definer;

revoke all on function public.save_quick_review_record(uuid, uuid, uuid, text, text, boolean, text, int, int) from public;
grant execute on function public.save_quick_review_record(uuid, uuid, uuid, text, text, boolean, text, int, int) to anon, authenticated;

notify pgrst, 'reload schema';
