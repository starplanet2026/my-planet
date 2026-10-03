-- 0194: 修复宠物生病变病时健康值应直接降至0
-- Bug: 触发生病时 health = 100-10 = 90，应为 0
-- 修复: 新触发生病 → health=0；已生病持续 → 维持0（不再每日衰减，反正已是0）
-- 治愈: heal/medical → health=100，清除生病标记（现有逻辑不变）

-- ============================================================
-- 一、重写 check_pet 函数：新生病时 health 直接置0
-- ============================================================
drop function if exists public.check_pet(uuid);

create function public.check_pet(p_pet_id uuid)
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
  v_was_sick boolean;  -- 记录触发前是否已生病
  v_all_zero boolean;
begin
  select * into v_pet from public.pets where public.pets.id = p_pet_id for update;
  if not found then return; end if;

  v_days := extract(day from now() - coalesce(v_pet.last_check_at, now() - interval '1 day'))::int;

  if v_days >= 1 then
    v_hunger_mult := public.trait_hunger_multiplier(coalesce(v_pet.trait, '平平无奇'));
    v_clean_mult := public.trait_clean_multiplier(coalesce(v_pet.trait, '平平无奇'));

    for v_i in 1..v_days loop
      v_check_date := (now() - (v_days - v_i + 1) * interval '1 day')::date;

      v_fed := coalesce(v_pet.last_feed_date, '2000-01-01'::date) >= v_check_date;
      v_cleaned := coalesce(v_pet.last_clean_date, '2000-01-01'::date) >= v_check_date;
      v_cared := coalesce(v_pet.last_care_date, '2000-01-01'::date) >= v_check_date;

      -- 体力/清洁衰减
      v_daily_decay := round(100 * v_hunger_mult)::int;
      v_pet.hunger := greatest(0, coalesce(v_pet.hunger, 0) - v_daily_decay);

      v_daily_decay := round(100 * v_clean_mult)::int;
      v_pet.clean := greatest(0, coalesce(v_pet.clean, 0) - v_daily_decay);

      -- 心情每日归零
      v_pet.happiness := 0;
      v_pet.happiness_rounds := 0;

      -- 连续未照料天数
      if v_fed then v_pet.days_without_feed := 0;
      else v_pet.days_without_feed := coalesce(v_pet.days_without_feed, 0) + 1;
      end if;
      if v_cleaned then v_pet.days_without_clean := 0;
      else v_pet.days_without_clean := coalesce(v_pet.days_without_clean, 0) + 1;
      end if;
      if v_cared then v_pet.days_without_care := 0;
      else v_pet.days_without_care := coalesce(v_pet.days_without_care, 0) + 1;
      end if;

      -- 三项属性全0判断
      v_all_zero := (coalesce(v_pet.hunger, 0) = 0)
        and (coalesce(v_pet.clean, 0) = 0)
        and (coalesce(v_pet.happiness, 0) = 0);

      if v_all_zero then
        v_pet.days_zero_stats := coalesce(v_pet.days_zero_stats, 0) + 1;
      else
        v_pet.days_zero_stats := 0;
      end if;

      -- 记录触发前是否已生病
      v_was_sick := public.pet_is_sick(v_pet.has_stomach_issue, v_pet.has_skin_issue, v_pet.has_severe_illness);

      -- 普通生病触发：属性全0持续满3天，且当前未生病
      if v_pet.days_zero_stats >= 3
         and not v_pet.has_severe_illness
         and not v_pet.has_stomach_issue
         and not v_pet.has_skin_issue then
        if random() < 0.5 then
          v_pet.has_stomach_issue := true;
        else
          v_pet.has_skin_issue := true;
        end if;
      end if;

      -- 重病触发：属性全0持续满7天
      if v_pet.days_zero_stats >= 7 then
        v_pet.has_severe_illness := true;
      end if;

      -- 健康值逻辑
      v_sick := public.pet_is_sick(v_pet.has_stomach_issue, v_pet.has_skin_issue, v_pet.has_severe_illness);
      if v_sick then
        if not v_was_sick then
          -- 新触发生病：健康值直接降至0
          v_pet.health := 0;
        else
          -- 已生病：健康值保持0（不再每日衰减，反正已是0）
          v_pet.health := 0;
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
      days_zero_stats = v_pet.days_zero_stats,
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

-- ============================================================
-- 二、存量数据修复：当前已生病的宠物 health 置0
-- ============================================================
update public.pets
set health = 0
where public.pet_is_sick(has_stomach_issue, has_skin_issue, has_severe_illness) = true
  and coalesce(health, 0) > 0;

notify pgrst, 'reload schema';
