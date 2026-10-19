-- 0276:「我的本命宠」——保存测试结果 & 免费领养 RPC
-- 需求：
--   1) 每个子成员(member)一生仅能领养一次本命宠；领养前可无限次重新测试
--   2) 保存作答记录与人格编码（destiny_answers / destiny_type）
--   3) 免费领养：按 pet_shop_items 默认配置创建宠物（1级/属性默认/性别随机），沿用起名流程
--   4) 已拥有同款本命宠 → 折算等值星光值补偿（发 price_star 星光，不重复发宠）
--   5) 领养需占用狗屋饲养位（进修中宠物不计入）
-- 依赖：members 列（0275 已加）、pets 种族属性触发器（0258）、add_pet_message

-- ============================================================
-- 一、保存测试结果（领养前可反复覆盖）
-- ============================================================
create or replace function public.save_destiny_result(
  p_member_id uuid,
  p_answers jsonb,
  p_type text
) returns table(success boolean, message text)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_adopted timestamptz;
begin
  select m.destiny_adopted_at into v_adopted from public.members m where m.id = p_member_id;
  if not found then
    return query select false, '用户不存在';
    return;
  end if;
  if v_adopted is not null then
    return query select false, '本命宠已领取，无法重新测试';
    return;
  end if;
  update public.members
     set destiny_answers = p_answers,
         destiny_type = p_type,
         updated_at = now()
   where id = p_member_id;
  return query select true, '保存成功';
end;
$function$;

-- ============================================================
-- 二、免费领养本命宠
--   优先「已有同款 → 折算等值星光值补偿」，否则按默认配置建宠
--   免费（不扣星光），创建后沿用现有起名流程
-- ============================================================
create or replace function public.adopt_destiny_pet(
  p_member_id uuid,
  p_shop_item_id uuid
) returns table(success boolean, message text, pet_id uuid, compensated boolean, comp_star integer, new_star integer)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_item public.pet_shop_items%rowtype;
  v_member public.members%rowtype;
  v_family_id uuid;
  v_pet_id uuid := null;
  v_existing uuid;
  v_doghouse_level int;
  v_current_count int;
  v_capacity int;
  v_comp int := 0;
  v_star int;
  v_new_pet_msg text;
begin
  select * into v_item from public.pet_shop_items
    where public.pet_shop_items.id = p_shop_item_id and status = 'active';
  if not found then
    return query select false, '本命宠物不存在或已下架', null::uuid, false, 0, 0;
    return;
  end if;

  select * into v_member from public.members where public.members.id = p_member_id for update;
  if not found then
    return query select false, '用户不存在', null::uuid, false, 0, 0;
    return;
  end if;
  if v_member.destiny_adopted_at is not null then
    return query select false, '你已领取过本命宠啦', null::uuid, false, 0, v_member.star_value;
    return;
  end if;

  v_family_id := v_member.family_id;
  v_star := v_member.star_value;

  -- 已拥有同款：折算等值星光值补偿（不重复发宠）
  select p.id into v_existing from public.pets p
    where p.member_id = p_member_id and p.shop_item_id = p_shop_item_id limit 1;
  if found then
    v_comp := coalesce(v_item.price_star, 0);
    v_star := v_star + v_comp;
    update public.members
       set star_value = v_star,
           destiny_adopted_at = now(),
           updated_at = now()
     where id = p_member_id;
    insert into public.coin_records
      (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by, balance_type)
    values
      (v_family_id, p_member_id, v_comp, v_star,
       '本命宠已拥有，折算等值星光值补偿', 'system', 'destiny_pet', v_item.id, p_member_id, 'star');
    return query select true,
      '你已拥有本命宠「' || coalesce(v_item.breed, v_item.name, '') || '」，已折算 ' || v_comp || ' 星光值补偿',
      null::uuid, true, v_comp, v_star;
    return;
  end if;

  -- 狗屋饲养位校验（进修中宠物不计入容量）
  select level into v_doghouse_level from public.dog_house where member_id = p_member_id limit 1;
  v_doghouse_level := coalesce(v_doghouse_level, 0);
  select count(*) into v_current_count from public.pets
    where member_id = p_member_id and coalesce(is_studying, false) = false;
  v_capacity := case v_doghouse_level
    when 0 then 0 when 1 then 1 when 2 then 5 when 3 then 10 else 10
  end;
  if v_current_count >= v_capacity then
    if v_doghouse_level = 0 then
      return query select false, '请先购买「茅草屋」才能领养宠物', null::uuid, false, 0, v_star; return;
    elsif v_doghouse_level = 1 then
      return query select false, '狗屋容量不足，请先购买「温馨狗屋」', null::uuid, false, 0, v_star; return;
    elsif v_doghouse_level = 2 then
      return query select false, '狗屋容量不足，请先购买「豪华狗屋」', null::uuid, false, 0, v_star; return;
    else
      return query select false, '狗屋容量已满', null::uuid, false, 0, v_star; return;
    end if;
  end if;

  insert into public.pets (
    family_id, member_id, shop_item_id, name, emoji, image_url, gender, breed,
    base_coin_per_day, upgrade_coin_reward, coin_balance,
    max_level, current_max_blood, daily_decay_base, upgrade_percent, evolved_bonus, exp
  ) values (
    v_family_id, p_member_id, v_item.id, null, v_item.emoji, v_item.image_url,
    (case when random() < 0.5 then 'male' else 'female' end), v_item.breed,
    coalesce(v_item.base_coin_per_day, 2), coalesce(v_item.upgrade_coin_reward, 5), 0,
    coalesce(v_item.max_level, 3), coalesce(v_item.max_blood_bar, 100),
    coalesce(v_item.daily_decay_base, 5), coalesce(v_item.upgrade_percent, 5.0), 0.0, 0
  ) returning id into v_pet_id;

  if v_item.dialogue_new_pet is not null and length(trim(v_item.dialogue_new_pet)) > 0 then
    v_new_pet_msg := v_item.dialogue_new_pet;
  else
    v_new_pet_msg := '新宠物 ' || coalesce(v_item.breed, v_item.name, '新宠物') || ' 到家啦！';
  end if;
  perform public.add_pet_message(p_member_id, v_pet_id, 'new_pet',
    coalesce(v_item.breed, v_item.name, '新宠物'), v_new_pet_msg);

  update public.members
     set destiny_pet_id = v_pet_id,
         destiny_adopted_at = now(),
         updated_at = now()
   where id = p_member_id;

  return query select true, '领养成功！请给宠物取个名字', v_pet_id, false, 0, v_star;
end;
$function$;

notify pgrst, 'reload schema';
