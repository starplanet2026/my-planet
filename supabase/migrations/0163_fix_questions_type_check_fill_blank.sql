-- ====== 修复 questions 表 type 约束，新增 fill_blank ======
-- 0159 迁移遗漏了更新 questions_type_check 约束，导致填空题导入时报错

alter table public.questions drop constraint if exists questions_type_check;
alter table public.questions add constraint questions_type_check
  check (type in ('choice','multi_choice','spell','match','scramble','recite','correct','math','fill_blank'));
