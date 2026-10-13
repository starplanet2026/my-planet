-- 0241: 修复家长审批批改结果报错
-- 报错：42703 column "completed_at" of relation "dictation_tasks" does not exist
-- 原因：approve_dictation_submission（0231/0232）审批通过时执行
--       update dictation_tasks set status='completed', completed_at=now()，
--       但 dictation_tasks 建表(0120)从未有 completed_at 列，审批必崩并整体回滚。
-- 修复：补齐 completed_at 列（可空，仅任务完成时写入）

alter table public.dictation_tasks
  add column if not exists completed_at timestamptz;

-- 存量已完成任务回填完成时间（取更新时间作为近似值）
update public.dictation_tasks
  set completed_at = updated_at
  where status = 'completed' and completed_at is null;

notify pgrst, 'reload schema';
