-- 0253: 进修星光按北京时间 0 点换日
--
-- 背景：进修星光为懒计算（查询时按 今天-上次领取日 天数 × 日产 得出待领），
--   此前三个函数统一使用数据库 current_date（UTC），导致北京时间每天早 8:00 才换日。
--   用户要求改为北京时间 0 点换日。
--
-- 改动：send_pet_to_study / get_study_pets / claim_study_starlight 中的 current_date
--   统一替换为 (now() at time zone 'Asia/Shanghai')::date，保证开始日、待领天数、
--   领取基准日三者口径一致。
--
-- 兼容性：存量进修宠物的 study_start_date 为 UTC 日期，切换后仅影响跨日边界的
--   一天内误差，v_days 有下限 0 保护，不会扣负。

-- ============================================================
-- 一、送去进修：开始日期按北京时间
-- ============================================================
create or replace function public.send_pet_to_study(
  p_member_id uuid,
  p_pet_id uuid
)
returns table(success boolean, message text)
language plpgsql security definer as $$
declare
  v_pet record;
begin
  select * into v_pet from public.pets where id = p_pet_id for update;
  if not found then
    return query select false, '宠物不存在';
    return;
  end if;
  if v_pet.member_id <> p_member_id then
    return query select false, '无权操作';
    return;
  end if;
  if v_pet.is_studying then
    return query select false, '宠物已在进修中';
    return;
  end if;
  -- 必须满级
  if coalesce(v_pet.level, 1) < coalesce(v_pet.max_level, 10) then
    return query select false, '宠物需要满级才能进修';
    return;
  end if;

  update public.pets set
    is_studying = true,
    study_start_date = (now() at time zone 'Asia/Shanghai')::date,
    study_last_claim_date = (now() at time zone 'Asia/Shanghai')::date
  where id = p_pet_id;

  return query select true, '宠物已送去宠物店进修，每天被动产出星光值';
end;
$$;

grant execute on function public.send_pet_to_study(uuid, uuid) to anon, authenticated;

-- ============================================================
-- 二、进修列表查询：待领/已进修天数按北京时间
-- ============================================================
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
  v_today date;
begin
  v_today := (now() at time zone 'Asia/Shanghai')::date;

  for v_pet in
    select p.*, t.name as trait_name
    from public.pets p
    left join public.pet_traits t on t.id = p.trait_id
    where p.member_id = p_member_id and p.is_studying = true
    order by p.study_start_date
  loop
    v_daily := public.study_daily_star(v_pet.rarity);
    v_days := (v_today - coalesce(v_pet.study_last_claim_date, v_pet.study_start_date))::int;
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
      (v_today - v_pet.study_start_date)::int,
      v_daily,
      v_pending,
      coalesce(v_pet.study_total_star, 0) + v_pending,
      v_pet.gender,
      v_pet.trait_name;
  end loop;
end;
$$;

grant execute on function public.get_study_pets(uuid) to anon, authenticated;

-- ============================================================
-- 三、领取进修星光：领取基准日按北京时间
-- ============================================================
create or replace function public.claim_study_starlight(
  p_member_id uuid,
  p_pet_id uuid default null
)
returns table(success boolean, message text, total_claimed numeric, new_star int)
language plpgsql security definer as $$
declare
  v_member record;
  v_pet record;
  v_daily int;
  v_days int;
  v_pending numeric;
  v_total numeric := 0;
  v_today date;
begin
  v_today := (now() at time zone 'Asia/Shanghai')::date;

  select * into v_member from public.members where id = p_member_id for update;
  if not found then
    return query select false, '用户不存在', 0, 0;
    return;
  end if;

  for v_pet in
    select * from public.pets
    where member_id = p_member_id
      and is_studying = true
      and (p_pet_id is null or id = p_pet_id)
    for update
  loop
    v_daily := public.study_daily_star(v_pet.rarity);
    v_days := (v_today - coalesce(v_pet.study_last_claim_date, v_pet.study_start_date))::int;
    if v_days < 0 then v_days := 0; end if;
    v_pending := v_days * v_daily;

    if v_pending > 0 then
      v_total := v_total + v_pending;
      update public.pets set
        study_total_star = coalesce(study_total_star, 0) + v_pending,
        study_last_claim_date = v_today
      where id = v_pet.id;
    end if;
  end loop;

  if v_total > 0 then
    update public.members set star_value = star_value + v_total, updated_at = now() where id = p_member_id;
    return query select true, '领取成功，获得 ' || v_total || ' 星光值', v_total, v_member.star_value + v_total;
  else
    return query select false, '暂无可领取的星光值', 0, v_member.star_value;
  end if;
end;
$$;

grant execute on function public.claim_study_starlight(uuid, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
