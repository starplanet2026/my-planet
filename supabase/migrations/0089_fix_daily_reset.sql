-- 0089: 修复每日0点清零逻辑
-- 问题：check_pet 中 extract(day from interval) 只取"天"分量，不到24小时不算1天
-- 修复：改用日历日期比较 (current_date - last_check_at::date)，过0点即算1天

create or replace function public.check_pet(p_pet_id uuid)
returns setof public.pets
language plpgsql security definer as $$
declare
  v_pet record;
  v_days int;
  v_i int;
  v_check_date date;
  v_hunger_mult numeric;
  v_clean_mult numeric;
  v_daily_decay int;
  v_fed boolean;
  v_cleaned boolean;
  v_cared boolean;
  v_sick boolean;
begin
  select * into v_pet from public.pets where public.pets.id = p_pet_id for update;
  if not found then return; end if;

  -- 改用日历日期比较：过0点即算1天
  v_days := (current_date - coalesce(v_pet.last_check_at::date, current_date - 1))::int;

  if v_days >= 1 then
    v_hunger_mult := public.trait_hunger_multiplier(coalesce(v_pet.trait, '平平无奇'));
    v_clean_mult := public.trait_clean_multiplier(coalesce(v_pet.trait, '平平无奇'));

    for v_i in 1..v_days loop
      v_check_date := (current_date - (v_days - v_i + 1))::date;

      -- 当日是否照料过
      v_fed := coalesce(v_pet.last_feed_date, '2000-01-01'::date) >= v_check_date;
      v_cleaned := coalesce(v_pet.last_clean_date, '2000-01-01'::date) >= v_check_date;
      v_cared := coalesce(v_pet.last_care_date, '2000-01-01'::date) >= v_check_date;

      -- 体力/清洁衰减（基准100）
      v_daily_decay := round(100 * v_hunger_mult)::int;
      v_pet.hunger := greatest(0, coalesce(v_pet.hunger, 0) - v_daily_decay);

      v_daily_decay := round(100 * v_clean_mult)::int;
      v_pet.clean := greatest(0, coalesce(v_pet.clean, 0) - v_daily_decay);

      -- 心情每日归零
      v_pet.happiness := 0;
      v_pet.happiness_rounds := 0;

      -- 连续未照料天数
      if v_fed then
        v_pet.days_without_feed := 0;
      else
        v_pet.days_without_feed := coalesce(v_pet.days_without_feed, 0) + 1;
      end if;

      if v_cleaned then
        v_pet.days_without_clean := 0;
      else
        v_pet.days_without_clean := coalesce(v_pet.days_without_clean, 0) + 1;
      end if;

      if v_cared then
        v_pet.days_without_care := 0;
      else
        v_pet.days_without_care := coalesce(v_pet.days_without_care, 0) + 1;
      end if;

      -- 疾病判定
      if v_pet.days_without_feed >= 3 then
        v_pet.has_stomach_issue := true;
      end if;
      if v_pet.days_without_clean >= 3 then
        v_pet.has_skin_issue := true;
      end if;
      if v_pet.days_without_care >= 7 then
        v_pet.has_severe_illness := true;
      end if;

      -- 疾病期间健康值下降
      v_sick := public.pet_is_sick(v_pet.has_stomach_issue, v_pet.has_skin_issue, v_pet.has_severe_illness);
      if v_sick then
        if v_pet.has_severe_illness then
          v_pet.health := greatest(0, coalesce(v_pet.health, 100) - 20);
        else
          v_pet.health := greatest(0, coalesce(v_pet.health, 100) - 10);
        end if;
      end if;
    end loop;

    v_sick := public.pet_is_sick(v_pet.has_stomach_issue, v_pet.has_skin_issue, v_pet.has_severe_illness);

    update public.pets set
      hunger = v_pet.hunger,
      clean = v_pet.clean,
      happiness = v_pet.happiness,
      health = v_pet.health,
      days_without_feed = v_pet.days_without_feed,
      days_without_clean = v_pet.days_without_clean,
      days_without_care = v_pet.days_without_care,
      has_stomach_issue = v_pet.has_stomach_issue,
      has_skin_issue = v_pet.has_skin_issue,
      has_severe_illness = v_pet.has_severe_illness,
      is_sick = v_sick,
      happiness_rounds = 0,
      last_check_at = now()
    where public.pets.id = p_pet_id;
  end if;

  return query select * from public.pets where public.pets.id = p_pet_id;
end;
$$;

grant execute on function public.check_pet(uuid) to anon, authenticated;
