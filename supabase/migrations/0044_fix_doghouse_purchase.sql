-- 0044: 修复狗屋购买失败问题
-- ============================================================
-- 根因：0040 / 0041 重建的 buy_doghouse_upgrade 在 INSERT/UPDATE
-- public.dog_house 时引用了 upgrade_cost 列，但 dog_house 表
-- （见 0019_pet_planet_v2.sql）从未声明该列，且没有任何迁移补加过，
-- 导致运行时报错 "column "upgrade_cost" does not exist"，
-- 狗屋商品永远无法购买成功。
--
-- 本迁移：
--   1) 确保 pet_shop_items.doghouse_level 列存在
--   2) 按名称回填 doghouse_level（茅草=1 / 温馨=2 / 豪华=3）
--   3) 重建 buy_doghouse_upgrade，不再引用 upgrade_cost 列
--      使用 record 类型、public.<table>.<column> 形式 WHERE 子句，
--      并处理 dog_house 记录不存在的情况（自动创建）。
-- ============================================================

-- 1. 确保 doghouse_level 列存在
alter table public.pet_shop_items
  add column if not exists doghouse_level int;

-- 2. 按名称回填 doghouse_level（仅处理 NULL 或 0 的狗屋商品）
--    用括号正确限定 OR 优先级，避免误伤其它分类商品
update public.pet_shop_items
set doghouse_level = 1
where subcategory = 'doghouse'
  and (doghouse_level is null or doghouse_level = 0)
  and (name ilike '%茅草%' or name ilike '%一级%' or name ilike '%level1%' or name ilike '%lv1%');

update public.pet_shop_items
set doghouse_level = 2
where subcategory = 'doghouse'
  and (doghouse_level is null or doghouse_level = 0)
  and (name ilike '%温馨%' or name ilike '%二级%' or name ilike '%level2%' or name ilike '%lv2%');

update public.pet_shop_items
set doghouse_level = 3
where subcategory = 'doghouse'
  and (doghouse_level is null or doghouse_level = 0)
  and (name ilike '%豪华%' or name ilike '%豪化%' or name ilike '%三级%' or name ilike '%level3%' or name ilike '%lv3%');

-- 3. 重建 buy_doghouse_upgrade（移除 upgrade_cost 引用，避免列不存在的运行时错误）
drop function if exists public.buy_doghouse_upgrade(uuid, uuid);

create function public.buy_doghouse_upgrade(
  p_member_id uuid,
  p_item_id uuid
)
returns table(
  success boolean,
  message text,
  new_level int,
  new_capacity int,
  remaining_star int
)
language plpgsql security definer as $$
declare
  v_item record;
  v_member record;
  v_dh record;
  v_star int;
  v_current_level int;
  v_target_level int;
  v_new_capacity int;
begin
  -- 锁定商品（必须 active）
  select * into v_item from public.pet_shop_items
    where public.pet_shop_items.id = p_item_id and status = 'active'
    for update;
  if not found then
    return query select false, '商品不存在或已下架', 0, 0, 0;
    return;
  end if;

  -- 校验：必须是狗屋类商品
  if v_item.subcategory != 'doghouse' then
    return query select false, '该商品不是狗屋', 0, 0, 0;
    return;
  end if;

  -- 校验：doghouse_level 必须配置
  if v_item.doghouse_level is null or v_item.doghouse_level = 0 then
    return query select false, '该狗屋未配置等级，请在后台编辑商品设置等级', 0, 0, 0;
    return;
  end if;

  -- 锁定会员
  select * into v_member from public.members
    where public.members.id = p_member_id for update;
  if not found then
    return query select false, '会员不存在', 0, 0, 0;
    return;
  end if;

  v_star := v_member.star_value;

  -- 星光值校验
  if v_star < coalesce(v_item.price_star, 0) then
    return query select false, '星光值不足', 0, 0, v_star;
    return;
  end if;

  -- 当前狗屋等级（无记录=0）
  select * into v_dh from public.dog_house
    where public.dog_house.member_id = p_member_id for update;
  v_current_level := coalesce(v_dh.level, 0);
  v_target_level := v_item.doghouse_level;

  -- 已拥有该等级或更高
  if v_current_level >= v_target_level then
    return query select false, '已拥有该等级狗屋', v_current_level, 0, v_star;
    return;
  end if;

  -- 必须按顺序升级：target = current + 1
  if v_target_level != v_current_level + 1 then
    return query select false, '需要按顺序购买狗屋', v_current_level, 0, v_star;
    return;
  end if;

  -- 容量映射：1→1, 2→5, 3→10
  v_new_capacity := case v_target_level
    when 1 then 1
    when 2 then 5
    when 3 then 10
    else 10
  end;

  -- 扣星光值
  v_star := v_star - coalesce(v_item.price_star, 0);
  update public.members
    set star_value = v_star, updated_at = now()
    where public.members.id = p_member_id;

  -- 创建或更新 dog_house 记录（不引用 upgrade_cost 列，避免列不存在的运行时报错）
  if v_current_level = 0 then
    insert into public.dog_house (member_id, family_id, level, capacity)
    values (p_member_id, v_member.family_id, v_target_level, v_new_capacity);
  else
    update public.dog_house
      set level = v_target_level,
          capacity = v_new_capacity,
          updated_at = now()
      where public.dog_house.member_id = p_member_id;
  end if;

  return query select true, '狗屋升级成功！', v_target_level, v_new_capacity, v_star;
end;
$$;

grant execute on function public.buy_doghouse_upgrade(uuid, uuid) to anon, authenticated;
