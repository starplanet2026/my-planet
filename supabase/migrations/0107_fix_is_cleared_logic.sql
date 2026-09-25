-- 0107_fix_is_cleared_logic.sql
-- 修复：题集未完成却显示"查看题集"、无法做题
-- 根因：get_challenge_boards 中 is_cleared 用 bool_and(p.is_mastered) 判断，
--       该聚合只对【已有进度记录】的题目取与；若某关有 5 题、用户只掌握了 2 题
--       （另 3 题从未作答、无进度记录），bool_and(true,true) 返回 true，
--       导致 is_cleared 误判为已通关 → 前端 state===2 → 按钮显示"查看题集"。
-- 修复：is_cleared = (掌握题数 == 该关活跃题总数) AND (总数 > 0)。
--       仅当该关所有活跃题都已掌握才算通关，未作答的题视为未通关。

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
