-- 0295: 成就卡新增「类别」字段（如 好习惯 / 好健康 / 好成绩 / 好努力）
-- 背景：成就清单 Excel 模板中的「类别」列此前无对应字段被丢弃，现改为正式入库，
-- 并在孩子端成就卡片左上角以 tag 形式展示（与特权卡分类标签一致）。

alter table public.tasks
  add column if not exists subcategory text;

alter table public.achievement_templates
  add column if not exists subcategory text;

comment on column public.tasks.subcategory is '成就类别标签，如 好习惯/好健康/好成绩/好努力';
comment on column public.achievement_templates.subcategory is '模板成就类别标签';
