-- 0203: 重写 check_pet
-- 删除每日衰减逻辑（trait_hunger_multiplier / trait_clean_multiplier / 多日循环模拟）
-- 生病触发改为调用 public.check_pet_sickness(p_pet_id)（0201 已创建）
-- 保留 last_check_at 更新
-- 注：旧 check_pet 不做金币累积，金币累积在 interact_with_pet / run_daily_boarding_care 中处理

drop function if exists public.check_pet(uuid);

create function public.check_pet(p_pet_id uuid)
returns setof public.pets
language plpgsql security definer as $$
declare
  v_pet record;
begin
  select * into v_pet from public.pets where public.pets.id = p_pet_id for update;
  if not found then return; end if;

  -- 生病触发：基于 last_care_date 与特质 sickness_days / severe_days 判定
  -- （0201 中实现的 check_pet_sickness 内部会读取 pet_traits 配置）
  perform public.check_pet_sickness(p_pet_id);

  -- 更新最后检查时间（保留原行为）
  update public.pets set last_check_at = now()
  where public.pets.id = p_pet_id;

  return query select * from public.pets where public.pets.id = p_pet_id;
end;
$$;

grant execute on function public.check_pet(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
