-- ============================================================
-- 0052: 智慧星战答题流程改造
-- 1. 新建 question_progress 表：记录用户对每题的挑战次数/答对次数/是否掌握
-- 2. 重建 answer_question RPC：每对1题奖1星光值（不再按难度分级），答对1次即掌握自动下线
-- 3. 新增 get_challenge_analysis RPC：返回该用户对该题集所有题目的挑战分析
-- 4. 新增 award_perfect_challenge_bonus RPC：挑战结束页正确率100%时一次性奖励10星光
-- 5. questions 表新增 is_active 字段：后台可勾选下线/上线题（默认 true）
-- ============================================================

-- 1) questions 表新增 is_active 字段，用于"做对自动下线，后台勾选上线"
alter table public.questions
  add column if not exists is_active boolean not null default true;

-- 2) question_progress：用户对每道题的挑战记录
create table if not exists public.question_progress (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  attempt_count int not null default 0,
  correct_count int not null default 0,
  is_mastered boolean not null default false,
  last_attempt_at timestamptz,
  mastered_at timestamptz,  -- 首次掌握时间
  unique (member_id, question_id)
);

create index if not exists idx_qprog_member on public.question_progress(member_id);
create index if not exists idx_qprog_question on public.question_progress(question_id);

-- 3) perfect_bonus_log：记录 100% 正确率奖励发放记录，防止重复
create table if not exists public.perfect_bonus_log (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  challenge_set_id uuid not null references public.challenge_sets(id) on delete cascade,
  awarded_at timestamptz not null default now(),
  reward int not null default 10,
  unique (member_id, challenge_set_id)
);

-- 4) 重建 answer_question RPC：
-- - 每对1题固定1星光奖励（不再按难度分级）
-- - 答对1次即标记 is_mastered=true（自动下线）
-- - 100% 额外奖励通过单独 RPC award_perfect_challenge_bonus 发放
-- - 答错：加入/更新错题本，attempt_count+1
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
  v_reward int := 0;       -- 本次答题奖励
  v_bonus int := 0;        -- 兼容字段，固定为 0（100%奖励走单独 RPC）
  v_correct boolean;
  v_prog public.question_progress%rowtype;
  v_already_mastered boolean := false;
  v_now_mastered boolean := false;
begin
  select * into v_q from public.questions where id = p_question_id;
  if not found then raise exception '题目不存在'; end if;

  select * into v_set from public.challenge_sets where id = v_q.challenge_set_id;
  v_family_id := v_set.family_id;

  -- 判分（去除空格后比较，兼容多选答案如 'ABD' 与 'DAB'）
  v_correct := lower(trim(p_answer)) = lower(trim(v_q.correct_answer));

  -- 查找或创建进度记录
  select * into v_prog from public.question_progress
    where member_id = p_member_id and question_id = p_question_id;
  if not found then
    insert into public.question_progress (member_id, question_id, attempt_count, correct_count, is_mastered, last_attempt_at)
    values (p_member_id, p_question_id, 0, 0, false, now())
    returning * into v_prog;
  end if;
  v_already_mastered := v_prog.is_mastered;

  if v_correct then
    -- 每对1题固定1星光奖励
    v_reward := 1;
    v_now_mastered := true;  -- 答对1次即掌握

    -- 加星光值
    select star_value into v_star from public.members where id = p_member_id for update;
    v_star := v_star + v_reward;
    update public.members set star_value = v_star, updated_at = now() where id = p_member_id;

    -- 更新 question_progress
    update public.question_progress
    set attempt_count = attempt_count + 1,
        correct_count = correct_count + 1,
        is_mastered = true,
        last_attempt_at = now(),
        mastered_at = coalesce(mastered_at, now())
    where id = v_prog.id;

    -- 同步错题本：如果在错题本中，correct_count+1，达到2次则移除
    update public.wrong_questions
    set correct_count = correct_count + 1,
        status = case when correct_count + 1 >= 2 then 'mastered' else status end
    where member_id = p_member_id and question_id = p_question_id and status = 'active';
  else
    -- 答错：更新进度
    update public.question_progress
    set attempt_count = attempt_count + 1,
        last_attempt_at = now()
    where id = v_prog.id;

    -- 答错：加入或更新错题本
    insert into public.wrong_questions (family_id, member_id, question_id, challenge_set_id, wrong_count, last_wrong_at)
    values (v_family_id, p_member_id, p_question_id, v_q.challenge_set_id, 1, now())
    on conflict (member_id, question_id)
    do update set wrong_count = wrong_questions.wrong_count + 1, last_wrong_at = now(), status = 'active';
  end if;

  -- 记录答题
  insert into public.question_records (family_id, member_id, challenge_set_id, question_id, is_correct, reward_star)
  values (v_family_id, p_member_id, v_q.challenge_set_id, p_question_id, v_correct, v_reward);

  return query select v_correct, v_reward, v_now_mastered, v_bonus, v_star;
