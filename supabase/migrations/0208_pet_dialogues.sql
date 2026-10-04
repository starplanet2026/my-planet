-- 0208: 宠物定制会话内容
-- 在 pet_shop_items 增加 5 个对话列（新到家 / 低状态 / 中状态 / 高状态 / 陪伴学习）
-- 这些列仅在宠物被领养后通过 RPC 读取，不在商店/图鉴卡片展示
-- 新增 get_pet_greeting(pet_id)：根据宠物当前状态返回对应对话
-- 修改 buy_pet_item：新宠物到家消息使用 dialogue_new_pet

-- ============================================================
-- 一、pet_shop_items 增加 5 个对话列
-- ============================================================
alter table public.pet_shop_items
  add column if not exists dialogue_new_pet text,
  add column if not exists dialogue_low_stats text,
  add column if not exists dialogue_medium_stats text,
  add column if not exists dialogue_high_stats text,
  add column if not exists dialogue_study text;

comment on column public.pet_shop_items.dialogue_new_pet is '新宠物到家时的欢迎语';
comment on column public.pet_shop_items.dialogue_low_stats is '宠物状态值偏低（最低项<=50）时的对话';
comment on column public.pet_shop_items.dialogue_medium_stats is '宠物状态值中等（最低项51-90）时的对话';
comment on column public.pet_shop_items.dialogue_high_stats is '宠物状态值良好（最低项>=91）时的对话';
comment on column public.pet_shop_items.dialogue_study is '陪伴学习时的鼓励语';

-- ============================================================
-- 二、get_pet_greeting：根据宠物状态返回对应对话
-- 判定规则：取 hunger/clean/health 和 happiness/3（归一化到0-100）的最小值
--   <=50  → low_stats
--   51-90 → medium_stats
--   >=91  → high_stats
-- 若对话列为空，返回通用默认文案
-- ============================================================
create or replace function public.get_pet_greeting(p_pet_id uuid)
returns table(scenario text, dialogue text)
language plpgsql security definer as $$
declare
  v_pet record;
  v_lowest int;
  v_scenario text;
  v_dialogue text;
  v_dialogue_col text;
begin
  select p.*, psi.dialogue_low_stats, psi.dialogue_medium_stats, psi.dialogue_high_stats
    into v_pet
  from public.pets p
  left join public.pet_shop_items psi on psi.id = p.shop_item_id
  where p.id = p_pet_id;

  if not found then
    return query select 'none'::text, ''::text;
    return;
  end if;

  -- 归一化：happiness 上限 300，除以 3 映射到 0-100
  v_lowest := least(
    coalesce(v_pet.hunger, 0),
    coalesce(v_pet.clean, 0),
    coalesce(v_pet.health, 0),
    coalesce(v_pet.happiness, 0) / 3
  );

  if v_lowest <= 50 then
    v_scenario := 'low_stats';
    v_dialogue := v_pet.dialogue_low_stats;
  elsif v_lowest <= 90 then
    v_scenario := 'medium_stats';
    v_dialogue := v_pet.dialogue_medium_stats;
  else
    v_scenario := 'high_stats';
    v_dialogue := v_pet.dialogue_high_stats;
  end if;

  -- 空值兜底：返回通用文案
  if v_dialogue is null or length(trim(v_dialogue)) = 0 then
    v_dialogue := case v_scenario
      when 'low_stats' then '我有点不舒服，能帮我照顾一下吗？'
      when 'medium_stats' then '今天过得还不错，谢谢你的陪伴！'
      when 'high_stats' then '我现在状态超好，感觉能跑十圈！'
      else '你好呀，很高兴见到你！'
    end;
  end if;

  return query select v_scenario, v_dialogue;
end;
$$;
grant execute on function public.get_pet_greeting(uuid) to anon, authenticated;

