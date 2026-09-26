-- 0138: 全系统记录统一保留最近30天，超过自动清理
-- 涉及表：
--   1. pet_boarding_log      宠托师托管历史
--   2. question_records      智慧星战答题记录
--   3. dictation_records     智慧星战默写记录
--   4. tasks                 领取成就今日达成记录（仅已完成的软删除记录）
--   5. coin_records          我的星球资产明细
--   6. pet_messages          萌宠星球消息记录

-- ====== 统一清理函数：删除超过30天的记录 ======
create or replace function public.cleanup_old_records()
returns void
language plpgsql security definer as $$
declare
  v_cutoff timestamptz := now() - interval '30 days';
begin
  -- 1. 宠托师托管历史
  delete from public.pet_boarding_log where created_at < v_cutoff;

  -- 2. 智慧星战答题记录
  delete from public.question_records where answered_at < v_cutoff;

  -- 3. 智慧星战默写记录
  delete from public.dictation_records where created_at < v_cutoff;

  -- 4. 领取成就今日达成记录（已完成且超过30天的任务记录）
  --    tasks 表是核心业务表，仅清理已完成超过30天的记录（保留未完成任务）
  delete from public.tasks where completed_at is not null and completed_at < v_cutoff;

  -- 5. 我的星球资产明细
  delete from public.coin_records where created_at < v_cutoff;

  -- 6. 萌宠星球消息记录
  delete from public.pet_messages where created_at < v_cutoff;
end;
$$;
grant execute on function public.cleanup_old_records() to anon, authenticated;

-- ====== 首次执行：清理现有超过30天的记录 ======
select public.cleanup_old_records();

-- ====== 尝试注册 pg_cron 每日定时清理（Supabase 付费层支持；免费层忽略错误） ======
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- 若已存在同名任务则先移除，再注册每日凌晨 3 点执行
    if exists (select 1 from cron.job where jobname = 'cleanup_old_records_daily') then
      perform cron.unschedule('cleanup_old_records_daily');
    end if;
    perform cron.schedule(
      'cleanup_old_records_daily',
      '0 3 * * *',
      'select public.cleanup_old_records();'
    );
  end if;
end $$;
