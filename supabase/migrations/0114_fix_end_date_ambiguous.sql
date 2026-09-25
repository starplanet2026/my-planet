-- 0114: 修复 end_date 歧义
-- buy_boarding_card 的 RETURNS TABLE 含 end_date 输出参数，与表列名冲突
-- get_boarding_status 的 WHERE/ORDER BY 中 end_date 未限定表名

-- ============================================================
-- 一、修复 buy_boarding_card：用表别名限定 end_date
-- ============================================================
create or replace function public.buy_boarding_card(
  p_member_id uuid,
  p_item_id uuid
)
returns table(success boolean, message text, new_star int, end_date date)
language plpgsql security definer as $$
declare
  v_member record;
  v_item record;
  v_family_id uuid;
  v_cost int;
  v_days int;
  v_last_end date;
  v_start date;
  v_new_end date;
begin
  select * into v_member from public.members where id = p_member_id for update;
  if not found then
    return query select false, '用户不存在', 0, null::date;
    return;
  end if;
  v_family_id := v_member.family_id;

  select * into v_item from public.pet_shop_items
    where id = p_item_id and subcategory = 'foster' and status = 'active';
  if not found then
    return query select false, '托管卡不存在或已下架', v_member.star_value, null::date;
    return;
  end if;

  v_cost := coalesce(v_item.price_star, 0);
  v_days := coalesce(v_item.valid_days, 1);

  if v_member.star_value < v_cost then
    return query select false, '星光值不足', v_member.star_value, null::date;
    return;
  end if;

  -- 扣费
  update public.members set star_value = star_value - v_cost, updated_at = now() where id = p_member_id;

  -- 找到该用户所有托管卡中最晚的截止日期（限定表别名避免歧义）
  select max(pbc.end_date) into v_last_end
    from public.pet_boarding_cards pbc
    where pbc.member_id = p_member_id;

  -- 生效起始日：若有未过期/未来的卡，接在最后一张之后；否则从今天开始
  if v_last_end is not null and v_last_end >= current_date then
    v_start := v_last_end + 1;
  else
    v_start := current_date;
  end if;
  v_new_end := v_start + v_days - 1;

  insert into public.pet_boarding_cards (family_id, member_id, card_type, item_id, start_date, end_date)
  values (v_family_id, p_member_id, coalesce(v_item.name, 'custom'), p_item_id, v_start, v_new_end);

  return query select true, '购买成功，有效期至 ' || v_new_end::text, v_member.star_value - v_cost, v_new_end;
end;
$$;

revoke all on function public.buy_boarding_card(uuid, uuid) from public;
grant execute on function public.buy_boarding_card(uuid, uuid) to anon, authenticated;

-- ============================================================
-- 二、修复 get_boarding_status：用表别名限定 end_date
-- ============================================================
create or replace function public.get_boarding_status(p_member_id uuid)
returns table(
  has_active_card boolean,
  card_end_date date,
  today_boarded_pet_ids uuid[],
  selected_pet_ids uuid[]
)
language plpgsql security definer as $$
declare
  v_card record;
  v_boarded uuid[];
  v_selected uuid[];
  v_today date := (now() at time zone 'Asia/Shanghai')::date;
begin
  select * into v_card from public.pet_boarding_cards pbc
    where pbc.member_id = p_member_id and pbc.end_date >= v_today
    order by pbc.end_date asc limit 1;

  select coalesce(array_agg(pet_id), array[]::uuid[]) into v_boarded
    from public.pet_boarding
    where member_id = p_member_id and board_date = v_today;

  select coalesce(array_agg(pet_id), array[]::uuid[]) into v_selected
    from public.pet_boarding_selection
    where member_id = p_member_id and selected = true;

  return query select
    v_card is not null,
    v_card.end_date,
    v_boarded,
    v_selected;
end;
$$;

grant execute on function public.get_boarding_status(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
