-- 0202: 重写托管函数
-- 删除托管时的属性重置（改为0点全局重置为准）
-- 经验/金币发放乘以特质倍率
-- 托管时间后置至北京时间1:00（需手动调整cron调度）

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
  v_stars_cost int := 100;
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
      if v_pet.sick then continue; end if;

      -- 读取特质配置
      select * into v_trait from public.pet_traits
        where id = v_pet.trait_id and is_active = true;
      if not found then
        select * into v_trait from public.pet_traits
          where name = '无特质' and is_active = true limit 1;
      end if;

      -- 星光值不足100：跳过
      if v_member.star_value < v_stars_cost then
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

      -- 扣除100星光值
      v_new_star := v_member.star_value - v_stars_cost;
      update public.members set star_value = v_new_star, updated_at = now()
      where id = v_member.id;
      v_member.star_value := v_new_star;

      insert into public.coin_records (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by, balance_type)
      values (v_member.family_id, v_member.id, -v_stars_cost, v_new_star,
        '萌宠托管消耗星光值', 'boarding', 'pet_boarding', v_pet.id, v_member.id, 'star');

      -- 不再重置属性（以0点全局重置为准）

      -- 发放经验值（乘特质倍率）
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

      -- 经验乘特质倍率
      v_exp_final := v_exp_gain * coalesce(v_trait.exp_multiplier, 1.0);
      v_exp_gain := round(v_exp_final)::int;

      if v_exp_gain > 0 then
        v_new_exp := coalesce(v_pet.exp, 0) + v_exp_gain;
        v_exp_needed := public.exp_needed(coalesce(v_pet.level, 1), coalesce(v_pet.rarity, 'common'));
        if v_new_exp >= v_exp_needed then
          update public.pets set exp = v_new_exp, pending_levelup = true where id = v_pet.id;
          perform public.add_pet_message(v_pet.member_id, v_pet.id, 'level_up',
            v_pet.name, v_pet.name || ' 升级了，可以去升级啦！');
        else
          update public.pets set exp = v_new_exp where id = v_pet.id;
        end if;
      end if;

      -- 今日产金（乘特质倍率）
      v_coin_gain := 0;
      if v_pet.last_coin_date is null or v_pet.last_coin_date < v_today then
        v_daily_coin := coalesce(v_pet.base_coin_per_day, 0)
          * (1.0 + coalesce(v_pet.upgrade_percent, 10.0) / 100.0 * (coalesce(v_pet.level, 1) - 1));
        -- 金币乘特质倍率
        v_coin_final := v_daily_coin * coalesce(v_trait.coin_multiplier, 1.0);
        update public.pets set
          coin_balance = coalesce(coin_balance, 0) + v_coin_final,
          last_coin_date = v_today
        where id = v_pet.id;
        perform public.add_pet_message(v_pet.member_id, v_pet.id, 'coin_harvest',
          v_pet.name, v_pet.name || ' 今日产金 ' || round(v_coin_final)::int || ' 金币');
        v_coin_gain := v_coin_final;
      end if;

      -- 记录托管日志（属性gain为0，不再重置）
      insert into public.pet_boarding (family_id, member_id, pet_id, board_date)
      values (v_pet.family_id, v_member.id, v_pet.id, v_today)
      on conflict do nothing;

      insert into public.pet_boarding_log
        (family_id, member_id, pet_id, board_date,
         hunger_gain, clean_gain, happiness_gain, exp_gain, coin_gain, stars_cost)
      values
        (v_pet.family_id, v_member.id, v_pet.id, v_today,
         0, 0, 0,  -- 不再重置属性，gain为0
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
