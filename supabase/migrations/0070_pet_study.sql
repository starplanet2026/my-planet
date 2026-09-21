-- 0070: 萌宠星球 - 进修被动星光收益
-- 1. pets 新增进修字段
-- 2. RPC：送去进修、查询进修宠物(含待领星光)、领取进修星光
--    普通: 2⭐/天, 稀有: 5⭐/天, 史诗: 10⭐/天

-- ============================================================
-- 一、pets 新增进修字段
-- ============================================================
alter table public.pets add column if not exists is_studying boolean not null default false;
alter table public.pets add column if not exists study_start_date date;
alter table public.pets add column if not exists study_total_star numeric(10,2) not null default 0;
alter table public.pets add column if not exists study_last_claim_date date;

-- ============================================================
-- 二、RPC：送去进修（满级宠物二选一）
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
    study_start_date = current_date,
    study_last_claim_date = current_date
  where id = p_pet_id;

  return query select true, '宠物已送去宠物店进修，每天被动产出星光值';
end;
$$;

grant execute on function public.send_pet_to_study(uuid, uuid) to anon, authenticated;

-- ============================================================
-- 三、辅助：根据稀有度获取每日进修星光
-- ============================================================
create or replace function public.study_daily_star(p_rarity text)
returns int
language sql immutable
as $$
  select case p_rarity
    when 'common' then 2
    when 'rare' then 5
    when 'epic' then 10
    else 0
  end;
$$;

grant execute on function public.study_daily_star(text) to anon, authenticated;

-- ============================================================
-- 四、RPC：查询进修宠物列表（含待领星光）
-- ============================================================
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
  total_star numeric
)
language plpgsql security definer as $$
declare
  v_pet record;
  v_daily int;
  v_days int;
  v_pending numeric;
begin
  for v_pet in
    select * from public.pets
    where member_id = p_member_id and is_studying = true
    order by study_start_date
  loop
    v_daily := public.study_daily_star(v_pet.rarity);
    -- 从上次领取日到今天的天数
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
      coalesce(v_pet.study_total_star, 0) + v_pending;
  end loop;
end;
$$;

grant execute on function public.get_study_pets(uuid) to anon, authenticated;

-- ============================================================
-- 五、RPC：领取进修星光
-- ============================================================
create or replace function public.claim_study_starlight(
  p_member_id uuid
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
begin
  select * into v_member from public.members where id = p_member_id for update;
  if not found then
    return query select false, '用户不存在', 0, 0;
    return;
  end if;

  for v_pet in
    select * from public.pets
    where member_id = p_member_id and is_studying = true
    for update
  loop
    v_daily := public.study_daily_star(v_pet.rarity);
    v_days := (current_date - coalesce(v_pet.study_last_claim_date, v_pet.study_start_date))::int;
    if v_days < 0 then v_days := 0; end if;
    v_pending := v_days * v_daily;

    if v_pending > 0 then
      v_total := v_total + v_pending;
      update public.pets set
        study_total_star = coalesce(study_total_star, 0) + v_pending,
        study_last_claim_date = current_date
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

grant execute on function public.claim_study_starlight(uuid) to anon, authenticated;
