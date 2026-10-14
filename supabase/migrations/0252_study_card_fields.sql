-- 0252: get_study_pets 增加 gender / trait_name 返回字段
-- 用于宠物店进修卡片顶部「性别/稀有度/特质」信息行展示

drop function if exists public.get_study_pets(uuid);

create or replace function public.get_study_pets(p_member_id uuid)
returns table(
  pet_id uuid,
  name text,
  emoji text,
  image_url text,
  rarity text,
  level int,
  max_level int,
  study_days int,
  daily_star int,
  pending_star numeric,
  total_star numeric,
  gender text,
  trait_name text
)
language plpgsql security definer as $$
declare
  v_pet record;
  v_daily int;
  v_days int;
  v_pending numeric;
begin
  for v_pet in
    select p.*, t.name as trait_name
    from public.pets p
    left join public.pet_traits t on t.id = p.trait_id
    where p.member_id = p_member_id and p.is_studying = true
    order by p.study_start_date
  loop
    v_daily := public.study_daily_star(v_pet.rarity);
    v_days := (current_date - coalesce(v_pet.study_last_claim_date, v_pet.study_start_date))::int;
    if v_days < 0 then v_days := 0; end if;
    v_pending := v_days * v_daily;

    return query select
      v_pet.id,
      v_pet.name,
      v_pet.emoji,
      v_pet.image_url,
      v_pet.rarity,
      v_pet.level,
      v_pet.max_level,
      (current_date - v_pet.study_start_date)::int,
      v_daily,
      v_pending,
      coalesce(v_pet.study_total_star, 0) + v_pending,
      v_pet.gender,
      v_pet.trait_name;
  end loop;
end;
$$;

grant execute on function public.get_study_pets(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
