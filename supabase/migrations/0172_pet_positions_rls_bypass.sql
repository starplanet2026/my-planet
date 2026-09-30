-- 0172: 修复宠物位置刷新丢失 bug
-- 问题：用户拖拽宠物后刷新页面，位置回到默认，未保留上次拖动坐标
-- 根因：pet_positions 表 RLS 策略可能阻止登录用户读写，savePetPosition/fetchPetPositions 静默失败
-- 修复：提供 security definer RPC 函数绕过 RLS 读写坐标

-- ============================================================
-- 一、get_pet_positions：读取某 member 下所有宠物坐标
-- ============================================================
create or replace function public.get_pet_positions(p_member_id uuid)
returns table(pet_id uuid, pos_x numeric, pos_y numeric)
language plpgsql security definer as $$
begin
  return query
    select pet_id, pos_x, pos_y
    from public.pet_positions
    where member_id = p_member_id;
end;
$$;

grant execute on function public.get_pet_positions(uuid) to anon, authenticated;

-- ============================================================
-- 二、save_pet_position：保存/更新某只宠物坐标（upsert）
-- ============================================================
create or replace function public.save_pet_position(
  p_member_id uuid,
  p_pet_id uuid,
  p_x numeric,
  p_y numeric
)
returns void
language plpgsql security definer as $$
begin
  insert into public.pet_positions (member_id, pet_id, pos_x, pos_y, updated_at)
  values (p_member_id, p_pet_id, p_x, p_y, now())
  on conflict (member_id, pet_id) do update
  set pos_x = excluded.pos_x,
      pos_y = excluded.pos_y,
      updated_at = now();
end;
$$;

grant execute on function public.save_pet_position(uuid, uuid, numeric, numeric) to anon, authenticated;

notify pgrst, 'reload schema';
