-- 0135: 抽卡板块后台配置优化
-- 1) 新建 gacha_config 单行表（全局配置：领养扣费/放弃扣费/三稀有度概率）
-- 2) 重写 gacha_start：按稀有度权重加权随机抽取（每只宠物权重=其稀有度对应概率），保留过滤已拥有宠物逻辑
-- 3) 重写 gacha_adopt / gacha_cancel：扣费值改读配置
-- 4) 新增 get_gacha_config / update_gacha_config RPC

-- ============================================================
-- 一、新建 gacha_config 表（全局单行配置）
-- ============================================================
CREATE TABLE IF NOT EXISTS public.gacha_config (
  id smallint primary key default 1 check (id = 1),
  adopt_cost int not null default 150,                       -- 领养抽中宠物扣除的星光值
  cancel_penalty int not null default 45,                    -- 放弃抽卡扣除的星光值
  rarity_common_prob numeric(5,2) not null default 70.00,    -- 普通概率(%)
  rarity_rare_prob   numeric(5,2) not null default 25.00,    -- 稀有概率(%)
  rarity_epic_prob   numeric(5,2) not null default 5.00,     -- 史诗概率(%)
  updated_at timestamptz not null default now(),
  constraint gacha_prob_sum check (
    rarity_common_prob + rarity_rare_prob + rarity_epic_prob = 100.00
  )
);

INSERT INTO public.gacha_config (id) VALUES (1)
  ON CONFLICT (id) DO NOTHING;

GRANT SELECT ON public.gacha_config TO anon, authenticated;

