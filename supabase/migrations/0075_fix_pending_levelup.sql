-- 0075: 修复 pending_levelup 逻辑
-- 问题：exp 已满但 pending_levelup 未被设置（0074 修复前的遗留数据），
-- 导致 complete_pet_levelup RPC 拒绝升级
-- 修复：
--   1. 重建 complete_pet_levelup：不再硬性要求 pending_levelup=true，
--      改为检查 exp >= exp_needed(level, rarity)
--   2. 修复存量数据：对所有 exp 已满但未满级的宠物设置 pending_levelup=true

-- ============================================================
-- 一、重建 complete_pet_levelup
-- ============================================================
create or replace function public.complete_pet_levelup(
  p_member_id uuid,
  p_pet_id uuid
)
returns setof public.pets
language plpgsql security definer as $$
declare
  v_pet record;
  v_reward int := 10;
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

  -- 经验必须足够（不再硬性要求 pending_levelup=true）
  v_exp_needed := public.exp_needed(coalesce(v_pet.level, 1), coalesce(v_pet.rarity, 'common'));
  if coalesce(v_pet.exp, 0) < v_exp_needed then
    return query select * from public.pets where public.pets.id = p_pet_id;
    return;
  end if;

  -- 升级
  update public.pets set
    level = coalesce(v_pet.level, 1) + 1,
    pending_levelup = false
  where public.pets.id = p_pet_id;

  -- 给孩子加金币
  update public.members
    set coin_balance = coalesce(coin_balance, 0) + v_reward, updated_at = now()
    where public.members.id = p_member_id;

  return query select * from public.pets where public.pets.id = p_pet_id;
end;
$$;

-- ============================================================
-- 二、修复存量数据：exp 已满的宠物设置 pending_levelup=true
-- ============================================================
update public.pets p set pending_levelup = true
  where p.level < coalesce(p.max_level, 10)
    and coalesce(p.exp, 0) >= public.exp_needed(coalesce(p.level, 1), coalesce(p.rarity, 'common'))
    and coalesce(p.pending_levelup, false) = false;
