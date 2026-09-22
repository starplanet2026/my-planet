-- ============================================================
-- 0088: 智慧星战二次开发 - 数据库层重构
-- 1) challenge_sets 加 board 列（4 板块）
-- 2) 新建 challenge_levels 关卡表
-- 3) 存量题集自动建 level_no=1 默认关卡，回填 questions.level_id
-- 4) questions 加 level_id + metadata，扩展 type 支持七种题型
-- 5) 新建 challenge_level_progress 断点续做表
-- 6) 新建 wrong_battle_pool 错题混战池
-- 7) 新建 level_clear_log / set_clear_log 防重复发奖励
-- 8) 重写 answer_question RPC（固定 1/2/3 星光）
-- 9) 新增 finish_challenge_level / save_level_snapshot / load_level_snapshot / reset_level_snapshot
-- 10) 新增 get_challenge_boards / add_wrong_to_battle_pool / remove_wrong_from_battle_pool / get_wrong_battle_pool / get_wrong_question_stats
-- ============================================================

-- ====================================================
-- 一、challenge_sets 加 board 列
-- ====================================================
alter table public.challenge_sets
  add column if not exists board text not null default 'today_review'
  check (board in ('today_review','gap_check','wrong_battle','advance'));

-- ====================================================
-- 二、challenge_levels：题集内关卡
-- ====================================================
create table if not exists public.challenge_levels (
  id uuid primary key default gen_random_uuid(),
  challenge_set_id uuid not null references public.challenge_sets(id) on delete cascade,
  level_no int not null default 1,
  title text,
  pass_reward int not null default 3,           -- 关卡清零固定 3 星光
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now(),
  unique (challenge_set_id, level_no)
);

create index if not exists idx_cl_levels_set on public.challenge_levels(challenge_set_id);

-- ====================================================
-- 三、questions 加 level_id + metadata，扩展 type 约束
-- ====================================================
alter table public.questions
  add column if not exists level_id uuid references public.challenge_levels(id) on delete set null,
  add column if not exists metadata jsonb;

alter table public.questions drop constraint if exists questions_type_check;
alter table public.questions add constraint questions_type_check
  check (type in ('choice','multi_choice','spell','match','scramble','recite','correct','math'));

-- ====================================================
-- 四、为存量题集自动建默认关卡并回填 level_id
-- ====================================================
do $$
declare
  s record;
  v_level_id uuid;
begin
  for s in select id from public.challenge_sets where id not in (select challenge_set_id from public.challenge_levels) loop
    insert into public.challenge_levels (challenge_set_id, level_no, title, pass_reward, status)
    values (s.id, 1, '第 1 关', 3, 'active')
    returning id into v_level_id;
    update public.questions set level_id = v_level_id
      where challenge_set_id = s.id and level_id is null;
  end loop;
end $$;

-- ====================================================
-- 五、challenge_level_progress：断点续做
-- ====================================================
create table if not exists public.challenge_level_progress (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  level_id uuid not null references public.challenge_levels(id) on delete cascade,
  current_idx int not null default 0,
  cleared_question_ids jsonb not null default '[]'::jsonb,
  is_cleared boolean not null default false,
  is_paused boolean not null default false,
  last_played_at timestamptz,
  unique (member_id, level_id)
);

create index if not exists idx_clp_member on public.challenge_level_progress(member_id);
create index if not exists idx_clp_level on public.challenge_level_progress(level_id);

-- ====================================================
-- 六、wrong_battle_pool：错题混战池
-- ====================================================
create table if not exists public.wrong_battle_pool (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  source_challenge_set_id uuid references public.challenge_sets(id) on delete set null,
  added_by uuid references public.members(id) on delete set null,
  status text not null default 'active' check (status in ('active','removed')),
  added_at timestamptz not null default now()
);

create unique index if not exists uniq_wbp_member_question_active
  on public.wrong_battle_pool (member_id, question_id)
  where status = 'active';

