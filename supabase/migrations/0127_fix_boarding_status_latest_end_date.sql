-- 0127: 修复托管卡有效期显示：展示最新（最远）到期日
-- 问题：get_boarding_status 使用 order by end_date asc 返回最早到期的卡，
--       购买新卡后弹窗顶部仍显示旧卡到期日，用户感知"未刷新"。
-- 预期：购买托管卡成功后，弹窗顶部"有效托管卡至 X"立即显示最新到期日。
-- 修复：改为 order by end_date desc，返回最远到期的活跃卡，展示最新有效期。
--       多卡叠加场景下，最远到期日 = 用户托管权限的整体有效期，符合直觉。

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
  -- 取最远到期的活跃卡（最新购买叠加后的整体有效期）
  select * into v_card from public.pet_boarding_cards pbc
    where pbc.member_id = p_member_id and pbc.end_date >= v_today
    order by pbc.end_date desc limit 1;

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
revoke all on function public.get_boarding_status(uuid) from public;
grant execute on function public.get_boarding_status(uuid) to anon, authenticated;
