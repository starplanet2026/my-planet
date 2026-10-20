-- 0281: 删除宠物生长属性逻辑，属性固定化 + 每日0点清零
-- 业务规则（用户明确要求）：
--   1) 删除「每次升级血量上限 ×1.05」「每日衰减基数 +1」逻辑（complete_pet_levelup / evolve_pet）
--   2) 喂食 / 清洁 / 心情 固定为 100 / 100 / 300，不随等级浮动
--   3) 经验血条（exp_to_next）仍按等级逐级增加（exp_needed）
--   4) 每日 0 点重置逻辑保持不变（本次不涉及）

-- ========== 1) complete_pet_levelup：去掉血量×1.05 与衰减+1 ==========
create or replace function public.complete_pet_levelup(p_member_id uuid, p_pet_id uuid)
returns setof public.pets
language plpgsql security definer as $$
declare
  v_pet record;
  v_reward numeric(10,2);
  v_exp_needed int;
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

  -- 保留溢出经验：old_exp - old_level_exp_needed，带入新等级（经验血条逐级增加，血量/衰减不再随等级变化）
  v_carry_exp := greatest(0, coalesce(v_pet.exp, 0) - v_exp_needed);

  update public.pets set
    level = v_new_level,
    exp = v_carry_exp,
    exp_to_next = v_new_exp_to_next,
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
grant execute on function public.complete_pet_levelup(uuid, uuid) to anon, authenticated;

-- ========== 2) evolve_pet：进化不再改 max_blood / daily_decay_base ==========
create or replace function public.evolve_pet(p_pet_id uuid, p_target_rarity text)
returns table(success boolean, message text, new_rarity text, new_max_level integer, new_price_star integer)
language plpgsql security definer as $$
declare
  v_pet record;
  v_member record;
  v_current_rarity text;
  v_target_rarity text := p_target_rarity;
  v_cost int;
  v_new_max_level int;
  v_new_base_coin numeric;
  v_new_upgrade_reward int;
  v_new_upgrade_percent numeric;
  v_family_id uuid;
  v_new_star int;
  v_new_exp_to_next int;
begin
  select * into v_pet from public.pets where public.pets.id = p_pet_id for update;
  if not found then
    return query select false, '宠物不存在', null::text, 0, 0;
    return;
  end if;

  select * into v_member from public.members where id = v_pet.member_id for update;
  if not found then
    return query select false, '用户不存在', null::text, 0, 0;
    return;
  end if;
  v_family_id := v_member.family_id;

  -- 当前稀有度以宠物自身为准（进化会改变 pets.rarity），兜底回退商品模板默认值
  v_current_rarity := coalesce(
    v_pet.rarity,
    (select rarity from public.pet_shop_items where id = v_pet.shop_item_id),
    'common'
  );

  if v_current_rarity = 'common' and v_target_rarity = 'rare' then
    v_cost := 150; v_new_max_level := 20;
    v_new_base_coin := 2.0;
    v_new_upgrade_reward := 8 + floor(random() * 8);
    v_new_upgrade_percent := 8.0;
  elsif v_current_rarity = 'rare' and v_target_rarity = 'epic' then
    v_cost := 400; v_new_max_level := 25;
    v_new_base_coin := 3.0;
    v_new_upgrade_reward := 15 + floor(random() * 16);
    v_new_upgrade_percent := 12.0;
  else
    return query select false, '无法从' || v_current_rarity || '进化到' || v_target_rarity, null::text, 0, 0;
    return;
  end if;

  if v_pet.level < v_pet.max_level then
    return query select false, '宠物需要满级才能进化', null::text, 0, 0;
    return;
  end if;

  if v_member.star_value < v_cost then
    return query select false, '星光值不足，需要' || v_cost, null::text, 0, 0;
    return;
  end if;

  v_new_star := v_member.star_value - v_cost;
  update public.members set star_value = v_new_star, updated_at = now() where id = v_pet.member_id;

  -- 星光消耗流水
  insert into public.coin_records (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by, balance_type)
  values (v_family_id, v_pet.member_id, -v_cost, v_new_star,
    '宠物「' || coalesce(v_pet.name, '') || '」进化为' || case when v_target_rarity = 'rare' then '稀有' else '史诗' end,
    'evolve', 'pet', p_pet_id, v_pet.member_id, 'star');

  -- 进化后按新稀有度重算下一级所需经验（未达新满级时）
  v_new_exp_to_next := case
    when v_pet.level < v_new_max_level then public.exp_needed(v_pet.level, v_target_rarity)
    else 0
  end;

  update public.pets set
    max_level = v_new_max_level,
    base_coin_per_day = v_new_base_coin,
    upgrade_coin_reward = v_new_upgrade_reward,
    upgrade_percent = v_new_upgrade_percent,
    evolved_bonus = 10.0,
    rarity = v_target_rarity,
    exp_to_next = v_new_exp_to_next,
    pending_levelup = false
  where public.pets.id = p_pet_id;

  return query select true, '进化成功！等级保留', v_target_rarity, v_new_max_level, v_cost;
end;
$$;
grant execute on function public.evolve_pet(uuid, text) to anon, authenticated;

-- ========== 3) approve_study_record：心情封顶改固定 300（不再用随等级变化的 current_max_blood）==========
create or replace function public.approve_study_record(p_record_id uuid, p_reviewer_id uuid)
returns table(success boolean, message text, star_granted integer, happiness_granted integer)
language plpgsql security definer as $$
declare
  v_rec record;
  v_star int := 0;
  v_happiness int := 0;
  v_msg text;
begin
  select * into v_rec from public.study_records where id = p_record_id for update;
  if not found then
    return query select false, '记录不存在'::text, 0, 0;
    return;
  end if;
  if v_rec.review_status <> 'pending' then
    return query select false, '该记录已审核'::text, 0, 0;
    return;
  end if;

  v_star := coalesce(v_rec.star_earned, 0);
  v_happiness := coalesce(v_rec.happiness_gain, 0);

  -- 发放星光值
  if v_star > 0 then
    update public.members set star_value = star_value + v_star, updated_at = now()
    where id = v_rec.member_id;
  end if;

  -- 只增加宠物心情值（上限恒为 300），不增加经验
  if v_rec.pet_id is not null then
    update public.pets set
      happiness = least(300, happiness + v_happiness)
    where id = v_rec.pet_id;
  end if;

  update public.study_records set
    review_status = 'approved',
    reviewed_at = now(),
    reviewed_by = p_reviewer_id
  where id = p_record_id;

  v_msg := '陪伴学习审核通过！获得 ' || v_star || ' 星光值'
    || case when v_happiness > 0 then '，宠物心情 +' || v_happiness else '' end;
  perform public.add_pet_message(v_rec.member_id, v_rec.pet_id, 'study_approved',
    v_rec.pet_name, v_msg);

  return query select true,
    '审核通过！心情+' || v_happiness || '，星光+' || v_star,
    v_star, v_happiness;
end;
$$;
grant execute on function public.approve_study_record(uuid, uuid) to anon, authenticated;

-- ========== 4) 清理存量膨胀数据（字段已不再被读写，仅做数据对齐）==========
-- 注意：每日 0 点重置逻辑（run_daily_global_pet_reset）保持不变，本次不涉及。
update public.pets set current_max_blood = 100 where coalesce(current_max_blood, 100) <> 100;
update public.pets set daily_decay_base = 5 where coalesce(daily_decay_base, 5) <> 5;

notify pgrst, 'reload schema';