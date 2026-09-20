-- 0043: 修复宠物稀有度与最大等级
-- ============================================================
-- 背景：pets 表缺少 rarity 列；max_level 默认为 10 而非 3/5/7。
-- 已有宠物全部显示为"史诗"且 1/10 —— 本迁移补齐 rarity 列、回填数据，
-- 并重建 gacha_start / buy_pet_item，使抽卡/购买时把 rarity 与正确 max_level 落库。
-- ============================================================

-- ============================================================
-- 一、pets 表新增 rarity 列
-- ============================================================
alter table public.pets
  add column if not exists rarity text default 'common'
    check (rarity in ('common','rare','epic'));

-- ============================================================
-- 二、回填已有宠物：从 pet_shop_items 同步 rarity 和 max_level
--     join on pets.shop_item_id = pet_shop_items.id
-- ============================================================
update public.pets p
set
  rarity = psi.rarity,
  max_level = coalesce(psi.max_level, 3)
from public.pet_shop_items psi
where p.shop_item_id = psi.id;

-- 三、没有匹配 shop_item 的宠物：兜底为 common / 3
update public.pets
set
  rarity = 'common',
  max_level = 3
where rarity is null
   or rarity = 'common' and max_level is null
   or max_level is null or max_level = 0 or max_level > 10;

-- 兜底修正：rarity 已知但 max_level 仍是 10 的历史脏数据
update public.pets set max_level = 3 where rarity = 'common' and (max_level is null or max_level >= 10);
update public.pets set max_level = 5 where rarity = 'rare'   and (max_level is null or max_level >= 10);
update public.pets set max_level = 7 where rarity = 'epic'   and (max_level is null or max_level >= 10);

-- ============================================================
-- 四、按稀有度强制对齐 max_level：common=3, rare=5, epic=7
-- ============================================================
update public.pets set max_level = 3 where rarity = 'common';
update public.pets set max_level = 5 where rarity = 'rare';
update public.pets set max_level = 7 where rarity = 'epic';

-- ============================================================
-- 五、重建 gacha_start：抽卡时把 rarity / max_level 等从 shop_item 拷贝到 pets
-- ============================================================
drop function if exists public.gacha_start(uuid);

create function public.gacha_start(p_member_id uuid)
returns table(
  success boolean,
  message text,
  drawn_pet_id uuid,
  drawn_pet_name text,
  drawn_pet_emoji text,
  drawn_pet_image text,
  remaining_star int,
  draw_count int
)
language plpgsql security definer as $$
declare
  v_member record;
  v_item record;
  v_pet_id uuid;
  v_star int;
begin
  select * into v_member from public.members where public.members.id = p_member_id for update;
  if not found then
    return query select false, '用户不存在', null::uuid, null::text, null::text, null::text, 0, 0;
    return;
  end if;

  if v_member.star_value < 500 then
    return query select false, '需要500星光值才能抽卡', null::uuid, null::text, null::text, null::text, v_member.star_value, 0;
    return;
  end if;

  v_star := v_member.star_value - 500;
  update public.members set star_value = v_star, updated_at = now() where public.members.id = p_member_id;

  select * into v_item from public.pet_shop_items
  where type = 'pet' and status = 'active' and price_star > 0
  order by random() limit 1;

  if not found then
    update public.members set star_value = star_value + 500 where public.members.id = p_member_id;
    return query select false, '暂无可抽的宠物', null::uuid, null::text, null::text, null::text, v_member.star_value, 0;
    return;
  end if;

  insert into public.pets (
    family_id, member_id, shop_item_id, name, emoji, image_url, gender,
    base_coin_per_day, upgrade_coin_reward, coin_balance,
    max_level, current_max_blood, daily_decay_base, upgrade_percent,
    evolved_bonus, exp, rarity
  )
  values (
    v_member.family_id, p_member_id, v_item.id, '新宠物', v_item.emoji, v_item.image_url, v_item.gender,
    coalesce(v_item.base_coin_per_day, 2), coalesce(v_item.upgrade_coin_reward, 5), 0,
    coalesce(v_item.max_level, 3), coalesce(v_item.max_blood_bar, 100),
    coalesce(v_item.daily_decay_base, 5), coalesce(v_item.upgrade_percent, 5.0),
    0.0, 0, coalesce(v_item.rarity, 'common')
  )
  returning id into v_pet_id;

  return query select true, '抽卡成功', v_pet_id, v_item.name, v_item.emoji, v_item.image_url, v_star, 1;
end;
$$;

-- ============================================================
-- 六、重建 buy_pet_item：购买时把 rarity 等从 shop_item 拷贝到 pets
-- ============================================================
drop function if exists public.buy_pet_item(uuid, uuid);

