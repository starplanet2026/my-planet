-- ============================================================
-- update_v3.sql
-- 1. tasks 表增加 'draft' 草稿状态，新建任务默认为草稿
-- 2. 录入今日任务（图片表）
-- ============================================================

-- ============ 1. 任务状态增加 'draft' ============
alter table public.tasks drop constraint if exists tasks_status_check;
alter table public.tasks add constraint tasks_status_check
  check (status in ('draft','active','completed','expired','deleted'));

-- 新建任务默认为草稿（需家长发布后才在儿童端显示）
alter table public.tasks alter column status set default 'draft';

-- ============ 2. 录入今日任务 ============
-- 根据图片表格录入 19 条任务，状态为 active（已发布）
-- created_by 取家庭中 parent 成员
insert into public.tasks (family_id, member_id, title, description, category, reward_coins, status, created_by)
select f.id, null, x.title, x.description, x.category, x.reward_coins, 'active', m.id
from public.families f
cross join public.members m
cross join (values
  -- 今日日常任务
  ('早起鸟'::text, '早上6:50下楼。下楼前已完成刷牙、洗脸、穿衣（上学日校服戴红领巾、周末OOTD）。时效：当天，每天0点自动重新上线'::text, 'daily'::text, 1::int),
  ('早餐光盘', '盘中早餐全吃完。时效：当天，每天0点自动重新上线', 'daily', 1),
  ('每日一鸡蛋', '早餐吃一颗鸡蛋。时效：当天，每天0点自动重新上线', 'daily', 1),
  ('校内高效', '放学前在学校完成所有校内书面作业、小三项作业。时效：当天，每天0点自动重新上线，周一~周五', 'daily', 1),
  ('默写全对', '校内英语或语文0号本默写全对，获得⭐。时效：当天，每天0点自动重新上线，周一~周五', 'daily', 1),
  ('晚饭前完成学习任务', '晚饭前做完校内作业与校内复习任务。时效：当天，每天0点自动重新上线，周一~周五', 'daily', 1),
  ('英语家默', '完成家默本默写及订正。时效：当天，每天0点自动重新上线，周一~周五', 'daily', 1),
  ('小三项', '完成当日小三项并订正错误，要求书写工整。书写或订正潦草-3。时效：当天，每天0点自动重新上线，周一~周五', 'daily', 2),
  ('成功日记', '记录今天的成功事项。时效：当天，每天0点自动重新上线，周一~周五', 'daily', 2),
  ('课外阅读', '每天阅读15min（老师指定书目）。时效：当天，每天0点自动重新上线，周一~周五', 'daily', 1),
  ('整理书包', '睡前整理好书包。时效：当天，每天0点自动重新上线，周一~周五、周日', 'daily', 1),
  -- 阶段任务（课外班）
  ('外教课', '上课并不迟到。时效：每周六', 'stage', 3),
  ('外教课作业', '完成并书写工整。书写潦草-3', 'stage', 3),
  ('数学课', '上课并不迟到。时效：每周日', 'stage', 3),
  ('数学课作业', '完成并书写工整。书写潦草-3', 'stage', 3),
  ('写字课', '上课并不迟到。时效：每周日，两周一次', 'stage', 3),
  ('足球课', '上课并不迟到。时效：每周日', 'stage', 3),
  ('大运动', '羽毛球/皮克球/网球/游泳，居家运动不算。时效：每周日', 'stage', 1),
  ('阅读理解网课', '听完一节网课并完成学习册笔记填空。时效：每周2节', 'stage', 2)
) as x(title, description, category, reward_coins)
where m.family_id = f.id and m.role = 'parent';
