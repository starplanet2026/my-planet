-- ============================================================
-- 0058: 删除成员 RPC（级联清理没有 ON DELETE CASCADE 的外键字段）
-- 问题：直接 delete from members where id=... 会因为以下外键失败：
--   - tasks.completed_by（无 on delete 子句，默认 NO ACTION）
--   - coin_records.created_by（NOT NULL，无 on delete 子句）
--   - items.created_by（NOT NULL，无 on delete 子句）
--   - purchases.redeemed_by（nullable，无 on delete 子句）
-- 解决：先把这些字段改为 parent 的 id 或 NULL，再 delete members。
-- 其他表（tasks.member_id、coin_records.member_id、pets.member_id、
--   question_progress、word_progress、study_records、game_level_results、
--   game_word_stats、pet_word_progress、pet_interactions、purchases.member_id、
--   pet_checkins、pet_doghouse 等）都有 on delete cascade，会自动级联删除。
-- ============================================================

create or replace function public.delete_member(p_member_id uuid)
returns boolean
language plpgsql security definer as $$
declare
  v_family_id uuid;
  v_parent_id uuid;
begin
  -- 取成员的 family_id
  select family_id into v_family_id from public.members where id = p_member_id;
  if v_family_id is null then
    return false;  -- 成员不存在
  end if;

  -- 找同 family 的 parent，用于替换 created_by 字段
  select id into v_parent_id from public.members
  where family_id = v_family_id and role = 'parent'
  limit 1;

  -- 1) tasks.completed_by：把该成员完成的任务的 completed_by 设为 NULL
  update public.tasks set completed_by = null
  where completed_by = p_member_id;

  -- 2) coin_records.created_by：把该成员创建的金币记录的 created_by 改为 parent
  if v_parent_id is not null then
    update public.coin_records set created_by = v_parent_id
    where created_by = p_member_id;

    -- 3) items.created_by：把该成员创建的物品的 created_by 改为 parent
    update public.items set created_by = v_parent_id
    where created_by = p_member_id;
  else
    -- 没有 parent？把这些记录的 created_by 设为 NULL（如果字段允许）
    -- items.created_by 是 not null，所以这里假设有 parent；没有则删除会失败，
    -- 上层会看到错误并提示
    update public.coin_records set created_by = p_member_id
    where created_by = p_member_id and created_by is not null;
  end if;

  -- 4) purchases.redeemed_by：把该成员兑换的记录的 redeemed_by 设为 NULL
  update public.purchases set redeemed_by = null
  where redeemed_by = p_member_id;

  -- 最后删除成员（其他表通过 ON DELETE CASCADE 自动级联删除）
  delete from public.members where id = p_member_id;

  return true;
end;
$$;

grant execute on function public.delete_member(uuid) to anon, authenticated;