create index if not exists idx_wbp_member on public.wrong_battle_pool(member_id);
create index if not exists idx_wbp_set on public.wrong_battle_pool(source_challenge_set_id);

-- ====================================================
-- 七、level_clear_log / set_clear_log：防重复发奖励
-- ====================================================
create table if not exists public.level_clear_log (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  level_id uuid not null references public.challenge_levels(id) on delete cascade,
  reward_star int not null default 3,
  cleared_at timestamptz not null default now(),
  unique (member_id, level_id)
);

create table if not exists public.set_clear_log (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  challenge_set_id uuid not null references public.challenge_sets(id) on delete cascade,
  reward_star int not null default 0,
  cleared_at timestamptz not null default now(),
  unique (member_id, challenge_set_id)
);

-- ====================================================
-- 八、重写 answer_question：固定公式 easy=1/medium=2/hard=3
-- ====================================================
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
    v_reward := case v_q.difficulty
      when 'easy' then 1
      when 'hard' then 3
      else 2
    end;
    v_now_mastered := true;

    select star_value into v_star from public.members where id = p_member_id for update;
    v_star := v_star + v_reward;
    update public.members set star_value = v_star, updated_at = now() where id = p_member_id;

    update public.question_progress
    set attempt_count = attempt_count + 1,
        correct_count = correct_count + 1,
        is_mastered = true,
        last_attempt_at = now(),
        mastered_at = coalesce(mastered_at, now())
    where id = v_prog.id;
  else
    update public.question_progress
    set attempt_count = attempt_count + 1,
        last_attempt_at = now()
    where id = v_prog.id;
  end if;

  insert into public.question_records (family_id, member_id, challenge_set_id, question_id, is_correct, reward_star)
  values (v_family_id, p_member_id, v_q.challenge_set_id, p_question_id, v_correct, v_reward);

  return query select v_correct, v_reward, v_now_mastered, v_bonus, v_star;
end;
$$;

grant execute on function public.answer_question(uuid, uuid, text) to anon, authenticated;

-- ====================================================
-- 九、finish_challenge_level：关卡清零+3 → 整集通关 floor(题数/5)
-- ====================================================
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

-- ====================================================
-- 十、save_level_snapshot / load_level_snapshot / reset_level_snapshot
-- ====================================================
create or replace function public.save_level_snapshot(
  p_member_id uuid,
  p_level_id uuid,
  p_current_idx int,
  p_cleared_ids jsonb,
  p_is_paused boolean default false
)
returns void
language plpgsql security definer as $$
declare
  v_total int;
  v_mastered int;
  v_is_cleared boolean := false;
begin
  select count(*) into v_total from public.questions
    where level_id = p_level_id and is_active = true;
  select count(*) into v_mastered from public.question_progress p
    where p.member_id = p_member_id and p.is_mastered = true
      and p.question_id in (select id from public.questions where level_id = p_level_id and is_active = true);
  if v_total > 0 and v_mastered >= v_total then
    v_is_cleared := true;
  end if;

  insert into public.challenge_level_progress
    (member_id, level_id, current_idx, cleared_question_ids, is_cleared, is_paused, last_played_at)
  values (p_member_id, p_level_id, p_current_idx, p_cleared_ids, v_is_cleared, p_is_paused, now())
  on conflict (member_id, level_id) do update
    set current_idx = excluded.current_idx,
        cleared_question_ids = excluded.cleared_question_ids,
        is_cleared = excluded.is_cleared,
        is_paused = excluded.is_paused,
        last_played_at = now();
end;
$$;

grant execute on function public.save_level_snapshot(uuid, uuid, int, jsonb, boolean) to anon, authenticated;

create or replace function public.load_level_snapshot(
  p_member_id uuid,
  p_level_id uuid
)
returns table(current_idx int, cleared_question_ids jsonb, is_cleared boolean, is_paused boolean, last_played_at timestamptz)
language plpgsql security definer as $$
begin
  return query
  select p.current_idx, p.cleared_question_ids, p.is_cleared, p.is_paused, p.last_played_at
  from public.challenge_level_progress p
  where p.member_id = p_member_id and p.level_id = p_level_id;
