-- ============================================================
-- 0047: 修复 wrong_questions ON CONFLICT 报错
-- 问题：answer_question / answer_word RPC 使用 on conflict (member_id, question_id/word_id)
-- 但表上只有部分唯一索引（WHERE status='active'），缺少完整唯一约束
-- PostgreSQL 的 ON CONFLICT 在部分索引上可能无法匹配，导致答题报错：
-- "there is no unique or exclusion constraint matching the ON CONFLICT specification"
-- ============================================================

-- 1. 清理重复数据：对每个 (member_id, question_id) 只保留一条（优先 active，再按创建时间最早）
delete from public.wrong_questions
where question_id is not null
  and id not in (
    select distinct on (member_id, question_id) id
    from public.wrong_questions
    where question_id is not null
    order by member_id, question_id,
      case when status = 'active' then 0 else 1 end,
      created_at asc
  );

-- 2. 清理重复数据：对每个 (member_id, word_id) 只保留一条（优先 active，再按创建时间最早）
delete from public.wrong_questions
where word_id is not null
  and id not in (
    select distinct on (member_id, word_id) id
    from public.wrong_questions
    where word_id is not null
    order by member_id, word_id,
      case when status = 'active' then 0 else 1 end,
      created_at asc
  );

-- 3. 删除旧的部分唯一索引（0009 创建，WHERE status='active'）
--    部分索引在 ON CONFLICT 匹配时可能失败，用完整唯一约束替代
drop index if exists public.uniq_wrong_q_member_question;
drop index if exists public.uniq_wrong_q_member_word;

-- 4. 删除旧的完整唯一约束（0023 可能已添加，先删后加确保幂等）
alter table public.wrong_questions
  drop constraint if exists uq_wrong_questions_member_question;
alter table public.wrong_questions
  drop constraint if exists uq_wrong_questions_member_word;

-- 5. 添加完整唯一约束
--    注意：PostgreSQL 中 NULL 值在唯一约束中不视为相等，
--    所以 (member_id, question_id) 唯一约束只对 question_id 非空的行生效，
--    (member_id, word_id) 唯一约束只对 word_id 非空的行生效，
--    不会互相干扰（一道错题要么有 question_id，要么有 word_id）。
alter table public.wrong_questions
  add constraint uq_wrong_questions_member_question
  unique (member_id, question_id);

alter table public.wrong_questions
  add constraint uq_wrong_questions_member_word
  unique (member_id, word_id);