create function public.buy_pet_item(
  p_member_id uuid,
  p_item_id uuid
)
returns table(
  success boolean,
  message text,
  new_star int,
  new_coin int,
  pet_id uuid,
  inventory_qty int
)
language plpgsql security definer as $$
declare
  v_item record;
  v_member record;
  v_star int;
  v_coin int;
  v_family_id uuid;
  v_pet_id uuid := null;
  v_inv_qty int := 0;
  v_existing_pet_id uuid;
  v_doghouse_level int;
  v_current_pet_count int;
  v_capacity int;
begin
  select * into v_item from public.pet_shop_items
    where public.pet_shop_items.id = p_item_id and status = 'active';
  if not found then
    return query select false, '商品不存在或已下架', 0, 0, null::uuid, 0;
    return;
  end if;

  select * into v_member from public.members where public.members.id = p_member_id for update;
  v_family_id := v_member.family_id;
  v_star := v_member.star_value;
  v_coin := v_member.coin_balance;

  if v_star < coalesce(v_item.price_star, 0) then
    return query select false, '星光值不足', v_star, v_coin, null::uuid, 0;
    return;
  end if;

  if v_item.subcategory = 'doghouse' then
    return query select false, '请使用狗屋升级功能', v_star, v_coin, null::uuid, 0;
    return;
  end if;

  if v_item.type = 'pet' then
    select id into v_existing_pet_id from public.pets
    where member_id = p_member_id and shop_item_id = p_item_id
    limit 1;
    if found then
      return query select false, '已领养该宠物，不可重复购买', v_star, v_coin, null::uuid, 0;
      return;
    end if;

    select level into v_doghouse_level from public.dog_house where member_id = p_member_id limit 1;
    v_doghouse_level := coalesce(v_doghouse_level, 0);
    select count(*) into v_current_pet_count from public.pets where member_id = p_member_id;

    v_capacity := case v_doghouse_level
      when 0 then 0
      when 1 then 1
      when 2 then 5
      when 3 then 10
      else 10
    end;

    if v_current_pet_count >= v_capacity then
      if v_doghouse_level = 0 then
        return query select false, '请先购买「茅草屋」才能领养宠物', v_star, v_coin, null::uuid, 0;
      elsif v_doghouse_level = 1 then
        return query select false, '狗屋容量不足，请先购买「温馨狗屋」', v_star, v_coin, null::uuid, 0;
      elsif v_doghouse_level = 2 then
        return query select false, '狗屋容量不足，请先购买「豪华狗屋」', v_star, v_coin, null::uuid, 0;
      else
        return query select false, '狗屋容量已满', v_star, v_coin, null::uuid, 0;
      end if;
      return;
    end if;
  end if;

  v_star := v_star - coalesce(v_item.price_star, 0);
  update public.members set star_value = v_star, updated_at = now() where public.members.id = p_member_id;

  if v_item.type = 'pet' then
    insert into public.pets (
      family_id, member_id, shop_item_id, name, emoji, image_url, gender,
      base_coin_per_day, upgrade_coin_reward, coin_balance,
      max_level, current_max_blood, daily_decay_base, upgrade_percent,
      evolved_bonus, exp, rarity
    )
    values (
      v_family_id, p_member_id, v_item.id, '新宠物', v_item.emoji, v_item.image_url, v_item.gender,
      coalesce(v_item.base_coin_per_day, 2), coalesce(v_item.upgrade_coin_reward, 5), 0,
      coalesce(v_item.max_level, 3), coalesce(v_item.max_blood_bar, 100),
      coalesce(v_item.daily_decay_base, 5), coalesce(v_item.upgrade_percent, 5.0),
      0.0, 0, coalesce(v_item.rarity, 'common')
    )
    returning id into v_pet_id;
    return query select true, '购买成功！请给宠物取个名字', v_star, v_coin, v_pet_id, 0;
  else
    insert into public.pet_inventory (family_id, member_id, item_id, item_name_snapshot, item_emoji, item_image_url, subcategory, quantity)
    values (v_family_id, p_member_id, p_item_id, coalesce(v_item.name, '用品'), v_item.emoji, v_item.image_url, v_item.subcategory, 1)
    on conflict (member_id, item_id) do update set quantity = pet_inventory.quantity + 1
    returning quantity into v_inv_qty;
    return query select true, '已购买并存入背包', v_star, v_coin, null::uuid, v_inv_qty;
  end if;
end;
$$;

-- ============================================================
-- 权限
-- ============================================================
grant execute on function public.gacha_start(uuid) to anon, authenticated;
grant execute on function public.buy_pet_item(uuid, uuid) to anon, authenticated;
