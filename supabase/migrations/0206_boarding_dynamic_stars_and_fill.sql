-- 0206: 重写托管函数 - 动态星光扣费 + 属性补满
-- 删除固定100星光，改为按属性缺口÷5（向上取整）
-- 托管补满属性到100/100/300，记录实际补齐的缺口
-- 经验/金币继续乘以特质倍率

create or replace function public.run_daily_boarding_care(p_member_id uuid default null)
returns void
language plpgsql security definer as $$
declare
  v_member record;
  v_pet record;
  v_trait record;
  v_selected_ids uuid[];
  v_daily_coin numeric;
  v_today date := (now() at time zone 'Asia/Shanghai')::date;
  v_exp_gain int;
  v_mood_exp int;
  v_new_exp int;
  v_exp_needed int;
  v_log record;
  v_daily_total int;
  v_new_star int;
  v_coin_gain numeric := 0;
  v_exp_final numeric;
  v_coin_final numeric;
  -- 动态属性缺口 & 星光
  v_gap_hunger int;
  v_gap_clean int;
  v_gap_happiness int;
  v_total_gap int;
  v_stars_cost int;
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
    -- 幂等：今日已执行则跳过该会员
    if exists (
      select 1 from public.pet_boarding b
      where b.member_id = v_member.id and b.board_date = v_today
    ) then
      continue;
    end if;

    select array_agg(pet_id) into v_selected_ids
    from public.pet_boarding_selection
    where member_id = v_member.id and selected = true;

    if v_selected_ids is null or array_length(v_selected_ids, 1) = 0 then
      continue;
    end if;

    for v_pet in
      select p.*,
             public.pet_is_sick(p.has_stomach_issue, p.has_skin_issue, p.has_severe_illness) as sick
      from public.pets p
      where p.id = any(v_selected_ids)
    loop
      -- 生病宠物跳过
      if v_pet.sick then continue; end if;

      -- 读取特质配置
      select * into v_trait from public.pet_traits
        where id = v_pet.trait_id and is_active = true;
      if not found then
        select * into v_trait from public.pet_traits
          where name = '无特质' and is_active = true limit 1;
      end if;

      -- 步骤0：读取当前属性（0点全局重置+特质加成后的值），计算缺口
      v_gap_hunger    := greatest(0, 100 - coalesce(v_pet.hunger, 0));
      v_gap_clean     := greatest(0, 100 - coalesce(v_pet.clean, 0));
      v_gap_happiness := greatest(0, 300 - coalesce(v_pet.happiness, 0));
      v_total_gap     := v_gap_hunger + v_gap_clean + v_gap_happiness;
      v_stars_cost    := ceil(v_total_gap::numeric / 5.0)::int;

      -- 星光不足：跳过该宠物，不修改属性、不扣费、不发放
      if v_stars_cost > 0 and v_member.star_value < v_stars_cost then
        insert into public.pet_boarding_log
          (family_id, member_id, pet_id, board_date,
           hunger_gain, clean_gain, happiness_gain, exp_gain, coin_gain, stars_cost)
        values
          (v_pet.family_id, v_member.id, v_pet.id, v_today,
           0, 0, 0, 0, 0, 0)
        on conflict (member_id, pet_id, board_date) do nothing;

        insert into public.pet_boarding (family_id, member_id, pet_id, board_date)
        values (v_pet.family_id, v_member.id, v_pet.id, v_today)
        on conflict do nothing;

        continue;
      end if;

      -- 步骤1：扣除星光值（按缺口动态计算）
      if v_stars_cost > 0 then
        v_new_star := v_member.star_value - v_stars_cost;
        update public.members set star_value = v_new_star, updated_at = now()
        where id = v_member.id;
        v_member.star_value := v_new_star;

        insert into public.coin_records (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by, balance_type)
        values (v_member.family_id, v_member.id, -v_stars_cost, v_new_star,
          '萌宠托管消耗星光值，补满属性', 'boarding', 'pet_boarding', v_pet.id, v_member.id, 'star');
      end if;

      -- 步骤2：补齐属性至上限
      update public.pets set
        hunger = 100,
        clean = 100,
        happiness = 300,
        last_feed_date = v_today,
        last_clean_date = v_today,
        last_happiness_date = v_today,
        last_care_date = v_today,
        days_without_feed = 0,
        days_without_clean = 0,
        days_without_care = 0,
        last_check_at = now()
      where id = v_pet.id;

      -- 步骤3：发放经验值（基础上限50，乘特质倍率后不受限）
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
      if coalesce(v_log.hunger_full_count, 0) < 1 then
        update public.pet_daily_exp_log set hunger_full_count = 1
          where pet_id = v_pet.id and log_date = v_today;
        v_exp_gain := v_exp_gain + 10;
      end if;
      if coalesce(v_log.clean_full_count, 0) < 1 then
        update public.pet_daily_exp_log set clean_full_count = 1
          where pet_id = v_pet.id and log_date = v_today;
        v_exp_gain := v_exp_gain + 10;
      end if;
      if coalesce(v_log.mood_full_count, 0) < 3 then
        v_mood_exp := (3 - coalesce(v_log.mood_full_count, 0)) * 10;
        update public.pet_daily_exp_log set mood_full_count = 3
          where pet_id = v_pet.id and log_date = v_today;
        v_exp_gain := v_exp_gain + v_mood_exp;
      end if;

      select * into v_log from public.pet_daily_exp_log
        where pet_id = v_pet.id and log_date = v_today;
      v_daily_total := coalesce(v_log.hunger_full_count, 0) * 10
        + coalesce(v_log.clean_full_count, 0) * 10
        + coalesce(v_log.mood_full_count, 0) * 10;
      if v_daily_total > 50 then
        v_exp_gain := 0;
      end if;

      -- 经验乘特质倍率（最终经验不受50限制）
      v_exp_final := v_exp_gain * coalesce(v_trait.exp_multiplier, 1.0);
      v_exp_gain := round(v_exp_final)::int;

      if v_exp_gain > 0 then
        v_new_exp := coalesce(v_pet.exp, 0) + v_exp_gain;
        v_exp_needed := public.exp_needed(coalesce(v_pet.level, 1), coalesce(v_pet.rarity, 'common'));
        if v_new_exp >= v_exp_needed then
          update public.pets set exp = v_new_exp, pending_levelup = true where id = v_pet.id;
          perform public.add_pet_message(v_pet.member_id, v_pet.id, 'level_up',
            coalesce(v_pet.breed, v_pet.name, '宠物'),
            coalesce(v_pet.breed, v_pet.name, '宠物') || ' 升级了，可以去升级啦！');
        else
          update public.pets set exp = v_new_exp where id = v_pet.id;
        end if;
      end if;

      -- 步骤4：发放今日金币（乘特质倍率）
      v_coin_gain := 0;
      if v_pet.last_coin_date is null or v_pet.last_coin_date < v_today then
        v_daily_coin := coalesce(v_pet.base_coin_per_day, 0)
          * (1.0 + coalesce(v_pet.upgrade_percent, 10.0) / 100.0 * (coalesce(v_pet.level, 1) - 1));
        v_coin_final := v_daily_coin * coalesce(v_trait.coin_multiplier, 1.0);
        update public.pets set
          coin_balance = coalesce(coin_balance, 0) + v_coin_final,
          last_coin_date = v_today
        where id = v_pet.id;
        perform public.add_pet_message(v_pet.member_id, v_pet.id, 'coin_harvest',
          coalesce(v_pet.breed, v_pet.name, '宠物'),
          coalesce(v_pet.breed, v_pet.name, '宠物') || ' 今日产金 ' || round(v_coin_final)::int || ' 金币');
        v_coin_gain := v_coin_final;
      end if;

      -- 步骤5：写入托管日志（记录实际补齐的缺口 + 消耗星光）
      insert into public.pet_boarding (family_id, member_id, pet_id, board_date)
      values (v_pet.family_id, v_member.id, v_pet.id, v_today)
      on conflict do nothing;

      insert into public.pet_boarding_log
        (family_id, member_id, pet_id, board_date,
         hunger_gain, clean_gain, happiness_gain, exp_gain, coin_gain, stars_cost)
      values
        (v_pet.family_id, v_member.id, v_pet.id, v_today,
         v_gap_hunger, v_gap_clean, v_gap_happiness,
         v_exp_gain,
         v_coin_gain,
         v_stars_cost)
      on conflict (member_id, pet_id, board_date) do nothing;
    end loop;
  end loop;
end;
$$;
revoke all on function public.run_daily_boarding_care(uuid) from public;
grant execute on function public.run_daily_boarding_care(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
