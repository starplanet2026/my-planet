-- 0110_fix_category_rls.sql
-- 修复分类 RLS：允许家长重命名内置（全局）分类，但内置分类不可删除

drop policy if exists "write categories" on public.task_categories;

-- 插入：仅家庭 owner 可插入该家庭的自定义分类
drop policy if exists "insert categories" on public.task_categories;
create policy "insert categories" on public.task_categories
  for insert with check (
    exists (
      select 1 from public.families f
      where f.id = task_categories.family_id
        and f.owner_user_id = auth.uid()
    )
  );

-- 更新：家庭 owner 可更新自家分类；任意家长可重命名全局内置分类
drop policy if exists "update categories" on public.task_categories;
create policy "update categories" on public.task_categories
  for update using (
    (family_id is null and exists (select 1 from public.families f where f.owner_user_id = auth.uid()))
    or exists (
      select 1 from public.families f
      where f.id = task_categories.family_id
        and f.owner_user_id = auth.uid()
    )
  );

-- 删除：仅家庭 owner 可删除自家分类（内置分类 family_id=null 不可删；API 亦过滤 is_default=false）
drop policy if exists "delete categories" on public.task_categories;
create policy "delete categories" on public.task_categories
  for delete using (
    exists (
      select 1 from public.families f
      where f.id = task_categories.family_id
        and f.owner_user_id = auth.uid()
    )
  );

notify pgrst, 'reload schema';
