-- 0045: 修复 interact_with_pet 不返回经验值的问题
-- ============================================================
-- 根因：
--   0040 / 0041 试图把 interact_with_pet 重写为 3 参签名
--   (p_pet_id, p_action, p_item_id)，但 DROP 用的签名是
--     drop function if exists public.interact_with_pet(uuid, text, uuid);
--   这是 0010 的 3 参旧签名，与 0019 / 0033 重写后的 4 参签名
--   (uuid, uuid, text, uuid) 不匹配，DROP 实际是 no-op。
--   随后 CREATE 新建了一个 3 参重载，于是 DB 中同时存在两个重载：
--     a) 4 参版本 (0019 / 0033)：不加分、不返 exp（被前端命中）
--     b) 3 参版本 (0040 / 0041)：返 exp，但前端 4 个命名参数命中不到
--   因此前端调用 4 参版本，4 个血条会涨但经验条永远不动。
--
-- 本迁移：
--   1) DROP 掉两个旧重载（4 参 + 3 参）
--   2) 重建唯一一个 4 参版本
--      interact_with_pet(p_member_id, p_pet_id, p_action, p_item_id)
--      返回 setof public.pets（含 exp / level / 所有字段，参照 check_pet）
--   3) 每次互动 +20 XP，满级阈值时升级、给金币、扩血条
--   4) 兼容 'heal' / 'medical' 两种 action 名称（前端发 'heal'，
--      0041 写的是 'medical'，新函数两种都识别）
--   5) 校验逻辑：宠物不存在 / 跨用户操作 / 物品类目不符 /
--      治疗时未生病 → 直接返回当前宠物行（不改任何字段）
-- ============================================================

drop function if exists public.interact_with_pet(uuid, uuid, text, uuid);
drop function if exists public.interact_with_pet(uuid, text, uuid);

create function public.interact_with_pet(
  p_member_id uuid,
  p_pet_id uuid,
  p_action text,
  p_item_id uuid default null
)
returns setof public.pets
language plpgsql security definer as $$
declare
  v_pet public.pets%rowtype;
  v_item public.pet_shop_items%rowtype;
  v_inv public.pet_inventory%rowtype;
  v_required_sub text;
  v_recovery int := 20;
  v_exp_gain int := 20;
  v_new_exp int;
  v_exp_needed int;
  v_level_up boolean := false;
  v_coin_earned int := 0;
  v_new_max_blood int;
  v_evolved_bonus numeric(5,2);
begin
  select * into v_pet from public.pets where public.pets.id = p_pet_id for update;
  if not found then return; end if;
  -- 跨用户操作：直接返回当前宠物行，不修改任何字段
  if v_pet.member_id <> p_member_id then
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;

  -- action → subcategory 映射（兼容 heal / medical）
  if p_action = 'feed' then v_required_sub := 'food';
  elsif p_action = 'clean' then v_required_sub := 'clean';
  elsif p_action = 'play' then v_required_sub := 'toy';
  elsif p_action = 'heal' or p_action = 'medical' then v_required_sub := 'medicine';
  else
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;

  -- 治疗需宠物生病，否则直接返回当前宠物行
  if (p_action = 'heal' or p_action = 'medical') and not v_pet.is_sick then
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;

  -- 校验背包物品：不存在或已用完，直接返回当前宠物行
  select * into v_inv from public.pet_inventory
    where member_id = p_member_id and item_id = p_item_id for update;
  if not found or v_inv.quantity <= 0 then
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;
  -- 物品类型不匹配，直接返回当前宠物行
  if v_inv.subcategory <> v_required_sub then
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;

  -- 读取商品的 recovery_value
  select * into v_item from public.pet_shop_items where id = p_item_id;
  if found and v_item.recovery_value is not null and v_item.recovery_value > 0 then
    v_recovery := v_item.recovery_value;
  end if;

  -- 扣减背包物品
  if v_inv.quantity - 1 <= 0 then
    delete from public.pet_inventory where id = v_inv.id;
  else
    update public.pet_inventory set quantity = v_inv.quantity - 1 where id = v_inv.id;
  end if;

  -- 更新宠物状态
  if p_action = 'feed' then
    v_pet.hunger := least(coalesce(v_pet.current_max_blood, 100), v_pet.hunger + v_recovery);
  elsif p_action = 'clean' then
    v_pet.clean := least(coalesce(v_pet.current_max_blood, 100), v_pet.clean + v_recovery);
  elsif p_action = 'play' then
    v_pet.happiness := least(coalesce(v_pet.current_max_blood, 100), v_pet.happiness + v_recovery);
  elsif p_action = 'heal' or p_action = 'medical' then
    v_pet.is_sick := false;
    v_pet.health := least(coalesce(v_pet.current_max_blood, 100), v_pet.health + v_recovery);
  end if;

  -- 经验值：每次互动 +20 XP
  v_new_exp := coalesce(v_pet.exp, 0) + v_exp_gain;
  v_exp_needed := public.exp_needed(v_pet.level);

  if v_new_exp >= v_exp_needed and v_pet.level < coalesce(v_pet.max_level, 3) then
    v_level_up := true;
    v_new_exp := v_new_exp - v_exp_needed;
    v_evolved_bonus := coalesce(v_pet.evolved_bonus, 0.0);
    v_coin_earned := coalesce(v_pet.upgrade_coin_reward, 5);
    v_new_max_blood := round(coalesce(v_pet.current_max_blood, 100) * (1.05 + v_evolved_bonus * 0.01))::int;

    update public.pets set
      level = v_pet.level + 1,
      exp = v_new_exp,
      hunger = v_pet.hunger,
      clean = v_pet.clean,
      happiness = v_pet.happiness,
      health = v_pet.health,
      is_sick = v_pet.is_sick,
      coin_balance = coalesce(v_pet.coin_balance, 0) + v_coin_earned,
      current_max_blood = v_new_max_blood,
      daily_decay_base = coalesce(v_pet.daily_decay_base, 5) + 1
    where public.pets.id = p_pet_id;

    -- 升级金币给孩子
    update public.members
      set coin_balance = coalesce(coin_balance, 0) + v_coin_earned, updated_at = now()
      where id = p_member_id;
  else
    update public.pets set
      exp = v_new_exp,
      hunger = v_pet.hunger,
      clean = v_pet.clean,
      happiness = v_pet.happiness,
      health = v_pet.health,
      is_sick = v_pet.is_sick
    where public.pets.id = p_pet_id;
  end if;

  -- 返回更新后的宠物完整行（含 exp / level / coin_balance / current_max_blood）
  return query select * from public.pets where public.pets.id = p_pet_id;
end;
$$;

grant execute on function public.interact_with_pet(uuid, uuid, text, uuid) to anon, authenticated;
