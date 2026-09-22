-- 0076: 升级奖励改为 当前等级×1.25 金币（非星光值）
-- 原来固定 10 金币，现改为按等级动态计算

create or replace function public.complete_pet_levelup(
  p_member_id uuid,
  p_pet_id uuid
)
returns setof public.pets
language plpgsql security definer as $$
declare
  v_pet record;
  v_reward numeric;
  v_exp_needed int;
begin
  select * into v_pet from public.pets where public.pets.id = p_pet_id for update;
  if not found then return; end if;

  -- 跨用户校验
  if v_pet.member_id <> p_member_id then
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;

  -- 必须未满级
  if coalesce(v_pet.level, 1) >= coalesce(v_pet.max_level, 10) then
    update public.pets set pending_levelup = false where public.pets.id = p_pet_id;
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;

  -- 经验必须足够
  v_exp_needed := public.exp_needed(coalesce(v_pet.level, 1), coalesce(v_pet.rarity, 'common'));
  if coalesce(v_pet.exp, 0) < v_exp_needed then
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;

  -- 奖励 = 当前等级 × 1.25 金币（四舍五入）
  v_reward := round(coalesce(v_pet.level, 1) * 1.25);

  -- 升级
  update public.pets set
    level = coalesce(v_pet.level, 1) + 1,
    pending_levelup = false
  where public.pets.id = p_pet_id;

  -- 给孩子加金币（不是星光值）
  update public.members
    set coin_balance = coalesce(coin_balance, 0) + v_reward, updated_at = now()
    where public.members.id = p_member_id;

  return query select * from public.pets where public.pets.id = p_pet_id;
end;
$$;

grant execute on function public.complete_pet_levelup(uuid, uuid) to anon, authenticated;
