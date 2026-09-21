-- ============================================================
-- 0062: 修复删除成员导致任务被级联删除的问题
-- 问题：tasks.member_id 外键是 ON DELETE CASCADE，删除成员时
--       该成员关联的任务会被自动删除，导致后台任务消失。
-- 解决：
--   1. 把 tasks.member_id 外键改为 ON DELETE SET NULL
--      （任务变成"未分配"，不删除）
--   2. 更新 delete_member RPC：删除成员前先把 tasks.member_id 设为 null
--      （双重保险，即使外键没改也不会删任务）
-- ============================================================

-- 1. 找到 tasks.member_id 的外键约束名并替换为 ON DELETE SET NULL
do $$
declare
  v_constraint_name text;
begin
  select conname into v_constraint_name
  from pg_constraint
  where conrelid = 'public.tasks'::regclass
    and contype = 'f'
    and pg_get_constraintdef(oid) like '%member_id%references%members%';

  if v_constraint_name is not null then
    execute format('alter table public.tasks drop constraint %I', v_constraint_name);
    execute 'alter table public.tasks
             add constraint tasks_member_id_fkey
             foreign key (member_id) references public.members(id)
             on delete set null';
  end if;
end;
$$;

-- 2. 重写 delete_member RPC：删除成员前先把 tasks.member_id 设为 null
create or replace function public.delete_member(p_member_id uuid)
returns boolean
language plpgsql security definer as $$
declare
  v_family_id uuid;
  v_parent_id uuid;
begin
  select family_id into v_family_id from public.members where id = p_member_id;
  if v_family_id is null then
    return false;
  end if;

  -- 找同 family 的 parent，用于替换 created_by 字段
  select id into v_parent_id from public.members
  where family_id = v_family_id and role = 'parent'
    and id <> p_member_id
  limit 1;

  -- ★ 关键：把该成员关联的 tasks.member_id 设为 null（任务变成未分配，不删除）
  update public.tasks set member_id = null
  where member_id = p_member_id;

  -- tasks.completed_by：设为 NULL
  update public.tasks set completed_by = null
  where completed_by = p_member_id;

  -- tasks.created_by：设为 parent（not null 字段，不能设为 null）
  if v_parent_id is not null then
    update public.tasks set created_by = v_parent_id
    where created_by = p_member_id;

    -- coin_records.created_by：改为 parent
    update public.coin_records set created_by = v_parent_id
    where created_by = p_member_id;

    -- items.created_by：改为 parent
    update public.items set created_by = v_parent_id
    where created_by = p_member_id;
  end if;

  -- purchases.redeemed_by：设为 NULL
  update public.purchases set redeemed_by = null
  where redeemed_by = p_member_id;

  -- 删除成员（其他表通过 ON DELETE CASCADE 自动清理）
  delete from public.members where id = p_member_id;

  return true;
end;
$$;

grant execute on function public.delete_member(uuid) to anon, authenticated;
