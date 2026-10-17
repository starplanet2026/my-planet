-- 0270: 恢复特权商品(items)的家庭隔离 + 收紧宠物(pets) RLS
-- 背景：0071 将 items 误改为全局数据表（删除 family_id、RLS using(true)），
-- 导致所有家庭互相可见、可编辑对方家长创建的特权卡。
-- pet_shop_items / pet_words / questions / challenge_sets 等系统模板维持全局，不在本次范围。

-- ============ items：加回 family_id 并回填 ============
alter table public.items add column if not exists family_id uuid;

-- 通过 created_by -> members.family_id 找回每张特权卡的原属家庭
update public.items i
set family_id = m.family_id
from public.members m
where i.created_by = m.id and i.family_id is null;

-- 无法映射回任何家庭的残留数据（全局化时代的孤儿，正常应为 0 条）直接清除：
-- 它们不被任何家庭合法拥有，留着只会在严格 RLS 下成为死数据
delete from public.items where family_id is null;

alter table public.items alter column family_id set not null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'items_family_id_fkey') then
    alter table public.items
      add constraint items_family_id_fkey
      foreign key (family_id) references public.families(id) on delete cascade;
  end if;
end $$;
create index if not exists idx_items_family on public.items(family_id, status);

-- ============ items：恢复家庭隔离 RLS ============
drop policy if exists "global read items" on public.items;
drop policy if exists "global write items" on public.items;
drop policy if exists "owner can read items" on public.items;
drop policy if exists "owner can write items" on public.items;

create policy "owner can read items" on public.items
  for select using (
    exists (select 1 from public.families f
      where f.id = items.family_id and f.owner_user_id = auth.uid())
  );
create policy "owner can write items" on public.items
  for all using (
    exists (select 1 from public.families f
      where f.id = items.family_id and f.owner_user_id = auth.uid())
  ) with check (
    exists (select 1 from public.families f
      where f.id = items.family_id and f.owner_user_id = auth.uid())
  );

-- ============ pets：RLS 由 using(true) 收紧为家庭隔离 ============
-- 前端直连查询均带 member_id/family_id（同一家庭 owner 会话）；
-- 领养/互动/晋级等写操作全部经 SECURITY DEFINER RPC，不受 RLS 影响。
drop policy if exists "pets_select" on public.pets;
drop policy if exists "pets_insert" on public.pets;
drop policy if exists "pets_update" on public.pets;
drop policy if exists "pets_delete" on public.pets;

create policy "owner can read pets" on public.pets
  for select using (
    exists (select 1 from public.families f
      where f.id = pets.family_id and f.owner_user_id = auth.uid())
  );
create policy "owner can write pets" on public.pets
  for all using (
    exists (select 1 from public.families f
      where f.id = pets.family_id and f.owner_user_id = auth.uid())
  ) with check (
    exists (select 1 from public.families f
      where f.id = pets.family_id and f.owner_user_id = auth.uid())
  );

notify pgrst, 'reload schema';
