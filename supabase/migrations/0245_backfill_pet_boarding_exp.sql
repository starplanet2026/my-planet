-- 0245: 回溯修复【普通升级测试】托管经验丢失
-- ============================================================
-- 背景 / 根因：
--   用户「测试老用户保留」的普通宠物「普通升级测试」连续托管 19 天
--   （2026-09-26 ~ 2026-10-14），按每日上限 50 经验本应累计约 910~950，
--   可升到满级 Lv.10（普通宠物满级需累计 900）。
--
--   数据核查结论：
--     · pet_boarding_log 19 天记录的托管发放经验合计 860；
--     · pet_daily_exp_log 每日台账（饥饿+清洁+心情 满额计数）合计 910；
--     · 托管每日经验其实一直正确累计进 pets.exp，run_daily_boarding_care
--       对经验是「无上限累加」，pending_levelup=true 也继续累加。
--     · 但在 0222（升级溢出经验结转修复）上线前，complete_pet_levelup
--       升级后直接 exp=0，不保留溢出经验。该宠物在托管期间（9/29、10/6、
--       10/9、10/12 等）做过数次升级挑战，每一次只升 1 级却把超出本级
--       门槛的托管经验全部清零。延迟做挑战 → 大量托管经验被吞。
--     · 最终只剩累计 420（Lv.7 exp=0），丢失约 490 经验。
--       （旧升级消息已被 cleanup_old_records 的 30 天清理删除。）
--
-- 前向逻辑：
--   0222 的 complete_pet_levelup 已确认线上生效（v_carry_exp 保留溢出，
--   可连续升级），且 0224 统一经验表已生效。今后托管经验会持续累加，
--   无论何时做升级挑战都不会再丢失，本脚本无需再改函数逻辑。
--
-- 本脚本：
--   仅对指定测试宠物（id + 名称双重校验，防误伤），按每日经验台账重算
--   应得总经验，依据现行经验表重新定级。幂等，可重复执行结果一致。
-- ============================================================

do $$
declare
  v_pet_id uuid := 'e9b4c1b4-dba0-4d69-869f-ad24f4d70e87';
  v_pet record;
  v_total int;
  v_lvl int;
  v_exp int;
  v_need int;
  v_max int;
begin
  select * into v_pet from public.pets where id = v_pet_id;
  if not found then
    raise notice '宠物 % 不存在，跳过', v_pet_id;
    return;
  end if;

  -- 名称双重校验，避免 id 误用影响其他宠物
  if v_pet.name <> '普通升级测试' then
    raise notice '宠物名称不匹配（实际=%），终止回溯', v_pet.name;
    return;
  end if;

  -- 应得总经验：每日台账 (饥饿满10 + 清洁满10 + 心情每档10，每日封顶50)
  select coalesce(sum(
      (coalesce(hunger_full_count, 0)
       + coalesce(clean_full_count, 0)
       + coalesce(mood_full_count, 0)) * 10
    ), 0)
  into v_total
  from public.pet_daily_exp_log
  where pet_id = v_pet_id;

  v_max := coalesce(v_pet.max_level, 10);
  v_lvl := 1;
  v_exp := v_total;

  -- 按现行经验表逐级消耗定级
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
  where id = v_pet_id;

  raise notice '【普通升级测试】回溯完成：台账总经验=%，当前 Lv.%/exp=%（修正前 Lv.%/exp=%）',
    v_total, v_lvl, v_exp, v_pet.level, coalesce(v_pet.exp, 0);
end
$$;

notify pgrst, 'reload schema';
