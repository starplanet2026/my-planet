-- ====== 陪伴学习任务模板：多端同步 ======

-- 任务模板表（按 member_id 隔离，支持多端同步）
create table if not exists public.study_task_templates (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null,
  text text not null,
  reward int not null default 0,
  selected boolean not null default true,
  display_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_study_task_templates_member
  on public.study_task_templates(member_id, display_order);

-- 行级安全
alter table public.study_task_templates enable row level security;
create policy "study_task_templates_auth_all" on public.study_task_templates
  for all to authenticated using (true) with check (true);
