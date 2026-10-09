-- 0224: 统一等级经验配置 + 全量宠物数据回溯
-- 1. 覆盖旧 exp_needed 函数，统一为不分稀有度的单一配置（附件 V2 表）
-- 2. 全量重算每只宠物的等级与当前经验，基于历史累计总经验 + 新经验表
-- 3. 修正 Racer 升级经验丢失（6级升7级前250经验被清零）

-- ============================================================
-- 一、替换 exp_needed 函数（统一配置，不分稀有度）
-- ============================================================
create or replace function public.exp_needed(p_level int, p_rarity text default 'common')
returns int as $$
begin
  return case
    when p_level < 1 then 20
    when p_level = 1 then 20
    when p_level = 2 then 40
    when p_level = 3 then 60
    when p_level = 4 then 80
    when p_level = 5 then 100
    when p_level = 6 then 120
    when p_level = 7 then 140
    when p_level = 8 then 160
    when p_level = 9 then 180
    when p_level = 10 then 200
    when p_level = 11 then 240
    when p_level = 12 then 280
    when p_level = 13 then 320
    when p_level = 14 then 360
    when p_level = 15 then 400
    when p_level = 16 then 440
    when p_level = 17 then 480
    when p_level = 18 then 520
    when p_level = 19 then 560
    when p_level = 20 then 600
    when p_level = 21 then 650
    when p_level = 22 then 700
    when p_level = 23 then 750
    when p_level = 24 then 800
    else 999999
  end;
end;
$$ language plpgsql immutable;

revoke all on function public.exp_needed(int, text) from public;
grant execute on function public.exp_needed(int, text) to anon, authenticated;

-- ============================================================
-- 二、全量宠物等级与经验回溯
-- 算法：
--   1. 用旧经验表(0078)计算每只宠物的历史累计总经验
--      old_total = old_cumulative[level] + current_exp
--   2. 对 Racer 额外补回升级丢失的250经验
--   3. 用新经验表重新计算等级与剩余经验
--   4. 更新 level, exp, exp_to_next, pending_levelup
-- ============================================================

do $$
declare
  v_pet record;
  v_member_name text;
  v_old_total int;
  v_new_level int;
  v_new_exp int;
  v_new_exp_to_next int;
  v_max_level int;
  v_old_cumulative int[] := array[
    0,     -- L1
    20,    -- L2
    60,    -- L3
    120,   -- L4
    200,   -- L5
    300,   -- L6
    420,   -- L7
    560,   -- L8
    720,   -- L9
    900,   -- L10
    1100,  -- L11
    1410,  -- L12
    1750,  -- L13
    2110,  -- L14
    2500,  -- L15
    2920,  -- L16
    3370,  -- L17
    3850,  -- L18
    4350,  -- L19
    4880,  -- L20
    5440,  -- L21
    6030,  -- L22
    6650,  -- L23
    7290,  -- L24
    7960   -- L25
  ];
  v_old_level int;
begin
  for v_pet in
    select p.*, m.name as member_name
    from public.pets p
    join public.members m on p.member_id = m.id
    where p.id is not null
  loop
    v_old_level := coalesce(v_pet.level, 1);
    v_max_level := coalesce(v_pet.max_level, 10);

    -- 1. 计算旧表累计总经验
    if v_old_level >= 1 and v_old_level <= 25 then
      v_old_total := v_old_cumulative[v_old_level] + coalesce(v_pet.exp, 0);
    else
      v_old_total := coalesce(v_pet.exp, 0);
    end if;

    -- 2. Racer 特殊修正：补回升级丢失的250经验
    --    屠图/图图 的宠物 Racer，6级升7级前250经验被清零
    v_member_name := v_pet.member_name;
    if v_pet.name = 'Racer' and (v_member_name = '屠图' or v_member_name = '图图') then
      -- 如果当前 exp=0 且 level=7，说明 bug 状态未被 0223 修复
      if v_old_level = 7 and coalesce(v_pet.exp, 0) = 0 then
        v_old_total := v_old_cumulative[6] + 250;  -- = 300 + 250 = 550
        raise notice 'Racer 修正：old_total 从 % 改为 %（补回250丢失经验）',
          v_old_cumulative[7], v_old_total;
      end if;
    end if;

    -- 3. 用新经验表重算等级与剩余经验
    v_new_level := 1;
    v_new_exp := v_old_total;
    <<level_loop>>
    while v_new_level < v_max_level loop
      declare
        v_needed int;
      begin
        v_needed := public.exp_needed(v_new_level, coalesce(v_pet.rarity, 'common'));
        if v_new_exp >= v_needed then
          v_new_exp := v_new_exp - v_needed;
          v_new_level := v_new_level + 1;
        else
          exit level_loop;
        end if;
      end;
    end loop level_loop;

    -- 到达满级则清零经验
    if v_new_level >= v_max_level then
      v_new_exp := 0;
      v_new_exp_to_next := 0;
    else
      v_new_exp_to_next := public.exp_needed(v_new_level, coalesce(v_pet.rarity, 'common'));
    end if;

    -- 4. 更新宠物记录
    update public.pets set
      level = v_new_level,
      exp = v_new_exp,
      exp_to_next = v_new_exp_to_next,
      pending_levelup = (v_new_level < v_max_level and v_new_exp >= v_new_exp_to_next and v_new_exp_to_next > 0),
      updated_at = now()
    where id = v_pet.id;

    raise notice '宠物 % (%): 旧 L% E% → 新 L% E% (total=%)',
      v_pet.name, v_member_name, v_old_level, coalesce(v_pet.exp, 0),
      v_new_level, v_new_exp, v_old_total;

  end loop;
end;
$$;

-- ============================================================
-- 三、确保 max_level 按稀有度正确（0196 已处理，兜底）
-- ============================================================
update public.pets set max_level = 10 where rarity = 'common' and coalesce(max_level, 0) <> 10;
update public.pets set max_level = 20 where rarity = 'rare' and coalesce(max_level, 0) <> 20;
update public.pets set max_level = 25 where rarity = 'epic' and coalesce(max_level, 0) <> 25;

notify pgrst, 'reload schema';
