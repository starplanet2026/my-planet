-- ============================================================
-- 0027: 背景图管理表
-- ============================================================

create table if not exists public.pet_backgrounds (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  name text not null,
  image_data text not null,  -- base64 格式
  sort_order int default 0,
  created_at timestamptz default now()
);

create index if not exists idx_pet_backgrounds_family on public.pet_backgrounds(family_id);

alter table public.pet_backgrounds enable row level security;
drop policy if exists "pet_backgrounds_all" on public.pet_backgrounds;
create policy "pet_backgrounds_all" on public.pet_backgrounds for all using (true) with check (true);