end;
$$;

grant execute on function public.load_level_snapshot(uuid, uuid) to anon, authenticated;

create or replace function public.reset_level_snapshot(
  p_member_id uuid,
  p_level_id uuid
)
returns void
language plpgsql security definer as $$
begin
  update public.challenge_level_progress
  set is_paused = false, last_played_at = now()
  where member_id = p_member_id and level_id = p_level_id;
end;
$$;

grant execute on function public.reset_level_snapshot(uuid, uuid) to anon, authenticated;

-- ====================================================
-- 十一、get_challenge_boards：一次性返回 4 板块题集+关卡+解锁状态
-- ====================================================
create or replace function public.get_challenge_boards(p_member_id uuid)
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
            'levels', (
              select coalesce(jsonb_agg(
                jsonb_build_object(
                  'id', lv.id,
                  'level_no', lv.level_no,
                  'title', lv.title,
                  'pass_reward', lv.pass_reward,
                  'status', lv.status,
                  'total', (select count(*) from public.questions q where q.level_id = lv.id and q.is_active = true),
                  'mastered', (
                    select count(*) from public.question_progress p
                    where p.member_id = p_member_id and p.is_mastered = true
                      and p.question_id in (select id from public.questions where level_id = lv.id and is_active = true)
                  ),
                  'is_cleared', coalesce((select p.is_cleared from public.challenge_level_progress p
                                            where p.member_id = p_member_id and p.level_id = lv.id), false),
                  'is_paused', coalesce((select p.is_paused from public.challenge_level_progress p
                                          where p.member_id = p_member_id and p.level_id = lv.id), false),
                  'cleared_ids', coalesce((select p.cleared_question_ids from public.challenge_level_progress p
                                            where p.member_id = p_member_id and p.level_id = lv.id), '[]'::jsonb),
                  'current_idx', coalesce((select p.current_idx from public.challenge_level_progress p
                                            where p.member_id = p_member_id and p.level_id = lv.id), 0)
                )
              ), '[]'::jsonb)
              from public.challenge_levels lv
              where lv.challenge_set_id = cs.id
            )
          )
        ), '[]'::jsonb)
        from public.challenge_sets cs
        where cs.board = s.board and cs.status = 'active'
      )
    )
  )
  into v_result
  from (values ('today_review'), ('gap_check'), ('wrong_battle'), ('advance')) as s(board);

  return coalesce(v_result, '[]'::jsonb);
end;
$$;

grant execute on function public.get_challenge_boards(uuid) to anon, authenticated;

-- ====================================================
-- 十二、错题混战池 RPC
-- ====================================================
create or replace function public.add_wrong_to_battle_pool(
  p_member_id uuid,
  p_question_ids uuid[],
  p_added_by uuid default null
)
returns int
language plpgsql security definer as $$
declare
  v_count int := 0;
  v_q public.questions%rowtype;
  v_family_id uuid;
  q_id uuid;
begin
  select family_id into v_family_id from public.members where id = p_member_id;

  foreach q_id in array p_question_ids loop
    select * into v_q from public.questions where id = q_id;
    if not found then continue; end if;

    insert into public.wrong_battle_pool (family_id, member_id, question_id, source_challenge_set_id, added_by, status)
    values (v_family_id, p_member_id, q_id, v_q.challenge_set_id, p_added_by, 'active')
    on conflict (member_id, question_id) where status = 'active'
    do nothing;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

grant execute on function public.add_wrong_to_battle_pool(uuid, uuid[], uuid) to anon, authenticated;

create or replace function public.remove_wrong_from_battle_pool(
  p_pool_ids uuid[]
)
returns int
language plpgsql security definer as $$
declare
  v_count int;
begin
  update public.wrong_battle_pool
  set status = 'removed'
  where id = any(p_pool_ids) and status = 'active';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.remove_wrong_from_battle_pool(uuid[]) to anon, authenticated;

