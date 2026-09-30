-- 0173: 错题混战池 RPC 增加 answer2 字段
-- 问题：升级挑战从错题混战池取题，但 get_wrong_battle_pool / get_wrong_battle_pool_offline
--       未返回 answer2 字段，导致双空填空题第二空答案丢失，前端只能渲染 1 个输入框
-- 修复：重写两个 RPC，返回 q.answer2

-- ============================================================
-- 一、重写 get_wrong_battle_pool：增加 answer2
-- ============================================================
drop function if exists public.get_wrong_battle_pool(uuid);

create function public.get_wrong_battle_pool(p_member_id uuid)
returns table(
  pool_id uuid,
  question_id uuid,
  source_challenge_set_id uuid,
  added_at timestamptz,
  question_text text,
  options jsonb,
  correct_answer text,
  answer2 text,
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
    q.answer2,
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

-- ============================================================
-- 二、重写 get_wrong_battle_pool_offline：增加 answer2
-- ============================================================
drop function if exists public.get_wrong_battle_pool_offline(uuid);

create function public.get_wrong_battle_pool_offline(p_member_id uuid)
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
  answer2 text,
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
    q.answer2,
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