-- ============================================================
-- 二、重写 gacha_start：不扣星光，按稀有度权重加权随机抽一只未拥有的宠物
-- 加权随机算法用 Gumbel-max trick：ORDER BY -log(random()) / weight
-- 每只宠物权重 = 其稀有度对应概率（common/rare/epic）
-- ============================================================
DROP FUNCTION IF EXISTS public.gacha_start(uuid);
CREATE FUNCTION public.gacha_start(p_member_id uuid)
RETURNS TABLE(
  success boolean,
  message text,
  drawn_item_id uuid,
  drawn_item_name text,
  drawn_item_emoji text,
  drawn_item_image text,
  remaining_star int
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
declare
  v_member record;
  v_cfg public.gacha_config%rowtype;
  v_picked record;
begin
  select * into v_member from public.members where id = p_member_id for update;
  if not found then
    return query select false, '用户不存在', null::uuid, null::text, null::text, null::text, 0;
    return;
  end if;

  select * into v_cfg from public.gacha_config where id = 1;

  -- 需至少 adopt_cost 星光才能参与（领养需要）
  if v_member.star_value < v_cfg.adopt_cost then
    return query select false, '星光值不足，需要'||v_cfg.adopt_cost||'星光值才能抽卡',
      null::uuid, null::text, null::text, null::text, v_member.star_value;
    return;
  end if;

  -- 加权随机抽取一只未拥有的宠物（Gumbel-max trick）
  select psi.id, psi.name, psi.emoji, psi.image_url into v_picked
  from public.pet_shop_items psi
  cross join lateral (
    select case psi.rarity
      when 'common' then v_cfg.rarity_common_prob
      when 'rare'   then v_cfg.rarity_rare_prob
      when 'epic'   then v_cfg.rarity_epic_prob
      else v_cfg.rarity_common_prob
    end as weight
  ) w
  where psi.type = 'pet'
    and psi.status = 'active'
    and psi.price_star > 0
    and w.weight > 0
    and psi.id not in (
      select coalesce(shop_item_id, '00000000-0000-0000-0000-000000000000'::uuid)
      from public.pets where member_id = p_member_id
    )
  order by -log(random()) / w.weight
  limit 1;

  if v_picked.id is null then
    return query select false, '暂无可抽的宠物（已全部拥有或概率为0）',
      null::uuid, null::text, null::text, null::text, v_member.star_value;
    return;
  end if;

  return query select true, '抽卡成功',
    v_picked.id, v_picked.name, v_picked.emoji, v_picked.image_url, v_member.star_value;
end;
$$;

GRANT EXECUTE ON FUNCTION public.gacha_start(uuid) TO anon, authenticated;

-- ============================================================
-- 三、重写 gacha_adopt：领养扣费改读配置（adopt_cost）
-- ============================================================
DROP FUNCTION IF EXISTS public.gacha_adopt(uuid, uuid);
CREATE FUNCTION public.gacha_adopt(p_member_id uuid, p_shop_item_id uuid)
RETURNS TABLE(success boolean, message text, pet_id uuid, remaining_star int)
LANGUAGE plpgsql SECURITY DEFINER AS $$
declare
  v_member record;
  v_item record;
  v_pet_id uuid;
  v_star int;
  v_existing_pet_id uuid;
  v_doghouse_level int;
  v_current_pet_count int;
  v_capacity int;
  v_cfg public.gacha_config%rowtype;
begin
  select * into v_cfg from public.gacha_config where id = 1;

  select * into v_member from public.members where id = p_member_id for update;
  if not found then
    return query select false, '用户不存在', null::uuid, 0;
    return;
  end if;

  select * into v_item from public.pet_shop_items where id = p_shop_item_id and status = 'active';
  if not found then
    return query select false, '宠物不存在或已下架', null::uuid, v_member.star_value;
    return;
  end if;

  -- 检查是否已拥有
  select id into v_existing_pet_id from public.pets
    where member_id = p_member_id and shop_item_id = p_shop_item_id limit 1;
  if found then
    return query select false, '已拥有该宠物', null::uuid, v_member.star_value;
    return;
  end if;

  -- 容量检查
  select level into v_doghouse_level from public.dog_house where member_id = p_member_id limit 1;
  v_doghouse_level := coalesce(v_doghouse_level, 0);
  select count(*) into v_current_pet_count from public.pets where member_id = p_member_id;
  v_capacity := case v_doghouse_level
    when 0 then 0 when 1 then 1 when 2 then 5 when 3 then 10 else 10
  end;

  if v_current_pet_count >= v_capacity then
    if v_doghouse_level = 0 then
      return query select false, '需要先购买「茅草小屋」，解锁更多饲养位', null::uuid, v_member.star_value;
    elsif v_doghouse_level = 1 then
      return query select false, '需要先购买「温馨小屋」，解锁更多饲养位', null::uuid, v_member.star_value;
    elsif v_doghouse_level = 2 then
      return query select false, '需要先购买「豪华小屋」，解锁更多饲养位', null::uuid, v_member.star_value;
    else
      return query select false, '饲养位已满', null::uuid, v_member.star_value;
    end if;
    return;
  end if;

  -- 扣 adopt_cost 星光（从配置读取）
  if v_member.star_value < v_cfg.adopt_cost then
    return query select false, '星光值不足，需要'||v_cfg.adopt_cost||'星光值领养', null::uuid, v_member.star_value;
    return;
  end if;

  v_star := v_member.star_value - v_cfg.adopt_cost;
  update public.members set star_value = v_star, updated_at = now() where id = p_member_id;

  insert into public.pets (
    family_id, member_id, shop_item_id, name, emoji, image_url, gender,
    base_coin_per_day, upgrade_coin_reward, coin_balance,
    max_level, current_max_blood, daily_decay_base, upgrade_percent, evolved_bonus, exp
  )
  values (
    v_member.family_id, p_member_id, v_item.id, '新宠物', v_item.emoji, v_item.image_url, v_item.gender,
    coalesce(v_item.base_coin_per_day, 2), coalesce(v_item.upgrade_coin_reward, 5), 0,
    coalesce(v_item.max_level, 3), coalesce(v_item.max_blood_bar, 100),
    coalesce(v_item.daily_decay_base, 5), coalesce(v_item.upgrade_percent, 5.0), 0.0, 0
  )
  returning id into v_pet_id;

  return query select true, '领养成功', v_pet_id, v_star;
end;
$$;

GRANT EXECUTE ON FUNCTION public.gacha_adopt(uuid, uuid) TO anon, authenticated;

-- ============================================================
-- 四、重写 gacha_cancel：放弃扣费改读配置（cancel_penalty）
-- ============================================================
DROP FUNCTION IF EXISTS public.gacha_cancel(uuid);
CREATE FUNCTION public.gacha_cancel(p_member_id uuid)
RETURNS TABLE(success boolean, message text, remaining_star int)
LANGUAGE plpgsql SECURITY DEFINER AS $$
declare
  v_star int;
  v_cfg public.gacha_config%rowtype;
begin
  select * into v_cfg from public.gacha_config where id = 1;

  update public.members
    set star_value = greatest(0, star_value - v_cfg.cancel_penalty), updated_at = now()
    where id = p_member_id
    returning star_value into v_star;

  return query select true, '放弃抽卡，扣除'||v_cfg.cancel_penalty||'星光值', v_star;
end;
$$;

GRANT EXECUTE ON FUNCTION public.gacha_cancel(uuid) TO anon, authenticated;

-- ============================================================
-- 五、新增配置读写 RPC
-- ============================================================

-- 读配置（anon/authenticated 都可读，前端抽卡弹窗要显示数字）
CREATE OR REPLACE FUNCTION public.get_gacha_config()
RETURNS TABLE(
  adopt_cost int,
  cancel_penalty int,
  rarity_common_prob numeric,
  rarity_rare_prob numeric,
  rarity_epic_prob numeric
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
begin
  return query select adopt_cost, cancel_penalty,
    rarity_common_prob, rarity_rare_prob, rarity_epic_prob
    from public.gacha_config where id = 1;
end;
$$;
GRANT EXECUTE ON FUNCTION public.get_gacha_config() TO anon, authenticated;

-- 写配置（仅 authenticated 可调；前端 parent 登录态即可）
CREATE OR REPLACE FUNCTION public.update_gacha_config(
  p_adopt_cost int,
  p_cancel_penalty int,
  p_common numeric,
  p_rare numeric,
  p_epic numeric
)
RETURNS TABLE(success boolean, message text)
LANGUAGE plpgsql SECURITY DEFINER AS $$
begin
  if p_adopt_cost < 0 or p_cancel_penalty < 0 then
    return query select false, '扣费值不能为负';
    return;
  end if;
  if coalesce(p_common, 0) + coalesce(p_rare, 0) + coalesce(p_epic, 0) <> 100 then
    return query select false, '三个稀有度概率之和必须为100';
    return;
  end if;

  update public.gacha_config
    set adopt_cost = p_adopt_cost,
        cancel_penalty = p_cancel_penalty,
        rarity_common_prob = p_common,
        rarity_rare_prob = p_rare,
        rarity_epic_prob = p_epic,
        updated_at = now()
    where id = 1;

  return query select true, '保存成功';
end;
$$;
GRANT EXECUTE ON FUNCTION public.update_gacha_config(int, int, numeric, numeric, numeric) TO authenticated;
