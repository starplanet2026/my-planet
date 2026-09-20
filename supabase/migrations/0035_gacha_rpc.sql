-- 0035: 抽卡与学习奖励 RPC
-- 1) gacha_draw_pet：消耗 500 星光值随机抽取一只宠物，重复则重抽最多 3 次
-- 2) study_reward：学习奖励，增加星光值
-- ============================================================

-- 1) gacha_draw_pet
drop function if exists public.gacha_draw_pet(uuid);

create or replace function public.gacha_draw_pet(
  p_member_id uuid
)
returns table(success boolean, message text, new_star int, pet_id uuid, item_name text, item_emoji text, item_image_url text)
language plpgsql security definer as $$
declare
  v_member public.members%rowtype;
  v_item public.pet_shop_items%rowtype;
  v_star int;
  v_family_id uuid;
  v_pet_id uuid := null;
  v_existing_pet_id uuid;
  v_doghouse_level int;
  v_current_pet_count int;
  v_capacity int;
  v_attempts int;
  v_found_unique boolean := false;
begin
  -- 锁定会员
  select * into v_member from public.members where id = p_member_id for update;
  if not found then
    return query select false, '会员不存在', 0, null::uuid, '', '', '';
    return;
  end if;

  v_family_id := v_member.family_id;
  v_star := v_member.star_value;

  -- 星光值校验（每次抽卡消耗 500）
  if v_star < 500 then
    return query select false, '星光值不足，需要 500 星光值', v_star, null::uuid, '', '', '';
    return;
  end if;

  -- 狗屋容量校验（与 buy_pet_item 一致：0=0, 1=1, 2=5, 3=10）
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
      return query select false, '请先购买「茅草屋」才能领养宠物', v_star, null::uuid, '', '', '';
    elsif v_doghouse_level = 1 then
      return query select false, '狗屋容量不足，请先购买「温馨狗屋」', v_star, null::uuid, '', '', '';
    elsif v_doghouse_level = 2 then
      return query select false, '狗屋容量不足，请先购买「豪华狗屋」', v_star, null::uuid, '', '', '';
    else
      return query select false, '狗屋容量已满', v_star, null::uuid, '', '', '';
    end if;
    return;
  end if;

  -- 随机抽宠物：重复则重抽，最多重抽 3 次（共 4 次尝试）
  for v_attempts in 1..4 loop
    select * into v_item from public.pet_shop_items
    where type = 'pet' and status = 'active'
    order by random() limit 1;

    if not found then
      return query select false, '没有可抽中的宠物商品', v_star, null::uuid, '', '', '';
      return;
    end if;

    -- 检查是否已拥有该宠物
    select id into v_existing_pet_id from public.pets
    where member_id = p_member_id and shop_item_id = v_item.id
    limit 1;

    if not found then
      v_found_unique := true;
      exit;
    end if;
  end loop;

  if not v_found_unique then
    return query select false, '已拥有所有可抽中的宠物', v_star, null::uuid, '', '', '';
    return;
  end if;

  -- 扣 500 星光值
  v_star := v_star - 500;
  update public.members set star_value = v_star, updated_at = now() where id = p_member_id;

  -- 创建宠物记录（字段与 buy_pet_item 一致，upgrade_coin_reward 固定为 0）
  insert into public.pets (family_id, member_id, shop_item_id, name, emoji, image_url, gender, base_coin_per_day, upgrade_coin_reward, coin_balance)
  values (v_family_id, p_member_id, v_item.id, '新宠物', v_item.emoji, v_item.image_url, v_item.gender, v_item.base_coin_per_day, 0, 0)
  returning id into v_pet_id;

  return query select true, '抽卡成功！获得「' || coalesce(v_item.name, '未知宠物') || '」', v_star, v_pet_id, coalesce(v_item.name, ''), coalesce(v_item.emoji, ''), coalesce(v_item.image_url, '');
end;
$$;

grant execute on function public.gacha_draw_pet(uuid) to anon, authenticated;


-- 2) study_reward
drop function if exists public.study_reward(uuid, int, int);

create or replace function public.study_reward(
  p_member_id uuid,
  p_minutes int,
  p_reward int
)
returns table(success boolean, message text, new_star int)
language plpgsql security definer as $$
declare
  v_star int;
begin
  -- 增加星光值
  update public.members
  set star_value = star_value + p_reward, updated_at = now()
  where id = p_member_id
  returning star_value into v_star;

  if not found then
    return query select false, '会员不存在', 0;
    return;
  end if;

  return query select true, '学习奖励已发放', v_star;
end;
$$;

grant execute on function public.study_reward(uuid, int, int) to anon, authenticated;
