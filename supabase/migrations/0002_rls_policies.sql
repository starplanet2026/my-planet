-- My Planet: RLS 行级安全策略
-- MVP 简化：基于 auth.uid() = families.owner_user_id 隔离
-- 孩子复用家长登录态，写操作全部经 RPC 校验

alter table public.families enable row level security;
alter table public.members enable row level security;
alter table public.tasks enable row level security;
alter table public.task_templates enable row level security;
alter table public.items enable row level security;
alter table public.purchases enable row level security;
alter table public.coin_records enable row level security;
alter table public.settings enable row level security;

-- families：仅 owner 可读写
create policy "owner can read family" on public.families
  for select using (owner_user_id = auth.uid());
create policy "owner can write family" on public.families
  for all using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());

-- members：通过 family owner 关联
create policy "owner can read members" on public.members
  for select using (
    exists (select 1 from public.families f where f.id = members.family_id and f.owner_user_id = auth.uid())
  );
create policy "owner can write members" on public.members
  for all using (
    exists (select 1 from public.families f where f.id = members.family_id and f.owner_user_id = auth.uid())
  );

-- tasks
create policy "owner can read tasks" on public.tasks
  for select using (
    exists (select 1 from public.families f where f.id = tasks.family_id and f.owner_user_id = auth.uid())
  );
create policy "owner can write tasks" on public.tasks
  for all using (
    exists (select 1 from public.families f where f.id = tasks.family_id and f.owner_user_id = auth.uid())
  );

-- task_templates
create policy "owner can read templates" on public.task_templates
  for select using (
    exists (select 1 from public.families f where f.id = task_templates.family_id and f.owner_user_id = auth.uid())
  );
create policy "owner can write templates" on public.task_templates
  for all using (
    exists (select 1 from public.families f where f.id = task_templates.family_id and f.owner_user_id = auth.uid())
  );

-- items
create policy "owner can read items" on public.items
  for select using (
    exists (select 1 from public.families f where f.id = items.family_id and f.owner_user_id = auth.uid())
  );
create policy "owner can write items" on public.items
  for all using (
    exists (select 1 from public.families f where f.id = items.family_id and f.owner_user_id = auth.uid())
  );

-- purchases
create policy "owner can read purchases" on public.purchases
  for select using (
    exists (select 1 from public.families f where f.id = purchases.family_id and f.owner_user_id = auth.uid())
  );
create policy "owner can write purchases" on public.purchases
  for all using (
    exists (select 1 from public.families f where f.id = purchases.family_id and f.owner_user_id = auth.uid())
  );

-- coin_records
create policy "owner can read records" on public.coin_records
  for select using (
    exists (select 1 from public.families f where f.id = coin_records.family_id and f.owner_user_id = auth.uid())
  );

-- settings
create policy "owner can read settings" on public.settings
  for select using (
    exists (select 1 from public.families f where f.id = settings.family_id and f.owner_user_id = auth.uid())
  );
create policy "owner can write settings" on public.settings
  for all using (
    exists (select 1 from public.families f where f.id = settings.family_id and f.owner_user_id = auth.uid())
  );
