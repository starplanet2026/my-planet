-- 0158: 题目复制功能 + 题目报错表
-- 1. 复制题目 RPC：copy_question_to_level(p_question_id, p_target_level_id)
--    原题保留，在目标关卡生成完整副本
-- 2. 题目报错表：question_reports

-- ============================================================
-- 一、复制题目 RPC
-- ============================================================
create or replace function public.copy_question_to_level(
  p_question_id uuid,
  p_target_level_id uuid
)
returns uuid
language plpgsql security definer as $$
declare
  v_src public.questions%rowtype;
  v_new_id uuid;
begin
  select * into v_src from public.questions where id = p_question_id;
  if not found then
    raise exception '原题不存在';
  end if;

  v_new_id := gen_random_uuid();

  insert into public.questions (
    id, challenge_set_id, level_id, type, question_text,
    options, correct_answer, explanation, difficulty,
    is_active, display_order, created_at
  ) values (
    v_new_id,
    v_src.challenge_set_id,
    p_target_level_id,
    v_src.type,
    v_src.question_text,
    v_src.options,
    v_src.correct_answer,
    v_src.explanation,
    v_src.difficulty,
    true,
    (select coalesce(max(display_order), 0) + 1 from public.questions where level_id = p_target_level_id),
    now()
  );

  return v_new_id;
end;
$$;
revoke all on function public.copy_question_to_level(uuid, uuid) from public;
grant execute on function public.copy_question_to_level(uuid, uuid) to anon, authenticated;

-- ============================================================
-- 二、题目报错表
-- ============================================================
create table if not exists public.question_reports (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null,
  family_id uuid,
  member_id uuid,
  question_text_snapshot text,
  reason text,
  status text not null default 'pending',  -- pending / resolved
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists idx_question_reports_status on public.question_reports(status);
create index if not exists idx_question_reports_question_id on public.question_reports(question_id);

alter table public.question_reports enable row level security;

create policy "Anyone can create reports" on public.question_reports
  for insert to anon, authenticated with check (true);

create policy "Anyone can read reports" on public.question_reports
  for select to anon, authenticated using (true);

create policy "Anyone can update reports" on public.question_reports
  for update to anon, authenticated using (true);

create policy "Anyone can delete reports" on public.question_reports
  for delete to anon, authenticated using (true);

notify pgrst, 'reload schema';
