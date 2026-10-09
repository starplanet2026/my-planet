-- 0222: 修复宠物升级经验清零 Bug
-- 问题：0195 重新定义 complete_pet_levelup 加生病检查时，exp=0 回退了 0133 的溢出经验保留修复
-- 修正：合并 0133（保留溢出经验）+ 0195（生病禁止升级）逻辑

create or replace function public.complete_pet_levelup(
  p_member_id uuid,
  p_pet_id uuid
)
returns setof public.pets
language plpgsql security definer as $$
declare
  v_pet record;
  v_reward numeric(10,2);
  v_exp_needed int;
  v_new_max_blood int;
  v_evolved_bonus numeric(5,2);
  v_new_level int;
  v_new_exp_to_next int;
  v_carry_exp int;
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

  v_new_level := coalesce(v_pet.level, 1) + 1;
  v_new_exp_to_next := public.exp_needed(v_new_level, coalesce(v_pet.rarity, 'common'));
  v_reward := round(v_new_level * 1.25);

  v_evolved_bonus := coalesce(v_pet.evolved_bonus, 0.0);
  v_new_max_blood := round(coalesce(v_pet.current_max_blood, 100) * (1.05 + v_evolved_bonus * 0.01))::int;

  -- 保留溢出经验：old_exp - old_level_exp_needed，带入新等级
  v_carry_exp := greatest(0, coalesce(v_pet.exp, 0) - v_exp_needed);

  update public.pets set
    level = v_new_level,
    exp = v_carry_exp,
    exp_to_next = v_new_exp_to_next,
    current_max_blood = v_new_max_blood,
    daily_decay_base = coalesce(v_pet.daily_decay_base, 5) + 1,
    coin_balance = coalesce(v_pet.coin_balance, 0) + v_reward,
    -- 若溢出经验仍够新等级上限，保持待升级状态（可连续答题升级）
    pending_levelup = (v_carry_exp >= v_new_exp_to_next and v_new_level < coalesce(v_pet.max_level, 10))
  where public.pets.id = p_pet_id;

  -- 同步金币到 members 表
  update public.members
    set coin_balance = coalesce(coin_balance, 0) + v_reward, updated_at = now()
    where public.members.id = p_member_id;

  perform public.add_pet_message(p_member_id, p_pet_id, 'level_up',
    coalesce(v_pet.name, '宠物'), coalesce(v_pet.name, '宠物') || ' 升级了！');

  return query select * from public.pets where public.pets.id = p_pet_id;
end;
$$;

revoke all on function public.complete_pet_levelup(uuid, uuid) from public;
grant execute on function public.complete_pet_levelup(uuid, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
