-- 0242: 家长管理后台功能按钮自定义布局
-- 存储各板块按钮的顺序与归属：{ "quick": [...labels], "achievement": [...], ... }
alter table public.families
  add column if not exists dashboard_layout jsonb;

notify pgrst, 'reload schema';
