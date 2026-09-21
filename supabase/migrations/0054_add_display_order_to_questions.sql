-- 0054: 确保 questions 表有 display_order 列
-- 修复批量导入时 "Could not find the 'display_order' column of 'questions' in the schema cache" 错误
-- 迁移 0022 可能未执行或未生效，此处用 IF NOT EXISTS 兜底

alter table public.questions
  add column if not exists display_order int default 0;

comment on column public.questions.display_order is '题目排序，数字越小越靠前';

-- 触发 schema cache 刷新（Supabase 在 DDL 后自动刷新）
