-- 0115: 托管自动养护补充经验值发放
-- 每日0点托管补满属性（体力/清洁/心情）时，按与 interact_with_pet 一致的规则发放经验值
-- 规则：
--   饱食度 未满->满：+10经验（每日1次，hunger_full_count）
--   清洁度 未满->满：+10经验（每日1次，clean_full_count）
--   心情   未满->满：+10经验（每日3次，mood_full_count）
--   每日经验上限 50
--   exp >= exp_needed(level, rarity) 时 pending_levelup = true

create or replace function public.run_daily_boarding_care(p_member_id uuid default null)
returns void
language plpgsql security definer as $$
declare
  v_member record;
  v_pet record;
  v_selected_ids uuid[];
  v_total_gap int;
  v_stars_needed int;
  v_daily_coin numeric;
  v_today date := (now() at time zone 'Asia/Shanghai')::date;
  -- 经验相关变量
  v_old_hunger int;
  v_old_clean int;
  v_old_happiness int;
  v_exp_gain int;
  v_new_exp int;
  v_exp_needed int;
  v_log record;
  v_daily_total int;
begin
  for v_member in
    select m.id, m.family_id, m.star_value
    from public.members m
    where (p_member_id is null or m.id = p_member_id)
      and exists (
        select 1 from public.pet_boarding_cards c
        where c.member_id = m.id and c.end_date >= v_today
      )
  loop
    -- 今日已执行过托管则跳过（幂等）
    if exists (
      select 1 from public.pet_boarding b
      where b.member_id = v_member.id and b.board_date = v_today
    ) then
      continue;
    end if;

    -- 获取勾选托管的宠物
    select array_agg(pet_id) into v_selected_ids
    from public.pet_boarding_selection
    where member_id = v_member.id and selected = true;

    if v_selected_ids is null or array_length(v_selected_ids, 1) = 0 then
      continue;
    end if;

    -- 计算总属性缺口（排除生病宠物）
    v_total_gap := 0;
    for v_pet in
      select p.id, p.hunger, p.clean, p.happiness,
             public.pet_is_sick(p.has_stomach_issue, p.has_skin_issue, p.has_severe_illness) as sick
      from public.pets p
      where p.id = any(v_selected_ids)
    loop
      if v_pet.sick then continue; end if;
      v_total_gap := v_total_gap
        + greatest(0, 100 - coalesce(v_pet.hunger, 0))
        + greatest(0, 100 - coalesce(v_pet.clean, 0))
        + greatest(0, 100 - coalesce(v_pet.happiness, 0));
    end loop;

    v_stars_needed := ceil(coalesce(v_total_gap, 0)::numeric / 5.0)::int;

    -- 星光不足：本次不执行，保留托管资格
    if v_member.star_value < v_stars_needed then
      continue;
    end if;

    -- 扣减星光
    if v_stars_needed > 0 then
      update public.members set star_value = star_value - v_stars_needed, updated_at = now()
      where id = v_member.id;
    end if;

    -- 逐只补齐属性 + 发放经验值 + 发放每日金币 + 记录托管
    for v_pet in
      select p.*,
             public.pet_is_sick(p.has_stomach_issue, p.has_skin_issue, p.has_severe_illness) as sick
      from public.pets p
      where p.id = any(v_selected_ids)
    loop
      if v_pet.sick then continue; end if;

      -- 记录托管前的属性值（用于判断是否从未满到满）
      v_old_hunger := coalesce(v_pet.hunger, 0);
      v_old_clean := coalesce(v_pet.clean, 0);
      v_old_happiness := coalesce(v_pet.happiness, 0);

      -- 补齐三项属性
      update public.pets set
        hunger = 100,
        clean = 100,
        happiness = 100,
        last_feed_date = v_today,
        last_clean_date = v_today,
        last_happiness_date = v_today,
        last_care_date = v_today,
        days_without_feed = 0,
        days_without_clean = 0,
        days_without_care = 0
      where id = v_pet.id;

      -- ====== 经验值发放（与 interact_with_pet 规则一致） ======
      -- 获取/创建今日经验日志
      select * into v_log from public.pet_daily_exp_log
        where pet_id = v_pet.id and log_date = v_today;
      if not found then
        insert into public.pet_daily_exp_log (pet_id, log_date)
          values (v_pet.id, v_today)
          on conflict (pet_id, log_date) do nothing;
        select * into v_log from public.pet_daily_exp_log
          where pet_id = v_pet.id and log_date = v_today;
      end if;

      v_exp_gain := 0;

      -- 饱食度：未满 -> 满，+10经验（每日1次）
      if v_old_hunger < 100 and coalesce(v_log.hunger_full_count, 0) < 1 then
        update public.pet_daily_exp_log set hunger_full_count = hunger_full_count + 1
          where pet_id = v_pet.id and log_date = v_today;
        v_exp_gain := v_exp_gain + 10;
      end if;

      -- 清洁度：未满 -> 满，+10经验（每日1次）
      if v_old_clean < 100 and coalesce(v_log.clean_full_count, 0) < 1 then
        update public.pet_daily_exp_log set clean_full_count = clean_full_count + 1
          where pet_id = v_pet.id and log_date = v_today;
        v_exp_gain := v_exp_gain + 10;
      end if;

      -- 心情：未满 -> 满，+10经验（每日3次）
      if v_old_happiness < 100 and coalesce(v_log.mood_full_count, 0) < 3 then
        update public.pet_daily_exp_log set mood_full_count = mood_full_count + 1
          where pet_id = v_pet.id and log_date = v_today;
        v_exp_gain := v_exp_gain + 10;
      end if;

      -- 每日经验上限 50
      select * into v_log from public.pet_daily_exp_log
        where pet_id = v_pet.id and log_date = v_today;
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
          where id = v_pet.id;
        else
          update public.pets set exp = v_new_exp where id = v_pet.id;
        end if;
      end if;

      -- ====== 三项属性全部补满，发放该宠物每日金币 ======
      if v_pet.last_coin_date is null or v_pet.last_coin_date < v_today then
        v_daily_coin := coalesce(v_pet.base_coin_per_day, 0)
          * (1.0 + coalesce(v_pet.upgrade_percent, 10.0) / 100.0 * (coalesce(v_pet.level, 1) - 1));
        update public.pets set
          coin_balance = coalesce(coin_balance, 0) + v_daily_coin,
          last_coin_date = v_today
        where id = v_pet.id;
      end if;

      -- 记录托管
      insert into public.pet_boarding (family_id, member_id, pet_id, board_date)
      values (v_pet.family_id, v_member.id, v_pet.id, v_today)
      on conflict do nothing;
    end loop;
  end loop;
end;
$$;

grant execute on function public.run_daily_boarding_care(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
