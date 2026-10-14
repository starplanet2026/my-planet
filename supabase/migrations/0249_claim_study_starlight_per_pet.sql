-- 0249: 进修星光支持按单只宠物手动领取
-- 背景：原 claim_study_starlight(p_member_id) 只能一次性领取该用户全部进修宠物的待领星光。
--       工单要求每张进修卡片「领取我的工资」按单只宠物结算，同时保留「一键领取」。
-- 方案：扩展为 claim_study_starlight(p_member_id, p_pet_id default null)
--       p_pet_id 为 null 时 = 一次性领取全部（一键领取）；否则只结算指定宠物。

drop function if exists public.claim_study_starlight(uuid);

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
begin
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

revoke all on function public.claim_study_starlight(uuid, uuid) from public;
grant execute on function public.claim_study_starlight(uuid, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
