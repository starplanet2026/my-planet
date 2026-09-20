-- ============================================================
-- 0023: 修复 wrong_questions 表缺少唯一约束导致 ON CONFLICT 报错
-- answer_question RPC 使用 on conflict (member_id, question_id)
-- 但表上没有对应的唯一约束，导致答题提交时报错
-- ============================================================

-- 先清理可能存在的重复数据（保留最早创建的）
delete from public.wrong_questions
  where id not in (
    select distinct on (member_id, question_id) id
    from public.wrong_questions
    order by member_id, question_id, created_at asc
  );

-- 添加唯一约束
alter table public.wrong_questions
  add constraint uq_wrong_questions_member_question
  unique (member_id, question_id);
