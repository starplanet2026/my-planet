-- 0286: 修复 cleanup_old_records 误删成就库任务
-- ============================================================
-- 根因：
--   0138 初版仅清理「已完成」的任务记录：
--     delete from public.tasks where completed_at is not null and completed_at < v_cutoff;
--   0142 / 0143 重写该函数时，条件被改成按 created_at 清理全部任务：
--     delete from public.tasks where created_at < v_cutoff;
--   tasks 表同时承载「成就库卡片（任务定义）」与「今日达成记录」，按 created_at
--   清理会把家长创建的成就卡片在创建满 30 天后由每日 03:00 UTC 定时任务批量删除。
--
-- 处理：tasks 属于核心业务数据，不再进入自动清理范围；其余记录表保留 30 天清理。
-- ============================================================

create or replace function public.cleanup_old_records()
returns void
language plpgsql security definer as $$
declare
  v_cutoff timestamptz := now() - interval '30 days';
begin
  -- 宠托师托管记录
  delete from public.pet_boarding_log where created_at < v_cutoff;
  -- 答题记录
  delete from public.question_records where answered_at < v_cutoff;
  -- 默写记录
  delete from public.dictation_records where created_at < v_cutoff;
  -- 注意：tasks（成就库卡片 / 任务定义）为业务数据，严禁自动清理
  -- 资产明细
  delete from public.coin_records where created_at < v_cutoff;
  -- 萌宠消息
  delete from public.pet_messages where created_at < v_cutoff;
  -- 特权卡使用记录
  delete from public.purchase_usage_records where used_at < v_cutoff;
  -- 背诵任务已提交实例（保留30天供家长复查）
  delete from public.recitation_instances where submitted_at is not null and submitted_at < v_cutoff;
  -- recitation_tasks 模板表永不自动清理（仅手动删除）
end;
$$;

grant execute on function public.cleanup_old_records() to anon, authenticated;
