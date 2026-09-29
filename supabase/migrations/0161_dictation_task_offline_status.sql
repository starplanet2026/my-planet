-- ====== 家默任务管理：新增 offline 状态支持上线/下线 ======

-- 1. 扩展 dictation_tasks.status 约束，新增 'offline' 状态
--    active: 已上线（孩子端可见）
--    offline: 已下线（孩子端不可见，家长可重新上线）
--    completed: 已完成（孩子提交批改后自动标记）
alter table public.dictation_tasks drop constraint if exists dictation_tasks_status_check;
alter table public.dictation_tasks add constraint dictation_tasks_status_check
  check (status in ('active', 'offline', 'completed'));

-- 2. 索引：按 member_id + status 查询（含 offline 历史任务）
drop index if exists idx_dictation_tasks_member_status;
create index if not exists idx_dictation_tasks_member_status on public.dictation_tasks(member_id, status);
