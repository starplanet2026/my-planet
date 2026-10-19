-- 0274: 修复 get_pet_positions「column reference pet_id is ambiguous」(SQL 42702)
-- 根因：RETURNS TABLE 的输出参数 pet_id 与表列同名，SELECT 未限定表名导致歧义，
--       前端每次刷新读取坐标都失败 → 静默回退默认网格，用户拖动位置看似"没有记忆"。
-- 修复：所有列引用加表别名限定。

create or replace function public.get_pet_positions(p_member_id uuid)
returns table(pet_id uuid, pos_x numeric, pos_y numeric)
language plpgsql security definer as $$
begin
  return query
    select pp.pet_id, pp.pos_x, pp.pos_y
    from public.pet_positions pp
    where pp.member_id = p_member_id;
end;
$$;

grant execute on function public.get_pet_positions(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
