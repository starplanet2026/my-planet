-- 0032: 创建 pet-images Storage bucket
-- 用于存储商品图片、背景图等，替代 DB 里的 base64 存储
-- ============================================================

-- 1. 创建 bucket（公开读）
insert into storage.buckets (id, name, public)
values ('pet-images', 'pet-images', true)
on conflict (id) do nothing;

-- 2. RLS: 已登录用户可上传
drop policy if exists "Authenticated can upload pet-images" on storage.objects;
create policy "Authenticated can upload pet-images"
  on storage.objects for insert
  to authenticated
  with check (true);

-- 3. RLS: 公开读
drop policy if exists "Public read pet-images" on storage.objects;
create policy "Public read pet-images"
  on storage.objects for select
  to public
  using (true);

-- 4. RLS: 已登录用户可删除
drop policy if exists "Authenticated can delete pet-images" on storage.objects;
create policy "Authenticated can delete pet-images"
  on storage.objects for delete
  to authenticated
  using (true);

-- 5. RLS: 已登录用户可更新
drop policy if exists "Authenticated can update pet-images" on storage.objects;
create policy "Authenticated can update pet-images"
  on storage.objects for update
  to authenticated
  using (true);
