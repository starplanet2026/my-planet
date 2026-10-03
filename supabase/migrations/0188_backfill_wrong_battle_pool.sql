-- 0188: 回填错题混战池 —— 补齐 question_progress 中有错但未入池的题目
-- 背景：answer_question 仅在答错时往 wrong_battle_pool 插记录。
--       历史数据（池功能上线前）或入池逻辑缺失的版本中，
--       question_progress 有 wrong>0 记录，但 wrong_battle_pool 无对应 active 记录，
--       导致"查看错题"题目数 > "错题大混战池"题目数。
-- 本迁移：对所有 (member, question) 满足 wrong_count>0 且未掌握，
--         确保 wrong_battle_pool 中有一条 active 记录。

-- ① 已有池中记录但状态非 active（removed/offline/mastered）→ 恢复为 active
update public.wrong_battle_pool wbp
set status = 'active',
    offline_reason = null,
    offlined_at = null
from public.question_progress qp
where wbp.member_id = qp.member_id
  and wbp.question_id = qp.question_id
  and wbp.status <> 'active'
  and (qp.attempt_count - qp.correct_count) > 0
  and qp.correct_count < (qp.attempt_count - qp.correct_count) + 1;

-- ② 池中完全没有记录的 → 新插 active 记录
with missing as (
  select
    qp.member_id,
    qp.question_id,
    q.challenge_set_id,
    q.level_id,
    m.family_id
  from public.question_progress qp
  join public.questions q on q.id = qp.question_id
  join public.members m on m.id = qp.member_id
  where (qp.attempt_count - qp.correct_count) > 0
    and qp.correct_count < (qp.attempt_count - qp.correct_count) + 1
    and not exists (
      select 1 from public.wrong_battle_pool wbp
      where wbp.member_id = qp.member_id
        and wbp.question_id = qp.question_id
    )
)
insert into public.wrong_battle_pool
  (family_id, member_id, question_id, source_challenge_set_id, source_level_id, status)
select
  family_id, member_id, question_id, challenge_set_id, level_id, 'active'
from missing;
