-- ============================================================
-- 0025: 创建 update_pet_info RPC 函数
-- 用于宠物领养后设置名字和性别
-- ============================================================

create or replace function public.update_pet_info(
  p_pet_id uuid,
  p_member_id uuid,
  p_name text,
  p_gender text
)
returns void
language plpgsql
security definer
as $$
begin
  update public.pets
  set name = p_name,
      gender = p_gender::text
  where id = p_pet_id and member_id = p_member_id;
end;
$$;
