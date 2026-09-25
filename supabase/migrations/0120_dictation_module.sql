-- ====== 家默模块：词条库、错词库、任务、记录 + 星光值RPC + 艾宾浩斯RPC ======

-- 0. 扩展 coin_records.category 约束，允许家默流水分类
alter table public.coin_records drop constraint if exists coin_records_category_check;
alter table public.coin_records add constraint coin_records_category_check
  check (category in ('task','purchase','manual','system','task_reject','manual_adjust','challenge','shop','boarding','evolve','study','upgrade','dictation'));

-- 1. 长期词条库（按 family_id 隔离）
create table if not exists public.dictation_words (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null,
  subject text not null check (subject in ('english', 'chinese')),
  textbook_name text not null default '',
  unit_no int not null default 0,
  unit_name text not null default '',
  page_no int,                 -- 英语专用
  chinese_meaning text,        -- 英语专用
  part_of_speech text,         -- 英语专用
  pinyin text,                 -- 语文专用
  answer text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_dictation_words_family_subject on public.dictation_words(family_id, subject);
create index if not exists idx_dictation_words_book_unit on public.dictation_words(family_id, subject, textbook_name, unit_no);

-- 2. 错词库（按 member_id 隔离，含艾宾浩斯字段）
create table if not exists public.dictation_error_words (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null,
  subject text not null check (subject in ('english', 'chinese')),
  word_id uuid,                -- 关联长期词条库（可空，手动录入/导入无关联）
  textbook_name text not null default '',
  unit_no int not null default 0,
  unit_name text not null default '',
  page_no int,
  chinese_meaning text,
  part_of_speech text,
  pinyin text,
  answer text not null,
  cycle_start_date date not null default current_date,
  current_node int not null default 1 check (current_node in (1, 2, 4, 7, 15)),
  next_review_date date not null,
  status text not null default 'in_progress' check (status in ('in_progress', 'completed')),
  last_review_date date,
  review_history jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_dictation_error_member_subject on public.dictation_error_words(member_id, subject);
create index if not exists idx_dictation_error_due on public.dictation_error_words(member_id, status, next_review_date);

-- 3. 家默任务
create table if not exists public.dictation_tasks (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null,
  member_id uuid not null,
  subject text not null check (subject in ('english', 'chinese')),
  title text not null,
  task_date date,
  star_per_word int not null default 1,
  status text not null default 'active' check (status in ('active', 'completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_dictation_tasks_member_status on public.dictation_tasks(member_id, status);
create index if not exists idx_dictation_tasks_member_subject on public.dictation_tasks(member_id, subject, status);

-- 4. 任务词条关联
create table if not exists public.dictation_task_words (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.dictation_tasks(id) on delete cascade,
  word_id uuid,
  error_word_id uuid,
  textbook_name text not null default '',
  unit_no int not null default 0,
  unit_name text not null default '',
  page_no int,
  chinese_meaning text,
  part_of_speech text,
  pinyin text,
  answer text not null,
  is_temporary boolean not null default false,
  save_to_library boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_dictation_task_words_task on public.dictation_task_words(task_id);

-- 5. 家默批改记录（永久保存）
create table if not exists public.dictation_records (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.dictation_tasks(id) on delete cascade,
  member_id uuid not null,
  subject text not null,
  word_text text not null,
  answer text not null,
  is_correct boolean not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_dictation_records_member on public.dictation_records(member_id);
create index if not exists idx_dictation_records_task on public.dictation_records(task_id);

-- 行级安全
alter table public.dictation_words enable row level security;
alter table public.dictation_error_words enable row level security;
alter table public.dictation_tasks enable row level security;
alter table public.dictation_task_words enable row level security;
alter table public.dictation_records enable row level security;

-- 简化策略：authenticated 可读写（数据隔离由应用层 family_id/member_id 过滤保证）
create policy "dictation_words_auth_all" on public.dictation_words
  for all to authenticated using (true) with check (true);
create policy "dictation_error_auth_all" on public.dictation_error_words
  for all to authenticated using (true) with check (true);
create policy "dictation_tasks_auth_all" on public.dictation_tasks
  for all to authenticated using (true) with check (true);
create policy "dictation_task_words_auth_all" on public.dictation_task_words
  for all to authenticated using (true) with check (true);
create policy "dictation_records_auth_all" on public.dictation_records
  for all to authenticated using (true) with check (true);

-- updated_at 触发器
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists trg_dictation_words_updated on public.dictation_words;
create trigger trg_dictation_words_updated before update on public.dictation_words
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_dictation_error_updated on public.dictation_error_words;
create trigger trg_dictation_error_updated before update on public.dictation_error_words
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_dictation_tasks_updated on public.dictation_tasks;
create trigger trg_dictation_tasks_updated before update on public.dictation_tasks
  for each row execute function public.touch_updated_at();

-- ====== RPC 1: 提交家默批改结果（处理艾宾浩斯 + 发放星光值，原子事务） ======
-- 节点间隔映射：1->2: I=1, 2->4: I=2, 4->7: I=3, 7->15: I=8
drop function if exists public.submit_dictation_result(uuid, uuid, jsonb);
create or replace function public.submit_dictation_result(
  p_task_id uuid,
  p_member_id uuid,
  p_results jsonb
)
returns table(success boolean, message text, correct_count int, error_count int, total_star int, new_star int)
language plpgsql security definer as $$
declare
  v_task record;
  v_member record;
  v_item jsonb;
  v_word_id uuid;
  v_error_word_id uuid;
  v_answer text;
  v_word_text text;
  v_is_correct boolean;
  v_subject text;
  v_correct int := 0;
  v_error int := 0;
  v_ew record;
  v_overdue int;
  v_i int;
  v_next_node int;
  v_next_date date;
  v_exists boolean;
  v_today date := current_date;
  v_textbook text; v_unit_no int; v_unit_name text; v_page_no int;
  v_chinese text; v_pos text; v_pinyin text;
  v_family_id uuid;
  v_total int;
  v_new_star int;
begin
  -- 校验任务归属且状态为 active
  select * into v_task from public.dictation_tasks
  where id = p_task_id and member_id = p_member_id and status = 'active';
  if not found then
    return query select false, '任务不存在、无权操作或已完成', 0, 0, 0, 0;
    return;
  end if;
  v_subject := v_task.subject;

  -- 锁定成员行，准备发放星光值
  select * into v_member from public.members where id = p_member_id for update;
  if not found then
    return query select false, '用户不存在', 0, 0, 0, 0;
    return;
  end if;
  v_family_id := v_member.family_id;

  -- 同一任务单日仅允许完成一次校验
  select exists(
    select 1 from public.dictation_records
    where task_id = p_task_id and date_trunc('day', created_at) = v_today
  ) into v_exists;
  if v_exists then
    return query select false, '该任务今日已完成批改', 0, 0, 0, v_member.star_value;
    return;
  end if;

  for v_item in select * from jsonb_array_elements(p_results)
  loop
    v_word_id := (v_item->>'word_id')::uuid;
    v_error_word_id := (v_item->>'error_word_id')::uuid;
    v_answer := v_item->>'answer';
    v_word_text := v_item->>'word_text';
    v_is_correct := (v_item->>'is_correct')::boolean;

    -- 写入永久记录
    insert into public.dictation_records (task_id, member_id, subject, word_text, answer, is_correct)
    values (p_task_id, p_member_id, v_subject, coalesce(v_word_text, ''), coalesce(v_answer, ''), v_is_correct);

    if v_is_correct then
      v_correct := v_correct + 1;
    else
      v_error := v_error + 1;
    end if;

    -- 获取词条字段副本（用于错词库）；若词条已删除，回退使用入参 answer
    if v_word_id is not null then
      select textbook_name, unit_no, unit_name, page_no, chinese_meaning, part_of_speech, pinyin, answer
        into v_textbook, v_unit_no, v_unit_name, v_page_no, v_chinese, v_pos, v_pinyin, v_answer
      from public.dictation_words where id = v_word_id;
      if not found then v_answer := v_item->>'answer'; end if;
    elsif v_error_word_id is not null then
      select textbook_name, unit_no, unit_name, page_no, chinese_meaning, part_of_speech, pinyin, answer
        into v_textbook, v_unit_no, v_unit_name, v_page_no, v_chinese, v_pos, v_pinyin, v_answer
      from public.dictation_error_words where id = v_error_word_id;
      if not found then v_answer := v_item->>'answer'; end if;
    end if;

    -- 处理错词库：错误 → 新建或重置；正确 → 推进节点
    if not v_is_correct then
      select * into v_ew from public.dictation_error_words
      where member_id = p_member_id and answer = v_answer and subject = v_subject
      limit 1;

      if found then
        update public.dictation_error_words set
          cycle_start_date = v_today,
          current_node = 1,
          next_review_date = v_today + 1,
          status = 'in_progress',
          last_review_date = v_today,
          review_history = review_history || jsonb_build_object('date', v_today::text, 'correct', false, 'action', 'reset')
        where id = v_ew.id;
      else
        insert into public.dictation_error_words
          (member_id, subject, word_id, textbook_name, unit_no, unit_name, page_no, chinese_meaning, part_of_speech, pinyin, answer,
           cycle_start_date, current_node, next_review_date, status, last_review_date, review_history)
        values
          (p_member_id, v_subject, v_word_id, coalesce(v_textbook,''), coalesce(v_unit_no,0), coalesce(v_unit_name,''), v_page_no,
           v_chinese, v_pos, v_pinyin, v_answer,
           v_today, 1, v_today + 1, 'in_progress', v_today,
           jsonb_build_array(jsonb_build_object('date', v_today::text, 'correct', false, 'action', 'new')));
      end if;
    else
      select * into v_ew from public.dictation_error_words
      where member_id = p_member_id and answer = v_answer and subject = v_subject
      limit 1;

      if found and v_ew.status = 'in_progress' then
        if v_ew.current_node = 15 then
          update public.dictation_error_words set
            status = 'completed',
            last_review_date = v_today,
            review_history = review_history || jsonb_build_object('date', v_today::text, 'correct', true, 'action', 'completed')
          where id = v_ew.id;
        else
          v_i := case v_ew.current_node
            when 1 then 1 when 2 then 2 when 4 then 3 when 7 then 8 else 1
          end;
          v_next_node := case v_ew.current_node
            when 1 then 2 when 2 then 4 when 4 then 7 when 7 then 15 else 15
          end;
          v_overdue := (v_today - v_ew.next_review_date)::int;
          if v_overdue < 0 then v_overdue := 0; end if;

          if v_overdue > 2 * v_i or v_overdue > 7 then
            update public.dictation_error_words set
              cycle_start_date = v_today,
              current_node = 1,
              next_review_date = v_today + 1,
              status = 'in_progress',
              last_review_date = v_today,
              review_history = review_history || jsonb_build_object('date', v_today::text, 'correct', true, 'action', 'reset_severe')
            where id = v_ew.id;
          elsif v_overdue > v_i then
            v_next_date := v_today + greatest(1, ceil(v_i::numeric / 2)::int);
            update public.dictation_error_words set
              current_node = v_next_node,
              next_review_date = v_next_date,
              last_review_date = v_today,
              review_history = review_history || jsonb_build_object('date', v_today::text, 'correct', true, 'action', 'moderate')
            where id = v_ew.id;
          else
            v_next_date := v_today + v_i;
            update public.dictation_error_words set
              current_node = v_next_node,
              next_review_date = v_next_date,
              last_review_date = v_today,
              review_history = review_history || jsonb_build_object('date', v_today::text, 'correct', true, 'action', 'mild')
            where id = v_ew.id;
          end if;
        end if;
      end if;
    end if;
  end loop;

  -- 发放星光值（与批改同一事务，原子性保证）
  v_total := v_correct * coalesce(v_task.star_per_word, 1);
  v_new_star := v_member.star_value + v_total;
  if v_total > 0 then
    update public.members set star_value = v_new_star, updated_at = now() where id = p_member_id;
    insert into public.coin_records
      (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by, balance_type)
    values
      (v_family_id, p_member_id, v_total, v_new_star,
       '家默批改获得星光值', 'dictation', 'dictation_task', p_task_id::text, p_member_id::text, 'star');
  end if;

  -- 标记任务完成
  update public.dictation_tasks set status = 'completed', updated_at = now() where id = p_task_id;

  return query select true, '批改完成', v_correct, v_error, v_total, v_new_star;
end;
$$;
grant execute on function public.submit_dictation_result(uuid, uuid, jsonb) to anon, authenticated;
