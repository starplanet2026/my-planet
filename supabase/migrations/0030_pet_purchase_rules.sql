-- 0030: 宠物购买规则
-- 1) buy_pet_item：禁止重复领养同款宠物；把商品 gender 写入新宠物
-- 2) update_pet_info：gender 改为可选（p_gender 为 null 时跳过性别更新）
-- ============================================================

-- 1) 重建 buy_pet_item
create or replace function public.buy_pet_item(
  p_member_id uuid,
  p_item_id uuid
)
returns table(success boolean, message text, new_star int, new_coin int, pet_id uuid, inventory_qty int)
language plpgsql security definer as $$
declare
  v_item public.pet_shop_items%rowtype;
  v_member public.members%rowtype;
  v_star int;
  v_coin int;
  v_family_id uuid;
  v_pet_id uuid := null;
  v_inv_qty int := 0;
  v_existing_pet_id uuid;
begin
  select * into v_item from public.pet_shop_items where id = p_item_id and status = 'active';
  if not found then return query select false, '商品不存在或已下架', 0, 0, null, 0; return; end if;

  select * into v_member from public.members where id = p_member_id for update;
  v_family_id := v_member.family_id;
  v_star := v_member.star_value;
  v_coin := v_member.coin_balance;

  if v_star < v_item.price_star then
    return query select false, '星光值不足', v_star, v_coin, null, 0; return;
  end if;

  -- 宠物类型：禁止重复领养
  if v_item.type = 'pet' then
    select id into v_existing_pet_id from public.pets
    where member_id = p_member_id and shop_item_id = p_item_id
    limit 1;
    if found then
      return query select false, '已领养该宠物，不可重复购买', v_star, v_coin, null, 0; return;
    end if;
  end if;

  -- 扣星光值
  v_star := v_star - v_item.price_star;
  update public.members set star_value = v_star, updated_at = now() where id = p_member_id;

  if v_item.type = 'pet' then
    -- 购买宠物：创建宠物记录（gender 来自商品，名字留空待用户起名）
    insert into public.pets (family_id, member_id, shop_item_id, name, emoji, image_url, gender, base_coin_per_day, upgrade_coin_reward, coin_balance)
    values (v_family_id, p_member_id, v_item.id, '新宠物', v_item.emoji, v_item.image_url, v_item.gender, v_item.base_coin_per_day, v_item.price_coin, 0)
    returning id into v_pet_id;
    return query select true, '购买成功！请给宠物取个名字', v_star, v_coin, v_pet_id, 0;
  else
    -- 购买用品：存入背包（ON CONFLICT 累加数量）
    insert into public.pet_inventory (family_id, member_id, item_id, item_name_snapshot, item_emoji, item_image_url, subcategory, quantity)
    values (v_family_id, p_member_id, p_item_id, coalesce(v_item.name, '用品'), v_item.emoji, v_item.image_url, v_item.subcategory, 1)
    on conflict (member_id, item_id) do update set quantity = pet_inventory.quantity + 1
    returning quantity into v_inv_qty;
    return query select true, '已购买并存入背包', v_star, v_coin, null, v_inv_qty;
  end if;
end;
$$;

-- 2) 重建 update_pet_info：gender 可选（null 时跳过）
create or replace function public.update_pet_info(
  p_pet_id uuid,
  p_member_id uuid,
  p_name text,
  p_gender text
)
returns void
language plpgsql
security definer
as $$
begin
  -- gender 为 null 时只更新名字
  if p_gender is null then
    update public.pets
    set name = p_name
    where id = p_pet_id and member_id = p_member_id;
  else
    update public.pets
    set name = p_name,
        gender = p_gender::text
    where id = p_pet_id and member_id = p_member_id;
  end if;
end;
$$;

-- 授权
grant execute on function public.buy_pet_item(uuid, uuid) to anon, authenticated;
grant execute on function public.update_pet_info(uuid, uuid, text, text) to anon, authenticated;
