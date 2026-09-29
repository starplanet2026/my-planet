-- 0149: 追溯历史答题记录到错题下线逻辑
-- 背景：0148 将下线规则从「答对1次即下线」改为「correct_count >= wrong_count + 1」，
--       且旧版 record_levelup_quiz_answer（宠物升级挑战）只写 question_records 不更新 wrong_questions。
-- 本迁移从 question_records 重新统计 wrong_questions 的 correct_count / wrong_count，
-- 并应用新下线规则，同步 wrong_battle_pool 状态。

-- ============================================================
-- ① 题目类（question_id）：重算计数 + 应用下线规则
-- ============================================================

-- 更新已存在的 wrong_questions 行
with stats as (
  select
    member_id,
    question_id,
    count(*) filter (where is_correct) as correct_cnt,
    count(*) filter (where not is_correct) as wrong_cnt
  from public.question_records
  where question_id is not null
  group by member_id, question_id
)
update public.wrong_questions wq
set
  wrong_count = s.wrong_cnt,
  correct_count = s.correct_cnt,
  status = case when s.correct_cnt >= s.wrong_cnt + 1 then 'mastered' else 'active' end,
  offline_reason = case
    when s.correct_cnt >= s.wrong_cnt + 1 then coalesce(wq.offline_reason, 'auto')
    else case when wq.offline_reason = 'auto' then null else wq.offline_reason end
  end,
  offlined_at = case
    when s.correct_cnt >= s.wrong_cnt + 1 then coalesce(wq.offlined_at, now())
    else case when wq.offline_reason = 'auto' then null else wq.offlined_at end
  end
from stats s
where wq.member_id = s.member_id
  and wq.question_id = s.question_id;

-- 插入 question_records 中有错题记录但 wrong_questions 中不存在的行
insert into public.wrong_questions
  (family_id, member_id, question_id, wrong_count, correct_count, status, last_wrong_at, offline_reason, offlined_at)
select
  m.family_id,
  s.member_id,
  s.question_id,
  s.wrong_cnt,
  s.correct_cnt,
  case when s.correct_cnt >= s.wrong_cnt + 1 then 'mastered' else 'active' end,
  now(),
  case when s.correct_cnt >= s.wrong_cnt + 1 then 'auto' else null end,
  case when s.correct_cnt >= s.wrong_cnt + 1 then now() else null end
from (
  select
    member_id,
    question_id,
    count(*) filter (where is_correct) as correct_cnt,
    count(*) filter (where not is_correct) as wrong_cnt
  from public.question_records
  where question_id is not null
  group by member_id, question_id
) s
join public.members m on m.id = s.member_id
where s.wrong_cnt > 0
  and not exists (
    select 1 from public.wrong_questions wq
    where wq.member_id = s.member_id and wq.question_id = s.question_id
  );

-- ============================================================
-- ② 单词类（word_id，萌宠闯关）：重算计数 + 应用下线规则（不进混战池）
-- ============================================================

with stats as (
  select
    member_id,
    word_id,
    count(*) filter (where is_correct) as correct_cnt,
    count(*) filter (where not is_correct) as wrong_cnt
  from public.question_records
  where word_id is not null
  group by member_id, word_id
)
update public.wrong_questions wq
set
  wrong_count = s.wrong_cnt,
  correct_count = s.correct_cnt,
  status = case when s.correct_cnt >= s.wrong_cnt + 1 then 'mastered' else 'active' end,
  offline_reason = case
    when s.correct_cnt >= s.wrong_cnt + 1 then coalesce(wq.offline_reason, 'auto')
    else case when wq.offline_reason = 'auto' then null else wq.offline_reason end
  end,
  offlined_at = case
    when s.correct_cnt >= s.wrong_cnt + 1 then coalesce(wq.offlined_at, now())
    else case when wq.offline_reason = 'auto' then null else wq.offlined_at end
  end
from stats s
where wq.member_id = s.member_id
  and wq.word_id = s.word_id;

insert into public.wrong_questions
  (family_id, member_id, word_id, wrong_count, correct_count, status, last_wrong_at, offline_reason, offlined_at)
select
  m.family_id,
  s.member_id,
  s.word_id,
  s.wrong_cnt,
  s.correct_cnt,
  case when s.correct_cnt >= s.wrong_cnt + 1 then 'mastered' else 'active' end,
  now(),
  case when s.correct_cnt >= s.wrong_cnt + 1 then 'auto' else null end,
  case when s.correct_cnt >= s.wrong_cnt + 1 then now() else null end
from (
  select
    member_id,
    word_id,
    count(*) filter (where is_correct) as correct_cnt,
    count(*) filter (where not is_correct) as wrong_cnt
  from public.question_records
  where word_id is not null
  group by member_id, word_id
) s
join public.members m on m.id = s.member_id
where s.wrong_cnt > 0
  and not exists (
    select 1 from public.wrong_questions wq
    where wq.member_id = s.member_id and wq.word_id = s.word_id
  );

-- ============================================================
-- ③ 同步错题混战池：达标自动下线
-- ============================================================

update public.wrong_battle_pool wbp
set status = 'offline', offline_reason = 'auto', offlined_at = now()
from public.wrong_questions wq
where wbp.member_id = wq.member_id
  and wbp.question_id = wq.question_id
  and wbp.status = 'active'
  and wq.status = 'mastered'
  and wq.question_id is not null;

-- ============================================================
-- ④ 同步错题混战池：不再达标且原为自动下线的，重新上线
--    （手动下线的题目不自动恢复，尊重家长操作）
-- ============================================================

update public.wrong_battle_pool wbp
set status = 'active', offline_reason = null, offlined_at = null
from public.wrong_questions wq
where wbp.member_id = wq.member_id
  and wbp.question_id = wq.question_id
  and wbp.status = 'offline'
  and wbp.offline_reason = 'auto'
  and wq.status = 'active'
  and wq.question_id is not null;

notify pgrst, 'reload schema';
