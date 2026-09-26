-- 0133: 修复史诗宠物日产金币 + 升级经验溢出两个 Bug
-- Bug1: pets.base_coin_per_day 在购买时从 pet_shop_items 复制，0130 更新了商店表但 pets 表未同步
--       导致史诗宠物日产金币仍为 6（应为 5）
-- Bug2: complete_pet_levelup 升级时 exp=0 清零，溢出经验丢失
--       修正为 exp = exp - exp_needed(old_level)，保留溢出经验带入新等级

-- ============================================================
-- 一、修正 base_coin_per_day（按稀有度，宠物自身稀有度为权威）
-- 普通=1 / 稀有=2 / 史诗=5
-- ============================================================

-- 1.1 先修 pet_shop_items 中 base_coin_per_day=0 的脏数据（22个common=0）
update public.pet_shop_items set base_coin_per_day = 1 where rarity = 'common' and coalesce(base_coin_per_day, 0) = 0;
update public.pet_shop_items set base_coin_per_day = 2 where rarity = 'rare' and coalesce(base_coin_per_day, 0) = 0;
update public.pet_shop_items set base_coin_per_day = 5 where rarity = 'epic' and coalesce(base_coin_per_day, 0) = 0;

-- 1.2 兜底：通过 shop_item_id 关联同步（仅用于 rarity 为空的宠物）
update public.pets p
  set base_coin_per_day = si.base_coin_per_day
  from public.pet_shop_items si
  where p.shop_item_id = si.id
    and p.rarity is null;

-- 1.3 按 pet 自身稀有度修正（权威来源，覆盖历史复制值）
--     注：必须放最后，以 pet.rarity 为准
update public.pets set base_coin_per_day = 1 where rarity = 'common';
update public.pets set base_coin_per_day = 2 where rarity = 'rare';
update public.pets set base_coin_per_day = 5 where rarity = 'epic';

-- ============================================================
-- 二、修复 complete_pet_levelup：保留溢出经验带入新等级
-- 原：exp = 0（清零）
-- 新：exp = greatest(0, old_exp - exp_needed(old_level))（保留溢出）
-- 例：Lv1 上限20，获得50经验 → 升级后 exp=30，Lv2 上限40，显示 30/40
-- ============================================================
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

  v_reward := (coalesce(v_pet.level, 1) + 1) * 1.25;

  v_evolved_bonus := coalesce(v_pet.evolved_bonus, 0.0);
  v_new_max_blood := round(coalesce(v_pet.current_max_blood, 100) * (1.05 + v_evolved_bonus * 0.01))::int;

  v_new_level := coalesce(v_pet.level, 1) + 1;
  v_new_exp_to_next := public.exp_needed(v_new_level, coalesce(v_pet.rarity, 'common'));

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

  update public.members
    set coin_balance = coalesce(coin_balance, 0) + v_reward, updated_at = now()
    where public.members.id = p_member_id;

  return query select * from public.pets where public.pets.id = p_pet_id;
end;
$$;

grant execute on function public.complete_pet_levelup(uuid, uuid) to anon, authenticated;
