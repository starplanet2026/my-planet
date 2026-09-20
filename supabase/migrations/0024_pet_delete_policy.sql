-- ============================================================
-- 0024: 添加 pets 表的 DELETE RLS policy
-- pets 表缺少 delete 策略，导致后台无法删除用户宠物
-- ============================================================

create policy "pets_delete" on public.pets for delete using (true);
