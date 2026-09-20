-- 0036: 抽卡改为花一次钱抽3次
-- 每次 500 星光值，抽3只宠物

drop function if exists public.gacha_draw_3x(uuid);
drop function if exists public.gacha_draw_pet(uuid);

create or replace function public.gacha_draw_3x(p_member_id uuid)
returns table(
  success boolean,
  message text,
  results jsonb
)
language plpgsql
security definer
as $$
declare
  v_member members%rowtype;
  v_dog_house record;
  v_capacity int;
  v_current_count int;
  v_pet_items jsonb;
  v_item record;
  v_pet record;
  v_results jsonb := '[]'::jsonb;
  v_attempts int;
  v_found boolean;
  v_created int := 0;
begin
  -- 锁定 member 行
  select * into v_member from public.members where id = p_member_id for update;
  if not found then
    return query select false, '用户不存在', '[]'::jsonb;
    return;
  end if;

  -- 检查星光值
  if v_member.star_value < 500 then
    return query select false, '星光值不足，需要500星光值', '[]'::jsonb;
    return;
  end if;

  -- 检查狗屋容量
  select * into v_dog_house from dog_houses where member_id = p_member_id;
  if not found or v_dog_house.level = 0 then
    return query select false, '请先购买茅草屋', '[]'::jsonb;
    return;
  end if;
  v_capacity := case v_dog_house.level when 1 then 1 when 2 then 5 when 3 then 10 else 0 end;
  select count(*) into v_current_count from pets where member_id = p_member_id;
  if v_current_count + 3 > v_capacity then
    return query select false, '狗屋容量不足，当前' || v_current_count || '/' || v_capacity || '，无法再容纳3只', '[]'::jsonb;
    return;
  end if;

  -- 扣 500 星光值
  update public.members set star_value = star_value - 500 where id = p_member_id;

  -- 获取可用宠物商品
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', id, 'name', name, 'emoji', coalesce(emoji, ''), 'image_url', coalesce(image_url, ''),
      'price_star', price_star, 'base_coin_per_day', coalesce(base_coin_per_day, 0),
      'gender', coalesce(gender, 'male')
    )
  ), '[]'::jsonb)
  into v_pet_items
  from pet_shop_items
  where type = 'pet' and status = 'active';

  if jsonb_array_length(v_pet_items) = 0 then
    -- 退还星光值
    update public.members set star_value = star_value + 500 where id = p_member_id;
    return query select false, '暂无可抽取的宠物', '[]'::jsonb;
    return;
  end if;

  -- 抽3次
  for v_attempts in 1..3 loop
    declare
      v_idx int;
      v_total int;
      v_skip boolean;
      v_try int;
    begin
      v_total := jsonb_array_length(v_pet_items);
      v_found := false;

      for v_try in 1..4 loop
        v_idx := floor(random() * v_total)::int + 1;
        v_item := jsonb_extract(v_pet_items, v_idx - 1);

        -- 检查是否已拥有
        perform 1 from pets where member_id = p_member_id and shop_item_id = (v_item->>'id')::uuid;
        if not found then
          v_found := true;
          exit;
        end if;
      end loop;

      if not v_found then
        -- 全部重复，随机取一个
        v_idx := floor(random() * v_total)::int + 1;
        v_item := jsonb_extract(v_pet_items, v_idx - 1);
      end if;

      -- 创建宠物
      insert into pets (family_id, member_id, shop_item_id, name, emoji, image_url, gender, base_coin_per_day, upgrade_coin_reward, coin_balance)
      values (
        v_member.family_id,
        p_member_id,
        (v_item->>'id')::uuid,
        '新宠物',
        (v_item->>'emoji')::text,
        nullif(v_item->>'image_url', ''),
        (v_item->>'gender')::text,
        (v_item->>'base_coin_per_day')::int,
        0,
        0
      )
      returning * into v_pet;

      v_results := v_results || jsonb_build_object(
        'pet_id', v_pet.id,
        'item_name', v_item->>'name',
        'item_emoji', v_item->>'emoji',
        'item_image_url', v_item->>'image_url',
        'pet_name', '新宠物'
      );
      v_created := v_created + 1;
    end;
  end loop;

  return query select true, '抽卡成功', v_results;
end;
$$;

grant execute on function public.gacha_draw_3x(uuid) to anon, authenticated;
