-- 0116: 补齐 0115 前托管宠物缺失的经验值
-- 背景：0115 之前 run_daily_boarding_care 只补满属性和发金币，不发经验。
-- 本迁移为 pet_boarding 中已存在记录、但 pet_daily_exp_log 未记录对应 full count
-- 的宠物-日期，补齐 hunger/clean/mood 的 full count 并发放经验（规则与 0115 一致）。
-- 经验规则：
--   饱食度 未满->满：+10（hunger_full_count 上限 1）
--   清洁度 未满->满：+10（clean_full_count 上限 1）
--   心情   未满->满：+10（mood_full_count 上限 3）
--   每日经验上限 50

do $$
declare
  v_record record;
  v_pet record;
  v_log record;
  v_exp_gain int;
  v_new_exp int;
  v_exp_needed int;
  v_daily_total int;
begin
  -- 遍历所有托管记录，找出未补齐经验的宠物-日期
  for v_record in
    select distinct b.pet_id, b.board_date
    from public.pet_boarding b
    where not exists (
      select 1 from public.pet_daily_exp_log l
      where l.pet_id = b.pet_id
        and l.log_date = b.board_date
        and l.hunger_full_count >= 1
        and l.clean_full_count >= 1
        and l.mood_full_count >= 1
    )
    order by b.board_date
  loop
    -- 获取宠物信息
    select * into v_pet from public.pets where id = v_record.pet_id;
    if not found then continue; end if;

    -- 获取或创建当日经验日志
    select * into v_log from public.pet_daily_exp_log
      where pet_id = v_record.pet_id and log_date = v_record.board_date;
    if not found then
      insert into public.pet_daily_exp_log (pet_id, log_date)
        values (v_record.pet_id, v_record.board_date)
        on conflict (pet_id, log_date) do nothing;
      select * into v_log from public.pet_daily_exp_log
        where pet_id = v_record.pet_id and log_date = v_record.board_date;
    end if;

    -- 补齐缺失的 count（不超过各上限），并计算本次补发经验
    v_exp_gain := 0;

    if coalesce(v_log.hunger_full_count, 0) < 1 then
      update public.pet_daily_exp_log set hunger_full_count = 1
        where pet_id = v_record.pet_id and log_date = v_record.board_date;
      v_exp_gain := v_exp_gain + 10;
    end if;

    if coalesce(v_log.clean_full_count, 0) < 1 then
      update public.pet_daily_exp_log set clean_full_count = 1
        where pet_id = v_record.pet_id and log_date = v_record.board_date;
      v_exp_gain := v_exp_gain + 10;
    end if;

    if coalesce(v_log.mood_full_count, 0) < 3 then
      update public.pet_daily_exp_log set mood_full_count = 3
        where pet_id = v_record.pet_id and log_date = v_record.board_date;
      v_exp_gain := v_exp_gain + 10;
    end if;

    -- 重新读取日志，计算当日累计经验，超过 50 则不发（与 0115 规则一致）
    select * into v_log from public.pet_daily_exp_log
      where pet_id = v_record.pet_id and log_date = v_record.board_date;
    v_daily_total := coalesce(v_log.hunger_full_count, 0) * 10
      + coalesce(v_log.clean_full_count, 0) * 10
      + coalesce(v_log.mood_full_count, 0) * 10;
    if v_daily_total > 50 then
      v_exp_gain := 0;
    end if;

    -- 发放经验 + 升级判定
    if v_exp_gain > 0 then
      v_new_exp := coalesce(v_pet.exp, 0) + v_exp_gain;
      v_exp_needed := public.exp_needed(coalesce(v_pet.level, 1), coalesce(v_pet.rarity, 'common'));
      if v_new_exp >= v_exp_needed then
        update public.pets set
          exp = v_new_exp,
          pending_levelup = true
        where id = v_record.pet_id;
      else
        update public.pets set exp = v_new_exp where id = v_record.pet_id;
      end if;
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
