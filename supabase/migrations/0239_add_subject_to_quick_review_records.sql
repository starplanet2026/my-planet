-- 0239: 给 dictation_quick_review_records 表补充 subject 列
-- 0237 中 save_quick_review_record 引用了 subject 列但表里没有，导致判题失败
alter table public.dictation_quick_review_records
  add column if not exists subject text;
