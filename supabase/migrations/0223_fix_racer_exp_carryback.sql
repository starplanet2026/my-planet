-- 0223: 回溯修复 Racer 升级经验丢失
-- 问题：屠图的宠物 Racer，6级升7级前经验250，升级后 exp 被清零（0195 bug）
-- exp_needed(6) = 6*20 = 120，溢出经验 = 250 - 120 = 130
-- 修正：将 exp 从 0 恢复为 130

do $$
declare
  v_member_id uuid;
  v_pet_id uuid;
  v_pet_level int;
  v_pet_exp int;
  v_exp_needed_level6 int;
  v_carry_exp int;
  v_old_exp int := 250;  -- 升级前经验值
begin
  -- 查找成员"屠图"
  select id into v_member_id from public.members where name = '屠图' limit 1;
  if v_member_id is null then
    raise notice '未找到名为"屠图"的成员，跳过';
    return;
  end if;

  -- 查找宠物 Racer
  select id, level, exp into v_pet_id, v_pet_level, v_pet_exp
  from public.pets
  where member_id = v_member_id and name = 'Racer'
  limit 1;

  if v_pet_id is null then
    raise notice '未找到屠图的宠物 Racer，跳过';
    return;
  end if;

  -- 仅修复当前为 7 级且 exp=0 的情况（匹配 bug 状态）
  if v_pet_level = 7 and coalesce(v_pet_exp, 0) = 0 then
    v_exp_needed_level6 := public.exp_needed(6, 'common');
    v_carry_exp := greatest(0, v_old_exp - v_exp_needed_level6);
    -- v_carry_exp = 250 - 120 = 130

    update public.pets set
      exp = v_carry_exp,
      exp_to_next = public.exp_needed(7, 'common'),
      updated_at = now()
    where id = v_pet_id;

    raise notice '已修复 Racer 经验：7级 exp 0 → % (溢出经验 % - % = %)',
      v_carry_exp, v_old_exp, v_exp_needed_level6, v_carry_exp;
  else
    raise notice 'Racer 当前状态(level=%, exp=%)不匹配 bug 修复条件，跳过',
      v_pet_level, v_pet_exp;
  end if;
end;
$$;