create or replace function public.get_wrong_battle_pool(p_member_id uuid)
returns table(
  pool_id uuid,
  question_id uuid,
  source_challenge_set_id uuid,
  added_at timestamptz,
  question_text text,
  options jsonb,
  correct_answer text,
  explanation text,
  type text,
  difficulty text,
  metadata jsonb
)
language plpgsql security definer as $$
begin
  return query
  select
    wbp.id as pool_id,
    q.id as question_id,
    wbp.source_challenge_set_id,
    wbp.added_at,
    q.question_text,
    q.options,
    q.correct_answer,
    q.explanation,
    q.type,
    q.difficulty,
    q.metadata
  from public.wrong_battle_pool wbp
  join public.questions q on q.id = wbp.question_id
  where wbp.member_id = p_member_id and wbp.status = 'active'
  order by wbp.added_at;
end;
$$;

grant execute on function public.get_wrong_battle_pool(uuid) to anon, authenticated;

-- ====================================================
-- 十三、get_wrong_question_stats：后台筛选高错误率题目
-- ====================================================
create or replace function public.get_wrong_question_stats(
  p_member_id uuid default null,
  p_challenge_set_id uuid default null
)
returns table(
  question_id uuid,
  challenge_set_id uuid,
  question_text text,
  type text,
  difficulty text,
  display_order int,
  attempt_count int,
  correct_count int,
  wrong_count int,
  error_rate numeric,
  is_mastered boolean,
  member_id uuid,
  member_name text
)
language plpgsql security definer as $$
begin
  return query
  select
    q.id as question_id,
    q.challenge_set_id,
    q.question_text,
    q.type,
    q.difficulty,
    coalesce(q.display_order, 0) as display_order,
    coalesce(p.attempt_count, 0) as attempt_count,
    coalesce(p.correct_count, 0) as correct_count,
    greatest(coalesce(p.attempt_count, 0) - coalesce(p.correct_count, 0), 0) as wrong_count,
    case
      when coalesce(p.attempt_count, 0) = 0 then 0
      else round((coalesce(p.attempt_count, 0) - coalesce(p.correct_count, 0))::numeric / coalesce(p.attempt_count, 0) * 100, 2)
    end as error_rate,
    coalesce(p.is_mastered, false) as is_mastered,
    m.id as member_id,
    m.name as member_name
  from public.questions q
  left join public.question_progress p on p.question_id = q.id
  left join public.members m on m.id = p.member_id
  where (p_member_id is null or p.member_id = p_member_id)
    and (p_challenge_set_id is null or q.challenge_set_id = p_challenge_set_id)
  order by error_rate desc, attempt_count desc;
end;
$$;

grant execute on function public.get_wrong_question_stats(uuid, uuid) to anon, authenticated;

-- ====================================================
-- 十四、RLS 策略
-- ====================================================
alter table public.challenge_levels enable row level security;
alter table public.challenge_level_progress enable row level security;
alter table public.wrong_battle_pool enable row level security;
alter table public.level_clear_log enable row level security;
alter table public.set_clear_log enable row level security;

create policy "challenge_levels_select" on public.challenge_levels for select using (true);
create policy "challenge_levels_insert" on public.challenge_levels for insert with check (true);
create policy "challenge_levels_update" on public.challenge_levels for update using (true);
create policy "challenge_levels_delete" on public.challenge_levels for delete using (true);

create policy "clp_select" on public.challenge_level_progress for select using (true);
create policy "clp_insert" on public.challenge_level_progress for insert with check (true);
create policy "clp_update" on public.challenge_level_progress for update using (true);

create policy "wbp_select" on public.wrong_battle_pool for select using (true);
create policy "wbp_insert" on public.wrong_battle_pool for insert with check (true);
create policy "wbp_update" on public.wrong_battle_pool for update using (true);
create policy "wbp_delete" on public.wrong_battle_pool for delete using (true);

create policy "lcl_select" on public.level_clear_log for select using (true);
create policy "scl_select" on public.set_clear_log for select using (true);
