-- 0092: Add difficulty counts to get_challenge_boards RPC
-- Each set now includes easy_count, medium_count, hard_count

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
            'easy_count', (select count(*) from public.questions q join public.challenge_levels lv on lv.id = q.level_id where lv.challenge_set_id = cs.id and q.is_active = true and q.difficulty = 'easy'),
            'medium_count', (select count(*) from public.questions q join public.challenge_levels lv on lv.id = q.level_id where lv.challenge_set_id = cs.id and q.is_active = true and q.difficulty = 'medium'),
            'hard_count', (select count(*) from public.questions q join public.challenge_levels lv on lv.id = q.level_id where lv.challenge_set_id = cs.id and q.is_active = true and q.difficulty = 'hard'),
            'levels', (
              select coalesce(jsonb_agg(
                jsonb_build_object(
                  'id', lv.id,
                  'level_no', lv.level_no,
                  'title', lv.title,
                  'description', lv.description,
                  'pass_reward', lv.pass_reward,
                  'status', lv.status,
                  'total', (select count(*) from public.questions q where q.level_id = lv.id and q.is_active = true),
                  'mastered', (
                    select count(*) from public.question_progress p
                    where p.question_id in (select id from public.questions where level_id = lv.id and is_active = true)
                      and p.member_id = p_member_id
                      and p.is_mastered = true
                  ),
                  'is_cleared', (
                    select coalesce(bool_and(p.is_mastered), false) from public.question_progress p
                    where p.question_id in (select id from public.questions where level_id = lv.id and is_active = true)
                      and p.member_id = p_member_id
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
                order by lv.level_no
              ), '[]'::jsonb)
              from public.challenge_levels lv
              where lv.challenge_set_id = cs.id and lv.status = 'active'
            )
          )
          order by cs.created_at desc
        ), '[]'::jsonb)
        from public.challenge_sets cs
        where cs.board = s.board
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

  return v_result;
end;
$$;

grant execute on function public.get_challenge_boards(uuid) to anon, authenticated;
