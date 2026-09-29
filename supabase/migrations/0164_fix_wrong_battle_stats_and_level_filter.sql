-- ====== 修复错题混战管理：题集筛选支持关卡关联题目 + 池中显示错次/错误率 + 关卡筛选 ======

-- 先 DROP 旧函数（返回类型变更，不能直接 CREATE OR REPLACE）
drop function if exists public.get_wrong_question_stats(uuid, uuid);
drop function if exists public.get_wrong_battle_pool(uuid);
drop function if exists public.get_wrong_battle_pool_offline(uuid);

-- 1. 重写 get_wrong_question_stats：
--    - 题集筛选时同时匹配 q.challenge_set_id 和通过 level_id 关联的 challenge_levels.challenge_set_id
--    - 新增 p_level_id 参数，支持按关卡筛选
create or replace function public.get_wrong_question_stats(
  p_member_id uuid default null,
  p_challenge_set_id uuid default null,
  p_level_id uuid default null
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
  member_name text,
  level_id uuid
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
    m.name as member_name,
    q.level_id as level_id
  from public.questions q
  left join public.question_progress p on p.question_id = q.id
  left join public.members m on m.id = p.member_id
  left join public.challenge_levels cl on cl.id = q.level_id
  where (p_member_id is null or p.member_id = p_member_id)
    and (
      p_challenge_set_id is null
      or q.challenge_set_id = p_challenge_set_id
      or cl.challenge_set_id = p_challenge_set_id
    )
    and (p_level_id is null or q.level_id = p_level_id)
  order by error_rate desc, attempt_count desc;
end;
$$;

grant execute on function public.get_wrong_question_stats(uuid, uuid, uuid) to anon, authenticated;

-- 2. 重写 get_wrong_battle_pool：返回 wrong_count / attempt_count / error_rate
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
  metadata jsonb,
  wrong_count int,
  attempt_count int,
  error_rate numeric
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
    q.metadata,
    greatest(coalesce(p.attempt_count, 0) - coalesce(p.correct_count, 0), 0) as wrong_count,
    coalesce(p.attempt_count, 0) as attempt_count,
    case
      when coalesce(p.attempt_count, 0) = 0 then 0
      else round((coalesce(p.attempt_count, 0) - coalesce(p.correct_count, 0))::numeric / coalesce(p.attempt_count, 0) * 100, 2)
    end as error_rate
  from public.wrong_battle_pool wbp
  join public.questions q on q.id = wbp.question_id
  left join public.question_progress p on p.question_id = q.id and p.member_id = wbp.member_id
  where wbp.member_id = p_member_id and wbp.status = 'active'
  order by wbp.added_at;
end;
$$;

grant execute on function public.get_wrong_battle_pool(uuid) to anon, authenticated;

-- 3. 重写 get_wrong_battle_pool_offline：返回 wrong_count / attempt_count / error_rate
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
  difficulty text,
  wrong_count int,
  attempt_count int,
  error_rate numeric
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
    q.difficulty,
    greatest(coalesce(p.attempt_count, 0) - coalesce(p.correct_count, 0), 0) as wrong_count,
    coalesce(p.attempt_count, 0) as attempt_count,
    case
      when coalesce(p.attempt_count, 0) = 0 then 0
      else round((coalesce(p.attempt_count, 0) - coalesce(p.correct_count, 0))::numeric / coalesce(p.attempt_count, 0) * 100, 2)
    end as error_rate
  from public.wrong_battle_pool wbp
  join public.questions q on q.id = wbp.question_id
  left join public.question_progress p on p.question_id = q.id and p.member_id = wbp.member_id
  where wbp.member_id = p_member_id and wbp.status = 'offline'
  order by wbp.offlined_at desc nulls last;
end;
$$;

grant execute on function public.get_wrong_battle_pool_offline(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
