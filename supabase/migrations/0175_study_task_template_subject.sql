-- 0175: 陪伴学习任务模板增加学科字段
-- 新增 subject 列：chinese(语文) / math(数学) / english(英语)，默认 chinese
-- 历史数据 subject = 'chinese'

alter table public.study_task_templates
  add column if not exists subject text not null default 'chinese';

-- 添加学科索引（方便按学科分组查询）
create index if not exists idx_study_task_templates_member_subject
  on public.study_task_templates(member_id, subject, display_order);

notify pgrst, 'reload schema';
