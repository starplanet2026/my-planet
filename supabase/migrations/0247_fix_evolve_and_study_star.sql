-- 0247: 萌宠星球 - 修复 evolve_pet 历史遗留 bug + 进修每日星光调整 + 稀有度数据一致性矫正

-- ============================================================
-- 一、进修每日星光按稀有度调整：普通 5 / 稀有 20 / 史诗 50
-- ============================================================
create or replace function public.study_daily_star(p_rarity text)
returns int language sql immutable as $$
  select case p_rarity
    when 'common' then 5
    when 'rare' then 20
    when 'epic' then 50
    else 0
  end;
$$;
revoke all on function public.study_daily_star(text) from public;
grant execute on function public.study_daily_star(text) to anon, authenticated;

-- ============================================================
-- 二、evolve_pet 修复（两个历史遗留 bug）
--    bug1: 进化后 max_level 套用了旧经验体系(5/7)，与现行标准冲突
--          应为 common→rare = 20、rare→epic = 25
--    bug2: 当前稀有度从 pet_shop_items 读取；进化后宠物自身 rarity 与商品模板已不同，
--          必须改读 pets.rarity，否则进化后再次进化会判错分支
--    另补：进化后按新稀有度重算 exp_to_next，并清除 pending_levelup
--    进化价格不变：common→rare 150⭐，rare→epic 400⭐
-- ============================================================
drop function if exists public.evolve_pet(uuid, text);
create or replace function public.evolve_pet(
  p_pet_id uuid,
  p_target_rarity text
)
returns table(success boolean, message text, new_rarity text, new_max_level int, new_price_star int)
language plpgsql security definer as $$
declare
  v_pet record;
  v_member record;
  v_current_rarity text;
  v_target_rarity text := p_target_rarity;
  v_cost int;
  v_new_max_level int;
  v_new_base_coin numeric;
  v_new_upgrade_reward int;
  v_new_upgrade_percent numeric;
  v_new_max_blood int;
  v_new_decay int;
  v_family_id uuid;
  v_new_star int;
  v_new_exp_to_next int;
begin
  select * into v_pet from public.pets where public.pets.id = p_pet_id for update;
  if not found then
    return query select false, '宠物不存在', null::text, 0, 0;
    return;
  end if;

  select * into v_member from public.members where id = v_pet.member_id for update;
  if not found then
    return query select false, '用户不存在', null::text, 0, 0;
    return;
  end if;
  v_family_id := v_member.family_id;

  -- 当前稀有度以宠物自身为准（进化会改变 pets.rarity），兜底回退商品模板默认值
  v_current_rarity := coalesce(
    v_pet.rarity,
    (select rarity from public.pet_shop_items where id = v_pet.shop_item_id),
    'common'
  );

  if v_current_rarity = 'common' and v_target_rarity = 'rare' then
    v_cost := 150; v_new_max_level := 20;
    v_new_base_coin := 2 + random();
    v_new_upgrade_reward := 8 + floor(random() * 8);
    v_new_upgrade_percent := 8.0;
    v_new_max_blood := 100 + floor(random() * 21);
    v_new_decay := 5 + floor(random() * 3);
  elsif v_current_rarity = 'rare' and v_target_rarity = 'epic' then
    v_cost := 400; v_new_max_level := 25;
    v_new_base_coin := 3 + random();
    v_new_upgrade_reward := 15 + floor(random() * 16);
    v_new_upgrade_percent := 12.0;
    v_new_max_blood := 120 + floor(random() * 31);
    v_new_decay := 8 + floor(random() * 3);
  else
    return query select false, '无法从' || v_current_rarity || '进化到' || v_target_rarity, null::text, 0, 0;
    return;
  end if;

  if v_pet.level < v_pet.max_level then
    return query select false, '宠物需要满级才能进化', null::text, 0, 0;
    return;
  end if;

  if v_member.star_value < v_cost then
    return query select false, '星光值不足，需要' || v_cost, null::text, 0, 0;
    return;
  end if;

  v_new_star := v_member.star_value - v_cost;
  update public.members set star_value = v_new_star, updated_at = now() where id = v_pet.member_id;

  -- 星光消耗流水
  insert into public.coin_records (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by, balance_type)
  values (v_family_id, v_pet.member_id, -v_cost, v_new_star,
    '宠物「' || coalesce(v_pet.name, '') || '」进化为' || case when v_target_rarity = 'rare' then '稀有' else '史诗' end,
    'evolve', 'pet', p_pet_id, v_pet.member_id, 'star');

  -- 进化后按新稀有度重算下一级所需经验（未达新满级时）
  v_new_exp_to_next := case
    when v_pet.level < v_new_max_level then public.exp_needed(v_pet.level, v_target_rarity)
    else 0
  end;

  update public.pets set
    max_level = v_new_max_level,
    base_coin_per_day = v_new_base_coin,
    upgrade_coin_reward = v_new_upgrade_reward,
    upgrade_percent = v_new_upgrade_percent,
    current_max_blood = round(v_new_max_blood * 1.1)::int,
    daily_decay_base = v_new_decay,
    evolved_bonus = 10.0,
    rarity = v_target_rarity,
    exp_to_next = v_new_exp_to_next,
    pending_levelup = false
  where public.pets.id = p_pet_id;

  return query select true, '进化成功！等级保留，后续升级属性+10%', v_target_rarity, v_new_max_level, v_cost;
end;
$$;
revoke all on function public.evolve_pet(uuid, text) from public;
grant execute on function public.evolve_pet(uuid, text) to anon, authenticated;

-- ============================================================
-- 三、稀有度数据一致性矫正
--    校验结果：全库仅 1 处不一致
--      pets「普通升级测试」(e9b4c1b4-...) rarity='rare'，其商品模板 rarity='common'
--      且该商品 (e64f4b77-...) 仅被这 1 只宠物引用
--      该宠物因历史 evolve bug 停在 max_level=5（应为 rare 的 20）
--    处理：以宠物当前稀有度为基准对齐商品模板，并修正宠物 max_level / exp_to_next
-- ============================================================
update public.pet_shop_items
   set rarity = 'rare', max_level = 20
 where id = 'e64f4b77-ccdf-4173-979b-71c449e1b52f';

update public.pets
   set max_level = 20,
       exp_to_next = case when level < 20 then public.exp_needed(level, 'rare') else 0 end,
       pending_levelup = false
 where id = 'e9b4c1b4-dba0-4d69-869f-ad24f4d70e87';

-- 兜底：确保 max_level 与 rarity 匹配（无差异时为幂等空操作）
update public.pets set max_level = 10 where rarity = 'common' and coalesce(max_level, 0) <> 10;
update public.pets set max_level = 20 where rarity = 'rare'   and coalesce(max_level, 0) <> 20;
update public.pets set max_level = 25 where rarity = 'epic'   and coalesce(max_level, 0) <> 25;

notify pgrst, 'reload schema';
