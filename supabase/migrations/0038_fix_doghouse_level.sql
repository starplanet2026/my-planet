-- 0038: 修复狗屋购买报错 + 设置正确的 doghouse_level

-- 1) 把所有 doghouse 商品的 doghouse_level 设为正确值（按名称匹配）
update public.pet_shop_items set doghouse_level = 1
  where subcategory = 'doghouse' and doghouse_level is null or (subcategory = 'doghouse' and doghouse_level = 0)
  and (name like '%茅草%' or name like '%一级%' or name like '%level1%' or name like '%lv1%');

update public.pet_shop_items set doghouse_level = 2
  where subcategory = 'doghouse'
  and (name like '%温馨%' or name like '%二级%' or name like '%level2%' or name like '%lv2%');

update public.pet_shop_items set doghouse_level = 3
  where subcategory = 'doghouse'
  and (name like '%豪华%' or name like '%豪化%' or name like '%三级%' or name like '%level3%' or name like '%lv3%');

-- 2) 重建 buy_doghouse_upgrade：doghouse_level=0 视为未配置
drop function if exists public.buy_doghouse_upgrade(uuid, uuid);

create or replace function public.buy_doghouse_upgrade(
  p_member_id uuid,
  p_item_id uuid
)
returns table(success boolean, message text, new_level int, new_capacity int, new_star int, new_coin int)
language plpgsql security definer as $$
declare
  v_member public.members%rowtype;
  v_item public.pet_shop_items%rowtype;
  v_star int;
  v_coin int;
  v_need_star int;
  v_need_coin int;
  v_current_level int := 0;
  v_target_level int;
  v_new_capacity int;
  v_family_id uuid;
begin
  select * into v_member from public.members where id = p_member_id for update;
  if not found then
    return query select false, '会员不存在', 0, 0, 0, 0;
    return;
  end if;
  v_family_id := v_member.family_id;

  select * into v_item from public.pet_shop_items where id = p_item_id for update;
  if not found then
    return query select false, '商品不存在', 0, 0, 0, 0;
    return;
  end if;

  if v_item.type <> 'supply' or v_item.subcategory <> 'doghouse' then
    return query select false, '该商品不是狗屋', 0, 0, 0, 0;
    return;
  end if;
  if v_item.status <> 'active' then
    return query select false, '商品已下架', 0, 0, 0, 0;
    return;
  end if;

  -- doghouse_level 为 null 或 0 视为未配置
  if v_item.doghouse_level is null or v_item.doghouse_level = 0 then
    return query select false, '该狗屋未配置等级，请在后台编辑商品设置等级', 0, 0, v_member.star_value, v_member.coin_balance;
    return;
  end if;

  if v_item.stock is not null and v_item.stock <= 0 then
    return query select false, '已售罄', 0, 0, 0, 0;
    return;
  end if;

  -- 当前狗屋等级
  select level into v_current_level from public.dog_house where member_id = p_member_id;
  if not found then v_current_level := 0; end if;

  v_target_level := v_item.doghouse_level;

  -- 必须按顺序购买
  if v_target_level <= v_current_level then
    return query select false, '已拥有该级别或更高狗屋', v_current_level, 0, v_member.star_value, v_member.coin_balance;
    return;
  elsif v_target_level <> v_current_level + 1 then
    return query select false, '请先购买上一级狗屋', v_current_level, 0, v_member.star_value, v_member.coin_balance;
    return;
  end if;

  -- 扣费
  v_need_star := v_item.price_star;
  v_need_coin := v_item.price_coin;
  v_star := v_member.star_value;
  v_coin := v_member.coin_balance;

  if v_need_star > 0 and v_star < v_need_star then
    return query select false, '星光值不足', v_current_level, 0, v_star, v_coin;
    return;
  end if;
  if v_need_coin > 0 and v_coin < v_need_coin then
    return query select false, '金币不足', v_current_level, 0, v_star, v_coin;
    return;
  end if;

  if v_need_star > 0 then
    update public.members set star_value = star_value - v_need_star where id = p_member_id;
    v_star := v_star - v_need_star;
  end if;
  if v_need_coin > 0 then
    update public.members set coin_balance = coin_balance - v_need_coin where id = p_member_id;
    v_coin := v_coin - v_need_coin;
  end if;

  v_new_capacity := case v_target_level
    when 1 then 1
    when 2 then 5
    when 3 then 10
    else 0
  end;

  -- upsert dog_house
  insert into public.dog_house (member_id, family_id, level, capacity, upgrade_cost)
  values (p_member_id, v_family_id, v_target_level, v_new_capacity, 0)
  on conflict (member_id) do update
  set level = v_target_level, capacity = v_new_capacity, updated_at = now();

  return query select true, '狗屋升级成功', v_target_level, v_new_capacity, v_star, v_coin;
end;
$$;

grant execute on function public.buy_doghouse_upgrade(uuid, uuid) to anon, authenticated;
