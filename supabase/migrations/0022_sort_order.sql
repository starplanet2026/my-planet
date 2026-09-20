-- ============================================================
-- 0022: 任务排序 + 题目排序
-- 1. tasks 表加 sort_order（int, 默认 0）
-- 2. questions 表加 display_order（int, 默认 0）
-- ============================================================

-- 1. tasks 加 sort_order
alter table public.tasks
  add column if not exists sort_order int not null default 0;

-- 2. questions 加 display_order
alter table public.questions
  add column if not exists display_order int not null default 0;

-- 3. 存量数据初始化：按 created_at 排序赋值
with ranked as (
  select id, row_number() over (order by created_at) as rn
  from public.tasks
)
update public.tasks t set sort_order = ranked.rn
  from ranked where t.id = ranked.id and t.sort_order = 0;

with ranked_q as (
  select id, row_number() over (partition by challenge_set_id order by created_at) as rn
  from public.questions
)
update public.questions q set display_order = ranked_q.rn
  from ranked_q where q.id = ranked_q.id and q.display_order = 0;
