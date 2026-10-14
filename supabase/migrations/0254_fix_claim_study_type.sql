-- 0254: 修复领取进修星光报错 structure of query does not match function result type
--
-- 根因：claim_study_starlight 声明返回 new_star int，但成功分支返回
--   v_member.star_value(int) + v_total(numeric) 结果为 numeric，
--   PL/pgSQL 42804 报错导致领取失败。0249 起存在，此前无可领星光未触发。
-- 修复：返回值显式 ::int 转换。

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
    return query select false, '用户不存在'::text, 0::numeric, 0::int;
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
    return query select true, ('领取成功，获得 ' || v_total || ' 星光值')::text, v_total, (v_member.star_value + v_total)::int;
  else
    return query select false, '暂无可领取的星光值'::text, 0::numeric, v_member.star_value;
  end if;
end;
$$;

grant execute on function public.claim_study_starlight(uuid, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