-- ============================================================
-- 三、修改 buy_pet_item：新宠物到家消息使用 dialogue_new_pet
-- 基于 0170 版本重写，仅改动 new_pet 消息部分
-- ============================================================
drop function if exists public.buy_pet_item(uuid, uuid);
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
  v_doghouse_level int;
  v_current_pet_count int;
  v_capacity int;
  v_new_pet_msg text;
begin
  select * into v_item from public.pet_shop_items where public.pet_shop_items.id = p_item_id and status = 'active';
  if not found then return query select false, '商品不存在或已下架', 0, 0, null::uuid, 0; return; end if;

  select * into v_member from public.members where public.members.id = p_member_id for update;
  v_family_id := v_member.family_id;
  v_star := v_member.star_value;
  v_coin := v_member.coin_balance;

  if v_star < v_item.price_star then
    return query select false, '星光值不足', v_star, v_coin, null::uuid, 0; return;
  end if;

  if v_item.subcategory = 'doghouse' then
    return query select false, '请使用狗屋升级功能', v_star, v_coin, null::uuid, 0; return;
  end if;

  if v_item.type = 'pet' then
    select id into v_existing_pet_id from public.pets
    where member_id = p_member_id and shop_item_id = p_item_id limit 1;
    if found then
      return query select false, '已领养该宠物，不可重复购买', v_star, v_coin, null::uuid, 0; return;
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
        return query select false, '请先购买「茅草屋」才能领养宠物', v_star, v_coin, null::uuid, 0; return;
      elsif v_doghouse_level = 1 then
        return query select false, '狗屋容量不足，请先购买「温馨狗屋」', v_star, v_coin, null::uuid, 0; return;
      elsif v_doghouse_level = 2 then
        return query select false, '狗屋容量不足，请先购买「豪华狗屋」', v_star, v_coin, null::uuid, 0; return;
      else
        return query select false, '狗屋容量已满', v_star, v_coin, null::uuid, 0; return;
      end if;
    end if;
  end if;

  v_star := v_star - v_item.price_star;
  update public.members set star_value = v_star, updated_at = now() where public.members.id = p_member_id;

  insert into public.coin_records (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by, balance_type)
  values (v_family_id, p_member_id, -v_item.price_star, v_star,
    '购买' || case when v_item.type = 'pet' then '宠物' else '用品' end || '「' || coalesce(v_item.name, '') || '」',
    'purchase', 'pet_shop_item', p_item_id, p_member_id, 'star');

  if v_item.type = 'pet' then
    insert into public.pets (
      family_id, member_id, shop_item_id, name, emoji, image_url, gender,
      base_coin_per_day, upgrade_coin_reward, coin_balance,
      max_level, current_max_blood, daily_decay_base, upgrade_percent, evolved_bonus, exp,
      rarity
    )
    values (
      v_family_id, p_member_id, v_item.id, '新宠物', v_item.emoji, v_item.image_url, v_item.gender,
      v_item.base_coin_per_day, coalesce(v_item.upgrade_coin_reward, 5), 0,
      coalesce(v_item.max_level, 3), coalesce(v_item.max_blood_bar, 100),
      coalesce(v_item.daily_decay_base, 5), coalesce(v_item.upgrade_percent, 5.0), 0.0, 0,
      coalesce(v_item.rarity, 'common')
    )
    returning id into v_pet_id;

    -- 新宠物到家消息：优先使用 dialogue_new_pet，为空则用默认文案
    if v_item.dialogue_new_pet is not null and length(trim(v_item.dialogue_new_pet)) > 0 then
      v_new_pet_msg := v_item.dialogue_new_pet;
    else
      v_new_pet_msg := '新宠物 ' || coalesce(v_item.name, '新宠物') || ' 到家啦！';
    end if;

    perform public.add_pet_message(p_member_id, v_pet_id, 'new_pet',
      coalesce(v_item.name, '新宠物'), v_new_pet_msg);

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
grant execute on function public.buy_pet_item(uuid, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
