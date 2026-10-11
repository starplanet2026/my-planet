-- 0225: 快速复习 Bug 修复 + 作答记录持久化 + 复习完成

-- ============================================================
-- Bug1: 修复 dictation_tasks.status check 约束，确保包含 offline
-- ============================================================
alter table public.dictation_tasks drop constraint if exists dictation_tasks_status_check;
alter table public.dictation_tasks add constraint dictation_tasks_status_check
  check (status in ('active', 'offline', 'completed'));

-- ============================================================
-- Bug2: 快速复习作答记录持久化表
-- 同一任务内每条词条的判题结果，退出页面后重进仍保留
-- ============================================================
create table if not exists public.dictation_quick_review_records (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.dictation_tasks(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  task_word_id uuid not null references public.dictation_task_words(id) on delete cascade,
  word_text text not null,
  answer text not null,
  is_correct boolean not null,
  round_no int not null default 1,
  created_at timestamptz not null default now(),
  unique (task_id, member_id, task_word_id)
);

create index if not exists idx_qr_records_task_member
  on public.dictation_quick_review_records(task_id, member_id);

-- 启用行级安全（如未启用）
alter table public.dictation_quick_review_records enable row level security;

-- 简化策略：authenticated 可读写（数据隔离由应用层 member_id 过滤保证，与其他 dictation 表一致）
drop policy if exists "qr_records_auth_all" on public.dictation_quick_review_records;
create policy "qr_records_auth_all" on public.dictation_quick_review_records
  for all to authenticated using (true) with check (true);

-- ============================================================
-- RPC: 保存快速复习单条判题记录（已存在则覆盖）
-- 同时处理：正确→加星光值；错误→存入错词库
-- ============================================================
create or replace function public.save_quick_review_record(
  p_task_id uuid,
  p_member_id uuid,
  p_task_word_id uuid,
  p_word_text text,
  p_answer text,
  p_is_correct boolean,
  p_subject text,
  p_star_per_word int,
  p_round_no int default 1
) returns table(success boolean, message text, star_gained int) as $$
declare
  v_task record;
  v_existing record;
  v_star int := 0;
begin
  -- 校验任务
  select * into v_task from public.dictation_tasks
  where id = p_task_id and member_id = p_member_id and status = 'active';
  if v_task is null then
    return query select false, '任务不存在或已下线', 0;
    return;
  end if;

  -- 写入/覆盖判题记录（跨轮复习时允许覆盖；同一轮内由前端防重复点击）
  insert into public.dictation_quick_review_records
    (task_id, member_id, task_word_id, word_text, answer, is_correct, round_no)
  values
    (p_task_id, p_member_id, p_task_word_id, p_word_text, p_answer, p_is_correct, p_round_no)
  on conflict (task_id, member_id, task_word_id) do update
    set is_correct = excluded.is_correct,
        round_no = excluded.round_no,
        word_text = excluded.word_text,
        answer = excluded.answer;

  if p_is_correct then
    -- 正确：增加星光值
    v_star := p_star_per_word;
    update public.members set star_value = star_value + v_star where id = p_member_id;
    insert into public.coin_records (member_id, change_amount, type, category, ref_id, note, created_by)
    values (p_member_id, v_star, 'star', 'task', p_task_id, '快速复习正确奖励', p_member_id);
  else
    -- 错误：存入全局错词库（去重）
    insert into public.dictation_error_words
      (member_id, subject, answer, cycle_start_date, current_node, next_review_date, status, review_history)
    select p_member_id, p_subject, p_answer,
           current_date, 1, current_date + interval '1 day', 'in_progress', '[]'
    where not exists (
      select 1 from public.dictation_error_words
      where member_id = p_member_id and subject = p_subject and answer = p_answer
    );
  end if;

  return query select true, 'ok', v_star;
end;
$$ language plpgsql;

revoke all on function public.save_quick_review_record(uuid, uuid, uuid, text, text, boolean, text, int, int) from public;
grant execute on function public.save_quick_review_record(uuid, uuid, uuid, text, text, boolean, text, int, int) to anon, authenticated;

notify pgrst, 'reload schema';
