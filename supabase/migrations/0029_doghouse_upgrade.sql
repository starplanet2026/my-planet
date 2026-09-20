-- 0029: 狗屋机制调整
-- 1. pet_shop_items.subcategory 加 'doghouse' 分类
-- 2. 新增 buy_doghouse_upgrade RPC：购买狗屋用品时直接扩容（不进背包）
-- 3. 移除旧的 upgrade_dog_house（旧的用 star_value 扣费，已弃用）
-- ============================================================

-- 1. 放宽 subcategory CHECK 约束：增加 doghouse
alter table public.pet_shop_items drop constraint if exists pet_shop_items_subcategory_check;
alter table public.pet_shop_items add constraint pet_shop_items_subcategory_check
  check (subcategory in ('dog','cat','food','clean','toy','medicine','foster','doghouse'));

-- 2. 新增 buy_doghouse_upgrade RPC：购买狗屋用品时直接扩容
--    入参：p_member_id, p_item_id
--    逻辑：校验商品 type='supply' AND subcategory='doghouse' AND status='active'
--          -> 扣 star_value 或 coin_balance（优先 star，不够再扣 coin）
--          -> dog_house.level+1, capacity+2
--          -> 不入背包，直接消费
drop function if exists public.buy_doghouse_upgrade(uuid, uuid);
create or replace function public.buy_doghouse_upgrade(
  p_member_id uuid,
  p_item_id uuid
)
returns table(success boolean, message text, new_level int, new_capacity int, new_star int, new_coin int)
language plpgsql security definer as $$
declare
  v_member  public.members%rowtype;
  v_item    public.pet_shop_items%rowtype;
  v_house   public.dog_house%rowtype;
  v_star    int;
  v_coin    int;
  v_need_star int;
  v_need_coin int;
begin
  -- 锁定会员
  select * into v_member from public.members where id = p_member_id for update;
  if not found then
    return query select false, '会员不存在', 0, 0, 0, 0;
    return;
  end if;

  -- 锁定商品
  select * into v_item from public.pet_shop_items where id = p_item_id for update;
  if not found then
    return query select false, '商品不存在', 0, 0, 0, 0;
    return;
  end if;

  -- 校验：必须是 supply + doghouse + active
  if v_item.type <> 'supply' or v_item.subcategory <> 'doghouse' then
    return query select false, '该商品不是狗屋', 0, 0, 0, 0;
    return;
  end if;
  if v_item.status <> 'active' then
    return query select false, '商品已下架', 0, 0, 0, 0;
    return;
  end if;

  -- 库存校验
  if v_item.stock is not null and v_item.stock <= 0 then
    return query select false, '已售罄', 0, 0, 0, 0;
    return;
  end if;

  -- 锁定狗窝（首次自动初始化）
  select * into v_house from public.dog_house where member_id = p_member_id for update;
  if not found then
    insert into public.dog_house (family_id, member_id, level, capacity)
    values (v_member.family_id, p_member_id, 1, 3)
    returning * into v_house;
  end if;

  -- 扣费：先用 star，不够再扣 coin；两者都不够则失败
  v_need_star := v_item.price_star;
  v_need_coin := v_item.price_coin;
  v_star := v_member.star_value;
  v_coin := v_member.coin_balance;

  if v_need_star > 0 and v_star < v_need_star then
    return query select false, '星光值不足', v_house.level, v_house.capacity, v_star, v_coin;
    return;
  end if;
  if v_need_coin > 0 and v_coin < v_need_coin then
    return query select false, '金币不足', v_house.level, v_house.capacity, v_star, v_coin;
    return;
  end if;

  -- 扣费
  if v_need_star > 0 then
    update public.members set star_value = star_value - v_need_star where id = p_member_id;
    v_star := v_star - v_need_star;
  end if;
  if v_need_coin > 0 then
    update public.members set coin_balance = coin_balance - v_need_coin where id = p_member_id;
    v_coin := v_coin - v_need_coin;
  end if;

  -- 升级狗窝：level+1, capacity+2
  v_house.level := v_house.level + 1;
  v_house.capacity := v_house.capacity + 2;
  update public.dog_house
    set level = v_house.level, capacity = v_house.capacity, updated_at = now()
    where member_id = p_member_id;

  -- 库存 -1（若启用库存）
  if v_item.stock is not null then
    update public.pet_shop_items set stock = stock - 1 where id = p_item_id;
  end if;

  return query select true, '狗窝扩容成功！容量 +2', v_house.level, v_house.capacity, v_star, v_coin;
end;
$$;

grant execute on function public.buy_doghouse_upgrade(uuid, uuid) to anon, authenticated;
