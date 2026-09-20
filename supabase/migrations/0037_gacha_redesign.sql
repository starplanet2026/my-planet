-- 0037: 抽卡重构：花500可抽3次，领养1只，不领养退30%
-- 替换之前的 gacha_draw_3x

drop function if exists public.gacha_draw_3x(uuid);
drop function if exists public.gacha_draw_pet(uuid);

-- 1. 开始抽卡：扣 500 星光值
create or replace function public.gacha_start(p_member_id uuid)
returns table(success boolean, message text)
language plpgsql
security definer
as $$
declare
  v_member record;
  v_dog_house record;
  v_capacity int;
  v_current_count int;
begin
  select * into v_member from public.members where id = p_member_id for update;
  if not found then
    return query select false, '用户不存在';
    return;
  end if;

  if v_member.star_value < 500 then
    return query select false, '星光值不足，需要500星光值';
    return;
  end if;

  -- 检查狗屋容量
  select * into v_dog_house from public.dog_house where member_id = p_member_id;
  if not found or v_dog_house.level = 0 then
    return query select false, '请先购买茅草屋';
    return;
  end if;
  v_capacity := case v_dog_house.level when 1 then 1 when 2 then 5 when 3 then 10 else 0 end;
  select count(*) into v_current_count from pets where member_id = p_member_id;
  if v_current_count >= v_capacity then
    return query select false, '狗屋容量已满，请先升级狗屋';
    return;
  end if;

  -- 扣 500
  update public.members set star_value = star_value - 500 where id = p_member_id;
  return query select true, '抽卡开始';
end;
$$;

-- 2. 领养抽到的宠物（不再扣费）
create or replace function public.gacha_adopt(p_member_id uuid, p_shop_item_id uuid)
returns table(success boolean, message text, pet_id uuid)
language plpgsql
security definer
as $$
declare
  v_member record;
  v_item record;
  v_pet record;
  v_dog_house record;
  v_capacity int;
  v_current_count int;
begin
  select * into v_member from public.members where id = p_member_id for update;
  if not found then
    return query select false, '用户不存在', null::uuid;
    return;
  end if;

  -- 检查狗屋容量
  select * into v_dog_house from public.dog_house where member_id = p_member_id;
  if not found or v_dog_house.level = 0 then
    return query select false, '请先购买茅草屋', null::uuid;
    return;
  end if;
  v_capacity := case v_dog_house.level when 1 then 1 when 2 then 5 when 3 then 10 else 0 end;
  select count(*) into v_current_count from pets where member_id = p_member_id;
  if v_current_count >= v_capacity then
    return query select false, '狗屋容量已满', null::uuid;
    return;
  end if;

  -- 查商品
  select * into v_item from pet_shop_items where id = p_shop_item_id and type = 'pet' and status = 'active';
  if not found then
    return query select false, '宠物不存在或已下架', null::uuid;
    return;
  end if;

  -- 检查是否已拥有
  perform 1 from pets where member_id = p_member_id and shop_item_id = p_shop_item_id;
  if found then
    return query select false, '已领养该宠物', null::uuid;
    return;
  end if;

  -- 创建宠物
  insert into pets (family_id, member_id, shop_item_id, name, emoji, image_url, gender, base_coin_per_day, upgrade_coin_reward, coin_balance)
  values (
    v_member.family_id,
    p_member_id,
    p_shop_item_id,
    '新宠物',
    coalesce(v_item.emoji, ''),
    v_item.image_url,
    coalesce(v_item.gender, 'male'),
    coalesce(v_item.base_coin_per_day, 0),
    0,
    0
  )
  returning * into v_pet;

  return query select true, '领养成功', v_pet.id;
end;
$$;

-- 3. 放弃抽卡：退回 30%（150 星光值）
create or replace function public.gacha_cancel(p_member_id uuid)
returns table(success boolean, message text)
language plpgsql
security definer
as $$
begin
  update public.members set star_value = star_value + 150 where id = p_member_id;
  return query select true, '已退回150星光值';
end;
$$;

grant execute on function public.gacha_start(uuid) to anon, authenticated;
grant execute on function public.gacha_adopt(uuid, uuid) to anon, authenticated;
grant execute on function public.gacha_cancel(uuid) to anon, authenticated;
