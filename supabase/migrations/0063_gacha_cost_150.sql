-- ============================================================
-- 0063: 抽卡价格从 500 改为 150 星光值
-- 退款 30% = 45 星光值（原 500 * 30% = 150）
-- 修复：gacha_start 只扣费，gacha_adopt 接收 shop_item_id 创建宠物记录
-- ============================================================

-- 1. 重写 gacha_start：只扣 150 星光值，不创建宠物记录
drop function if exists public.gacha_start(uuid);
create or replace function public.gacha_start(p_member_id uuid)
returns table(
  success boolean,
  message text,
  remaining_star int,
  price_star int
)
language plpgsql security definer as $$
declare
  v_member public.members%rowtype;
  v_star int;
begin
  select * into v_member from public.members where id = p_member_id for update;
  if not found then
    return query select false, '成员不存在', 0, 0;
    return;
  end if;

  -- 星光值校验
  if v_member.star_value < 150 then
    return query select false, '需要150星光值才能抽卡', v_member.star_value, 0;
    return;
  end if;

  -- 扣 150 星光值
  v_star := v_member.star_value - 150;
  update public.members
    set star_value = v_star, updated_at = now()
    where public.members.id = p_member_id;

  return query select true, '抽卡开始', v_star, 150;
end;
$$;

grant execute on function public.gacha_start(uuid) to anon, authenticated;

-- 2. 重写 gacha_cancel：退回 45 星光值（150 * 30% = 45）
drop function if exists public.gacha_cancel(uuid);
create or replace function public.gacha_cancel(p_member_id uuid)
returns table(success boolean, message text, remaining_star int)
language plpgsql security definer as $$
declare
  v_star int;
begin
  update public.members set star_value = star_value + 45, updated_at = now()
    where id = p_member_id
    returning star_value into v_star;

  return query select true, '取消抽卡，退回45星光值', v_star;
end;
$$;

grant execute on function public.gacha_cancel(uuid) to anon, authenticated;

-- 3. 重写 gacha_adopt：接收 shop_item_id，创建宠物记录并返回 pet_id
drop function if exists public.gacha_adopt(uuid, uuid);
create or replace function public.gacha_adopt(
  p_member_id uuid,
  p_shop_item_id uuid
)
returns table(
  success boolean,
  message text,
  pet_id uuid,
  pet_name text,
  pet_image text
)
language plpgsql security definer as $$
declare
  v_member public.members%rowtype;
  v_pet_row public.pet_shop_items%rowtype;
  v_new_pet public.pets%rowtype;
begin
  select * into v_member from public.members where id = p_member_id for update;
  if not found then
    return query select false, '成员不存在', null::uuid, null::text, null::text;
    return;
  end if;

  -- 查找选中的宠物商品
  select * into v_pet_row from public.pet_shop_items
    where id = p_shop_item_id and family_id = v_member.family_id;

  if not found then
    return query select false, '宠物商品不存在', null::uuid, null::text, null::text;
    return;
  end if;

  -- 检查是否已拥有该宠物
  if exists (
    select 1 from public.pets
    where member_id = p_member_id and shop_item_id = p_shop_item_id
  ) then
    return query select false, '已拥有该宠物', null::uuid, null::text, null::text;
    return;
  end if;

  -- 创建宠物记录
  insert into public.pets (
    family_id, member_id, shop_item_id, name, image_url,
    hunger, clean, happiness, health,
    max_level, current_max_blood, daily_decay_base,
    upgrade_percent, upgrade_coin_reward, rarity, evolved_bonus,
    exp, last_check_at
  ) values (
    v_member.family_id, p_member_id, v_pet_row.id,
    v_pet_row.name, v_pet_row.image_url,
    0, 0, 0, 0,
    v_pet_row.max_level, v_pet_row.max_blood_bar, v_pet_row.daily_decay_base,
    v_pet_row.upgrade_percent, v_pet_row.upgrade_coin_reward, v_pet_row.rarity, 1.0,
    0, now()
  )
  returning * into v_new_pet;

  if not found then
    return query select false, '创建宠物失败', null::uuid, null::text, null::text;
    return;
  end if;

  -- 减库存
  update public.pet_shop_items set stock = case
    when stock is null then null
    else stock - 1
  end
    where id = v_pet_row.id;

  return query select true, '领养成功', v_new_pet.id, v_pet_row.name, v_pet_row.image_url;
end;
$$;

grant execute on function public.gacha_adopt(uuid, uuid) to anon, authenticated;
