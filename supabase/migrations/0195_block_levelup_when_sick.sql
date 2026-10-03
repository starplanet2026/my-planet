-- 0195: 生病状态下禁止升级挑战
-- Bug: 宠物生病时仍可进行升级挑战和升级
-- 修复: complete_pet_levelup RPC 增加 is_sick 检查，生病时拒绝升级

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
  v_new_max_blood int;
  v_evolved_bonus numeric(5,2);
begin
  select * into v_pet from public.pets where public.pets.id = p_pet_id for update;
  if not found then return; end if;

  if v_pet.member_id <> p_member_id then
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;

  -- 生病时禁止升级
  if public.pet_is_sick(v_pet.has_stomach_issue, v_pet.has_skin_issue, v_pet.has_severe_illness) then
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;

  if coalesce(v_pet.level, 1) >= coalesce(v_pet.max_level, 10) then
    update public.pets set pending_levelup = false where public.pets.id = p_pet_id;
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;

  v_exp_needed := public.exp_needed(coalesce(v_pet.level, 1), coalesce(v_pet.rarity, 'common'));
  if coalesce(v_pet.exp, 0) < v_exp_needed then
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;

  -- 升级奖励金币 = 升级后等级 * 1.25
  v_reward := round((coalesce(v_pet.level, 1) + 1) * 1.25);

  -- 血量上限增长
  v_evolved_bonus := coalesce(v_pet.evolved_bonus, 0.0);
  v_new_max_blood := round(coalesce(v_pet.current_max_blood, 100) * (1.05 + v_evolved_bonus * 0.01))::int;

  -- 升级：等级+1、清零经验、更新血量上限、衰减基数+1
  update public.pets set
    level = coalesce(v_pet.level, 1) + 1,
    exp = 0,
    current_max_blood = v_new_max_blood,
    daily_decay_base = coalesce(v_pet.daily_decay_base, 5) + 1,
    pending_levelup = false,
    coin_balance = coalesce(v_pet.coin_balance, 0) + v_reward
  where public.pets.id = p_pet_id;

  perform public.add_pet_message(p_member_id, p_pet_id, 'level_up',
    coalesce(v_pet.name, '宠物'), coalesce(v_pet.name, '宠物') || ' 升级了！');

  return query select * from public.pets where public.pets.id = p_pet_id;
end;
$$;
revoke all on function public.complete_pet_levelup(uuid, uuid) from public;
grant execute on function public.complete_pet_levelup(uuid, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
