-- 宠物位置持久化：按用户+宠物独立保存拖拽坐标
create table if not exists public.pet_positions (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null,
  pet_id uuid not null,
  pos_x numeric not null default 50,
  pos_y numeric not null default 55,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (member_id, pet_id)
);

create index if not exists idx_pet_positions_member on public.pet_positions(member_id);

alter table public.pet_positions enable row level security;

create policy "pet_positions owner read" on public.pet_positions
  for select using (auth.uid() is not null);
create policy "pet_positions owner insert" on public.pet_positions
  for insert with check (auth.uid() is not null);
create policy "pet_positions owner update" on public.pet_positions
  for update using (auth.uid() is not null);
create policy "pet_positions owner delete" on public.pet_positions
  for delete using (auth.uid() is not null);

notify pgrst, 'reload schema';
