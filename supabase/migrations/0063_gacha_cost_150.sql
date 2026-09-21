-- ============================================================
-- 0063: 抽卡价格从 500 改为 150 星光值
-- 退款 30% = 45 星光值（原 500 * 30% = 150）
-- ============================================================

-- 1. 重写 gacha_start：扣 150 星光值（原 500）
create or replace function public.gacha_start(p_member_id uuid)
returns table(
  success boolean,
  message text,
  pet_id uuid,
  pet_name text,
  pet_image text,
  pet_species text,
  remaining_star int,
  price_star int
)
language plpgsql security definer as $$
declare
  v_member public.members%rowtype;
  v_star int;
  v_pet_row record;
  v_new_pet public.pets%rowtype;
begin
  select * into v_member from public.members where id = p_member_id for update;
  if not found then
    return query select false, '成员不存在', null::uuid, null::text, null::text, null::text, 0, 0;
    return;
  end if;

  -- 星光值校验（每次抽卡消耗 150）
  if v_member.star_value < 150 then
    return query select false, '需要150星光值才能抽卡', null::uuid, null::text, null::text, null::text, v_member.star_value, 0;
    return;
  end if;

  -- 扣 150 星光值
  v_star := v_member.star_value - 150;
  update public.members
    set star_value = v_star, updated_at = now()
    where public.members.id = p_member_id;

  -- 随机选一只可抽的宠物商品
  select * into v_pet_row from public.pet_shop_items
    where family_id = v_member.family_id
      and subcategory = 'pet'
      and inventory > 0
    order by random()
    limit 1;

  if not found then
    -- 没有可抽的宠物，退还星光值
    update public.members set star_value = star_value + 150 where public.members.id = p_member_id;
    return query select false, '暂无可抽的宠物', null::uuid, null::text, null::text, null::text, v_member.star_value, 0;
    return;
  end if;

  -- 创建宠物记录
  insert into public.pets (
    family_id, member_id, item_id, name, species, image_url,
    hunger, cleanliness, happiness, health,
    max_level, current_max_blood, daily_decay_base,
    upgrade_percent, upgrade_coin_reward, rarity, evolved_bonus,
    exp, last_check_at
  ) values (
    v_member.family_id, p_member_id, v_pet_row.id,
    v_pet_row.name, v_pet_row.species, v_pet_row.image_url,
    0, 0, 0, 0,
    v_pet_row.max_level, v_pet_row.max_blood_bar, v_pet_row.daily_decay_base,
    v_pet_row.upgrade_percent, v_pet_row.upgrade_coin_reward, v_pet_row.rarity, 1.0,
    0, now()
  )
  returning * into v_new_pet;

  if not found then
    update public.members set star_value = star_value + 150 where public.members.id = p_member_id;
    return query select false, '创建宠物失败', null::uuid, null::text, null::text, null::text, v_member.star_value, 0;
    return;
  end if;

  -- 减库存
  update public.pet_shop_items set inventory = inventory - 1
    where id = v_pet_row.id;

  return query select true, '抽卡成功', v_new_pet.id, v_pet_row.name,
    v_pet_row.image_url, v_pet_row.species, v_star, v_pet_row.price_star;
end;
$$;

grant execute on function public.gacha_start(uuid) to anon, authenticated;

-- 2. 重写 gacha_cancel：退回 45 星光值（150 * 30% = 45）
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
