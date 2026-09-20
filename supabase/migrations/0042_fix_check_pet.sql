-- 0042: 简化 check_pet，避免返回类型不匹配
-- ============================================================

drop function if exists public.check_pet(uuid);

create function public.check_pet(p_pet_id uuid)
returns setof public.pets
language plpgsql security definer as $$
declare
  v_pet record;
  v_daily_production numeric;
  v_decay int;
  v_evolved_bonus numeric;
  v_new_hunger int;
  v_new_clean int;
  v_new_happiness int;
  v_new_health int;
  v_days_since int;
begin
  select * into v_pet from public.pets where public.pets.id = p_pet_id for update;
  if not found then return; end if;

  v_days_since := extract(day from now() - coalesce(v_pet.last_check_at, now() - interval '1 day'))::int;

  if v_days_since >= 1 then
    v_evolved_bonus := coalesce(v_pet.evolved_bonus, 0.0);
    v_daily_production := coalesce(v_pet.base_coin_per_day, 0)
      * (1.0 + (v_pet.level - 1) * coalesce(v_pet.upgrade_percent, 5.0) / 100.0)
      * (1.0 + v_evolved_bonus / 100.0);

    v_decay := coalesce(v_pet.daily_decay_base, 5) + round(coalesce(v_pet.daily_decay_base, 5) * 0.02 * v_days_since)::int;
    v_new_hunger := greatest(0, v_pet.hunger - v_decay);
    v_new_clean := greatest(0, v_pet.clean - v_decay);
    v_new_happiness := greatest(0, v_pet.happiness - v_decay);
    v_new_health := greatest(0, v_pet.health - v_decay);

    update public.pets set
      coin_balance = coalesce(v_pet.coin_balance, 0) + v_daily_production * v_days_since,
      hunger = v_new_hunger,
      clean = v_new_clean,
      happiness = v_new_happiness,
      health = v_new_health,
      is_sick = (v_new_health < 30),
      last_check_at = now()
    where public.pets.id = p_pet_id;
  end if;

  return query select * from public.pets where public.pets.id = p_pet_id;
end;
$$;

grant execute on function public.check_pet(uuid) to anon, authenticated;