end;
$$;

grant execute on function public.answer_question(uuid, uuid, text) to anon, authenticated;

-- 5) award_perfect_challenge_bonus RPC：
-- 挑战结束页正确率100%时调用，一次性奖励10星光
-- 通过 perfect_bonus_log 的 unique(member_id, challenge_set_id) 约束防止重复发放
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
  -- 检查该题集所有题是否都已掌握
  select count(*) into v_total_count from public.questions where challenge_set_id = p_challenge_set_id;
  select count(*) into v_mastered_count from public.question_progress
    where member_id = p_member_id and is_mastered = true
    and question_id in (select id from public.questions where challenge_set_id = p_challenge_set_id);

  if v_total_count = 0 or v_mastered_count < v_total_count then
    return query select false, 0, (select star_value from public.members where id = p_member_id);
    return;
  end if;

  -- 检查是否已发放过（unique 约束会防止重复插入）
  begin
    select family_id into v_family_id from public.challenge_sets where id = p_challenge_set_id;
    insert into public.perfect_bonus_log (member_id, challenge_set_id, reward)
    values (p_member_id, p_challenge_set_id, v_bonus);
  exception when unique_violation then
    -- 已发放过
    return query select false, 0, (select star_value from public.members where id = p_member_id);
    return;
  end;

  -- 加星光值
  select star_value into v_star from public.members where id = p_member_id for update;
  v_star := v_star + v_bonus;
  update public.members set star_value = v_star, updated_at = now() where id = p_member_id;

  return query select true, v_bonus, v_star;
end;
$$;

grant execute on function public.award_perfect_challenge_bonus(uuid, uuid) to anon, authenticated;

-- 6) 新增 get_challenge_analysis RPC：
-- 返回该用户对该题集所有题目的挑战分析（尝试次数/答对次数/是否掌握/题目内容）
-- 用于挑战结束页的"挑战分析"展示
create or replace function public.get_challenge_analysis(
  p_member_id uuid,
  p_set_id uuid
)
returns table(
  question_id uuid,
  question_text text,
  options jsonb,
  correct_answer text,
  type text,
  is_active boolean,
  attempt_count int,
  correct_count int,
  is_mastered boolean
)
language plpgsql security definer as $$
begin
  return query
  select
    q.id as question_id,
    q.question_text,
    q.options,
    q.correct_answer,
    q.type,
    q.is_active,
    coalesce(p.attempt_count, 0) as attempt_count,
    coalesce(p.correct_count, 0) as correct_count,
    coalesce(p.is_mastered, false) as is_mastered
  from public.questions q
  left join public.question_progress p
    on p.question_id = q.id and p.member_id = p_member_id
  where q.challenge_set_id = p_set_id
  order by coalesce(q.display_order, 999999), q.created_at;
end;
$$;

grant execute on function public.get_challenge_analysis(uuid, uuid) to anon, authenticated;

-- 7) RLS 策略：用户只能看到自己的 question_progress
alter table public.question_progress enable row level security;

create policy "select own question_progress"
  on public.question_progress for select
  to authenticated
  using (member_id in (
    select id from public.members where family_id in (
      select family_id from public.members where id = auth.uid()
    )
  ));

-- 注：所有写操作通过 SECURITY DEFINER 的 answer_question / award_perfect_challenge_bonus RPC 完成，无需直接 INSERT/UPDATE 权限
