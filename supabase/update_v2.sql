-- ============================================================
-- My Planet v2 更新脚本
-- 简化注册流程：parent_pin_hash 改可空，首次进入家长端时设置
-- ============================================================

-- 1. families.parent_pin_hash 改为可空（首次未设置时为 NULL）
alter table public.families alter column parent_pin_hash drop not null;

-- 2. 删除旧的 init_family 函数（签名变了，需要先 drop）
drop function if exists public.init_family(text, text, text, text);

-- 3. 新版 init_family：只创建家庭 + parent 成员 + 默认 child 成员
create or replace function public.init_family(p_name text)
returns table(family_id uuid, member_id uuid)
language plpgsql security definer as $$
declare v_fam_id uuid; v_mem_id uuid;
begin
  insert into public.families (name, owner_user_id)
  values (p_name, auth.uid()) returning id into v_fam_id;
  -- parent 成员
  insert into public.members (family_id, name, role, avatar_emoji, display_order)
  values (v_fam_id, p_name, 'parent', '👑', 0);
  -- 默认 child 成员（孩子可在"我的"页面修改名字和头像）
  insert into public.members (family_id, name, role, avatar_emoji, display_order)
  values (v_fam_id, '我', 'child', '🦁', 1) returning id into v_mem_id;
  return query select v_fam_id, v_mem_id;
end;
$$;

-- 4. 新增 set_parent_pin：首次设置或更新家长 PIN
create or replace function public.set_parent_pin(p_pin text)
returns void
language plpgsql security definer as $$
declare v_hash text;
begin
  v_hash := crypt(p_pin, gen_salt('bf'));
  update public.families set parent_pin_hash = v_hash, updated_at = now()
  where owner_user_id = auth.uid();
end;
$$;

-- 5. 新增 has_parent_pin：检查是否已设置 PIN
create or replace function public.has_parent_pin()
returns boolean
language plpgsql security definer as $$
declare v_hash text;
begin
  select parent_pin_hash into v_hash from public.families where owner_user_id = auth.uid();
  return v_hash is not null and length(v_hash) > 0;
end;
$$;

-- 6. 更新 verify_parent_pin：未设置 PIN 时返回 false
create or replace function public.verify_parent_pin(p_pin text)
returns boolean
language plpgsql security definer as $$
declare v_hash text;
begin
  select parent_pin_hash into v_hash from public.families where owner_user_id = auth.uid();
  if v_hash is null then return false; end if;
  return crypt(p_pin, v_hash) = v_hash;
end;
$$;

-- 7. 授权
grant execute on function public.init_family(text) to anon, authenticated;
grant execute on function public.set_parent_pin(text) to anon, authenticated;
grant execute on function public.has_parent_pin() to anon, authenticated;
grant execute on function public.verify_parent_pin(text) to anon, authenticated;

-- 完成
