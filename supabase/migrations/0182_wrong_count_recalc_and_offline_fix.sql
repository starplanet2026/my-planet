-- 0182: 错题作答次数统计异常修复 + 全局错题状态数据矫正（幂等重算）
-- 背景：wrong_questions.correct_count 只统计「首次答错之后」的答对次数，
--   首次答错前的答对次数丢失，导致 答对次数 + 答错次数 != 总作答次数；
--   且查看错题弹窗与错题混战池曾读取不同数据源，造成状态判定不一致。
-- 本迁移以 question_records（原始答题日志）为唯一真值，全量重算：
--   1. question_progress：attempt_count / correct_count / is_mastered
--   2. wrong_questions：wrong_count / correct_count / status
--   3. wrong_battle_pool：status（active/offline）
-- 业务判定规则：当 答对次数 >= 错误次数 + 1 时，题目下线（mastered / offline）。
-- 幂等保证：可重复执行，结果一致。

-- ========== 1. 重算 question_progress（以 question_records 为真值） ==========
with rec as (
  select
    r.member_id,
    r.question_id,
    count(*) as attempt_count,
    count(*) filter (where r.is_correct) as correct_count
  from public.question_records r
  where r.question_id is not null
    and exists (select 1 from public.questions q where q.id = r.question_id)
  group by r.member_id, r.question_id
)
insert into public.question_progress (member_id, question_id, attempt_count, correct_count, is_mastered, last_attempt_at)
select
  rec.member_id,
  rec.question_id,
  rec.attempt_count,
  rec.correct_count,
  (rec.correct_count >= (rec.attempt_count - rec.correct_count) + 1) as is_mastered,
  now()
from rec
on conflict (member_id, question_id)
do update set
  attempt_count = excluded.attempt_count,
  correct_count = excluded.correct_count,
  is_mastered = excluded.is_mastered;

-- ========== 2. 重算 wrong_questions（仅保留有答错记录的题目，计数来自 question_records） ==========
with rec as (
  select
    r.member_id,
    r.question_id,
    count(*) filter (where not r.is_correct) as wrong_count,
    count(*) filter (where r.is_correct) as correct_count,
    max(r.answered_at) filter (where not r.is_correct) as last_wrong_at,
    (array_agg(q.challenge_set_id))[1] as challenge_set_id,
    (array_agg(q.level_id))[1] as level_id
  from public.question_records r
  join public.questions q on q.id = r.question_id
  where r.question_id is not null
  group by r.member_id, r.question_id
  having count(*) filter (where not r.is_correct) > 0
),
fam as (
  select m.id as member_id, m.family_id from public.members m
)
insert into public.wrong_questions
  (family_id, member_id, question_id, challenge_set_id, level_id, wrong_count, correct_count, last_wrong_at, status, offline_reason, offlined_at)
select
  fam.family_id,
  rec.member_id,
  rec.question_id,
  rec.challenge_set_id,
  rec.level_id,
  rec.wrong_count,
  rec.correct_count,
  rec.last_wrong_at,
  case when rec.correct_count >= rec.wrong_count + 1 then 'mastered' else 'active' end,
  case when rec.correct_count >= rec.wrong_count + 1 then 'auto' else null end,
  case when rec.correct_count >= rec.wrong_count + 1 then now() else null end
from rec
join fam on fam.member_id = rec.member_id
on conflict (member_id, question_id)
do update set
  wrong_count = excluded.wrong_count,
  correct_count = excluded.correct_count,
  last_wrong_at = excluded.last_wrong_at,
  status = excluded.status,
  offline_reason = excluded.offline_reason,
  offlined_at = excluded.offlined_at,
  level_id = coalesce(excluded.level_id, wrong_questions.level_id);

-- 清理：没有任何答错记录的 wrong_questions（计数矫正后应下线/删除）
delete from public.wrong_questions wq
where wq.question_id is not null
  and not exists (
    select 1 from public.question_records r
    where r.member_id = wq.member_id and r.question_id = wq.question_id and not r.is_correct
  );

-- ========== 3. 重新判定错题混战池上线/下线状态 ==========
-- 下线条件：答对次数 >= 错误次数 + 1
update public.wrong_battle_pool wbp
set
  status = case
    when qp.correct_count >= (qp.attempt_count - qp.correct_count) + 1 then 'offline'
    else 'active'
  end,
  offline_reason = case
    when qp.correct_count >= (qp.attempt_count - qp.correct_count) + 1 then 'auto'
    else null
  end,
  offlined_at = case
    when qp.correct_count >= (qp.attempt_count - qp.correct_count) + 1 then now()
    else null
  end
from public.question_progress qp
where wbp.member_id = qp.member_id and wbp.question_id = qp.question_id;

-- 清理混战池中已无答错记录的条目（不应再出现在池中）
delete from public.wrong_battle_pool wbp
where not exists (
  select 1 from public.question_records r
  where r.member_id = wbp.member_id and r.question_id = wbp.question_id and not r.is_correct
);

notify pgrst, 'reload schema';
