-- 0246: 批量回溯修复托管经验丢失的其余宠物
-- ============================================================
-- 背景：与 0245 同根因 —— 0222（升级溢出经验结转）上线前，
--   complete_pet_levelup 升级时 exp=0 清零，吞掉超出本级门槛的托管经验。
--   0245 已修复「普通升级测试」（Lv7→Lv10），本脚本补齐审计发现的其余 4 只。
--
-- 审计口径：台账 = pet_daily_exp_log 每日 (饥饿满10+清洁满10+心情满档*10)，
--   与当前 (等级累计+exp) 对比，差额即丢失经验。按现行 exp_needed 表重算定级。
--
-- 受影响名单（审计时快照）：
--   屠图/racer        Lv.7/250 → 台账740 → Lv.9/20
--   测试-老用户保留/托管测试  Lv.6/60  → 台账390 → Lv.6/90
--   测试-老用户保留/升级测试  Lv.6/50  → 台账360 → Lv.6/60
--   新/11             Lv.2/10  → 台账50  → Lv.2/30
--
-- 说明：脚本按台账实时重算（非写死快照），id+名称双重校验防误伤，
--   幂等可重复执行。仅处理 level < max_level 且台账>当前累计的宠物。
-- ============================================================

do $$
declare
  v_targets uuid[] := array[
    (select id from public.pets where name = 'racer' and level = 7 limit 1),
    (select id from public.pets where name = '托管测试' and level = 6 limit 1),
    (select id from public.pets where name = '升级测试' and level = 6 limit 1),
    (select id from public.pets where name = '11' and level = 2 limit 1)
  ];
  v_id uuid;
  v_pet record;
  v_total int;
  v_lvl int;
  v_exp int;
  v_need int;
  v_max int;
  v_cur_cum int;
  v_i int;
begin
  foreach v_id in array v_targets loop
    if v_id is null then
      raise notice '目标宠物未找到，跳过';
      continue;
    end if;

    select * into v_pet from public.pets where id = v_id;
    if not found then
      raise notice '宠物 % 不存在，跳过', v_id;
      continue;
    end if;

    v_max := coalesce(v_pet.max_level, 10);

    -- 满级宠物无需处理
    if coalesce(v_pet.level, 1) >= v_max then
      raise notice '宠物 % (%) 已满级 Lv.%，跳过', v_pet.name, v_id, v_pet.level;
      continue;
    end if;

    -- 台账总经验
    select coalesce(sum(
        (coalesce(hunger_full_count, 0)
         + coalesce(clean_full_count, 0)
         + coalesce(mood_full_count, 0)) * 10
      ), 0)
    into v_total
    from public.pet_daily_exp_log
    where pet_id = v_id;

    -- 当前累计经验
    v_cur_cum := coalesce(v_pet.exp, 0);
    for v_i in 1 .. (coalesce(v_pet.level, 1) - 1) loop
      v_cur_cum := v_cur_cum + public.exp_needed(v_i, coalesce(v_pet.rarity, 'common'));
    end loop;

    if v_total <= v_cur_cum then
      raise notice '宠物 % 台账(%) <= 当前累计(%)，无丢失，跳过', v_pet.name, v_total, v_cur_cum;
      continue;
    end if;

    -- 按现行经验表逐级消耗定级
    v_lvl := 1;
    v_exp := v_total;
    while v_lvl < v_max loop
      v_need := public.exp_needed(v_lvl, coalesce(v_pet.rarity, 'common'));
      if v_exp >= v_need then
        v_exp := v_exp - v_need;
        v_lvl := v_lvl + 1;
      else
        exit;
      end if;
    end loop;

    if v_lvl >= v_max then
      v_exp := 0;
      v_need := 0;
    else
      v_need := public.exp_needed(v_lvl, coalesce(v_pet.rarity, 'common'));
    end if;

    update public.pets
    set level = v_lvl,
        exp = v_exp,
        exp_to_next = v_need,
        pending_levelup = (v_lvl < v_max and v_need > 0 and v_exp >= v_need)
    where id = v_id;

    raise notice '宠物 % (%) 回溯完成：台账=%，Lv.%/exp=% → Lv.%/exp=%',
      v_pet.name, v_id, v_total,
      v_pet.level, coalesce(v_pet.exp, 0), v_lvl, v_exp;
  end loop;
end
$$;

notify pgrst, 'reload schema';
