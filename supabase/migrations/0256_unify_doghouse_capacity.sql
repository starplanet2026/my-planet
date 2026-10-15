-- 0256: 狗屋容量全局统一为 1/5/10（等级派生），消除历史双规则
-- ============================================================
-- 背景：
--   * 新路径 buy_doghouse_upgrade（宠物店购买住所）写入时未显式写 capacity，
--     落到表默认值 3 → 买「茅草屋」(level 1) 也会得到 3 个饲养位；
--   * 旧路径 upgrade_dog_house（DogHouseBar，现已无任何页面引用）用「每级 +2」
--     且无等级上限 → 会写回 1/3/5 之类的旧值，是历史容量值漂移的根因；
--   * 读取端 get_dog_house 直接返回存储列，无法自愈。
-- 本次统一：
--   1) 新增 dog_house_capacity(level) 作为唯一容量口径：1→1、2→5、3→10；
--   2) 表默认值改为 1（level 默认 1 → 容量 1）；
--   3) get_dog_house 的容量改为按 level 派生，存储列漂移也能自愈；
--   4) buy_doghouse_upgrade / upgrade_dog_house 均按该口径写入并补等级上限校验，
--      旧路径费用与宠物店住所商品价格对齐（茅草屋10 / 温馨小屋100 / 豪华小屋500）；
--   5) 存量 dog_house.capacity 再对齐一次。
-- ============================================================

-- ========== 1. 唯一容量口径：等级 → 容量 ==========
create or replace function public.dog_house_capacity(p_level integer)
returns integer
language sql immutable as $$
  select case p_level
    when 1 then 1
    when 2 then 5
    when 3 then 10
    when 0 then 0
    else 10
  end;
$$;

grant execute on function public.dog_house_capacity(integer) to anon, authenticated;


-- ========== 2. 表默认值：level 1 → 容量 1 ==========
alter table public.dog_house alter column capacity set default 1;


-- ========== 3. get_dog_house：容量按等级派生 ==========
create or replace function public.get_dog_house(p_member_id uuid)
returns table(level integer, capacity integer, current_pet_count integer, upgrade_cost integer)
language plpgsql security definer as $$
declare
  v_house public.dog_house%rowtype;
  v_count int;
  v_level int;
begin
  select * into v_house from public.dog_house where member_id = p_member_id;
  v_level := coalesce(v_house.level, 0);

  -- 进修中的宠物不计入容量（不占用饲养位）
  select count(*) into v_count from public.pets
    where member_id = p_member_id and coalesce(is_studying, false) = false;

  if v_house.id is null or v_level = 0 then
    return query select 0, 0, v_count, 10;
  else
    -- 容量一律按等级派生，避免存储列历史漂移
    return query select v_level, public.dog_house_capacity(v_level), v_count, 10 * v_level;
  end if;
end;
$$;

grant execute on function public.get_dog_house(uuid) to anon, authenticated;


-- ========== 4. buy_doghouse_upgrade：显式写入派生容量 ==========
create or replace function public.buy_doghouse_upgrade(p_member_id uuid, p_item_id uuid)
returns table(success boolean, message text, new_level integer, new_capacity integer, remaining_star integer)
language plpgsql security definer as $$
declare
  v_item public.pet_shop_items%rowtype;
  v_member public.members%rowtype;
  v_dh public.dog_house%rowtype;
  v_star int;
  v_current_level int;
  v_target_level int;
  v_new_capacity int;
  v_family_id uuid;
