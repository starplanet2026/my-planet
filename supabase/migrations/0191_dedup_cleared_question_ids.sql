-- 0191: 清理 challenge_level_progress.cleared_question_ids 中的重复 ID
-- 背景：前端 bug 导致同一题目 ID 被多次追加到 clearedIds，
--       save_level_snapshot 原样存入数据库，进度显示出现 59/50 等异常。

update public.challenge_level_progress
  set cleared_question_ids = (
    select jsonb_agg(distinct val)
    from jsonb_array_elements(cleared_question_ids) as e(val)
  )
  where cleared_question_ids is not null
    and jsonb_array_length(cleared_question_ids) > 0
    and cleared_question_ids != (
      select jsonb_agg(distinct val)
      from jsonb_array_elements(cleared_question_ids) as e(val)
    );
