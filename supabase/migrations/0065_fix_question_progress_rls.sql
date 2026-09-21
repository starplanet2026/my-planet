-- ============================================================
-- 0065: 修复 question_progress RLS 策略
-- 问题：RLS 用 auth.uid() 匹配 members.id，但 members.id 是表主键
--       不等于 auth.users.id，导致查询永远返回空
--       fetchActiveQuestions 拿不到已掌握的题 → 答对的题不过滤
-- 修复：改用 families.owner_user_id = auth.uid() 关联
-- ============================================================

-- 删除旧的 RLS 策略
drop policy if exists "select own question_progress" on public.question_progress;
drop policy if exists "insert own question_progress" on public.question_progress;
drop policy if exists "update own question_progress" on public.question_progress;

-- 重建 select 策略（用正确的关联）
create policy "select own question_progress"
  on public.question_progress for select
  to authenticated
  using (
    member_id in (
      select m.id from public.members m
      join public.families f on f.id = m.family_id
      where f.owner_user_id = auth.uid()
    )
  );

-- 重建 insert 策略
create policy "insert own question_progress"
  on public.question_progress for insert
  to authenticated
  with check (
    member_id in (
      select m.id from public.members m
      join public.families f on f.id = m.family_id
      where f.owner_user_id = auth.uid()
    )
  );

-- 重建 update 策略
create policy "update own question_progress"
  on public.question_progress for update
  to authenticated
  using (
    member_id in (
      select m.id from public.members m
      join public.families f on f.id = m.family_id
      where f.owner_user_id = auth.uid()
    )
  );