begin
  select * into v_item from public.pet_shop_items where public.pet_shop_items.id = p_item_id and status = 'active';
  if not found then
    return query select false, '商品不存在或已下架', 0, 0, 0;
    return;
  end if;

  if v_item.subcategory != 'doghouse' or v_item.doghouse_level is null or v_item.doghouse_level = 0 then
    return query select false, '该商品不是狗屋或未配置等级', 0, 0, 0;
    return;
  end if;

  select * into v_member from public.members where public.members.id = p_member_id for update;
  v_star := v_member.star_value;
  v_family_id := v_member.family_id;

  if v_star < v_item.price_star then
    return query select false, '星光值不足', 0, 0, v_star;
    return;
  end if;

  select * into v_dh from public.dog_house where member_id = p_member_id for update;
  v_current_level := coalesce(v_dh.level, 0);
  v_target_level := v_item.doghouse_level;

  if v_target_level <= v_current_level then
    return query select false, '已拥有该等级或更高狗屋', v_current_level, public.dog_house_capacity(v_current_level), v_star;
    return;
  end if;

  v_star := v_star - v_item.price_star;
  update public.members set star_value = v_star, updated_at = now() where public.members.id = p_member_id;

  -- 星光消耗流水
  insert into public.coin_records (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by, balance_type)
  values (v_family_id, p_member_id, -v_item.price_star, v_star,
    '购买住所「' || coalesce(v_item.name, '狗屋') || '」', 'purchase', 'pet_shop_item', p_item_id, p_member_id, 'star');

  -- 容量按等级派生写入（此前漏写容量，落到表默认值导致 level1 也有 3 个饲养位）
  v_new_capacity := public.dog_house_capacity(v_target_level);

  if v_dh.id is null then
    insert into public.dog_house (family_id, member_id, level, capacity)
    values (v_family_id, p_member_id, v_target_level, v_new_capacity);
  else
    update public.dog_house
      set level = v_target_level, capacity = v_new_capacity, updated_at = now()
      where member_id = p_member_id;
  end if;

  return query select true, '升级成功', v_target_level, v_new_capacity, v_star;
end;
$$;

grant execute on function public.buy_doghouse_upgrade(uuid, uuid) to anon, authenticated;


-- ========== 5. upgrade_dog_house：旧路径统一口径 + 等级上限 + 价格对齐 ==========
--    该路径当前前端已无调用（DogHouseBar 组件无任何页面引用），
--    此处统一为与宠物店购买住所完全一致的规则，避免再次写坏容量。
create or replace function public.upgrade_dog_house(p_member_id uuid)
returns table(success boolean, message text, new_level integer, new_capacity integer, new_star integer)
language plpgsql security definer as $$
declare
  v_member public.members%rowtype;
  v_house public.dog_house%rowtype;
  v_level int;
  v_target int;
  v_cost int;
  v_star int;
begin
  select * into v_member from public.members where id = p_member_id for update;
  if not found then
    return query select false, '用户不存在', 0, 0, 0;
    return;
  end if;
  v_star := coalesce(v_member.star_value, 0);

  select * into v_house from public.dog_house where member_id = p_member_id for update;
  v_level := coalesce(v_house.level, 0);

  if v_level = 0 then
    return query select false, '请先在宠物店购买「茅草屋」解锁饲养位', 0, 0, v_star;
    return;
  end if;

  if v_level >= 3 then
    return query select false, '已是最高等级「豪华小屋」，无法继续升级', 3, public.dog_house_capacity(3), v_star;
    return;
  end if;

  v_target := v_level + 1;
  -- 与宠物店住所商品价格对齐：温馨小屋 100、豪华小屋 500
  v_cost := case v_target when 2 then 100 when 3 then 500 else 0 end;

  if v_star < v_cost then
    return query select false, '星光值不足，需要' || v_cost || '星光值', v_level, public.dog_house_capacity(v_level), v_star;
    return;
  end if;

  v_star := v_star - v_cost;
  update public.members set star_value = v_star, updated_at = now() where id = p_member_id;
  update public.dog_house
    set level = v_target, capacity = public.dog_house_capacity(v_target), updated_at = now()
    where member_id = p_member_id;

  return query select true, '狗屋升级成功', v_target, public.dog_house_capacity(v_target), v_star;
end;
$$;

grant execute on function public.upgrade_dog_house(uuid) to anon, authenticated;


-- ========== 6. 存量容量再对齐一次 ==========
update public.dog_house
set capacity = public.dog_house_capacity(level), updated_at = now()
where capacity is distinct from public.dog_house_capacity(level);

notify pgrst, 'reload schema';
