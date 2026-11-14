-- 0305: 特权卡使用后自动发放星光值
-- 场景：孩子使用「500星光值」特权卡时，由系统直接把 500 星光值加到账户，
-- 不再需要家长手动记录。新增 items.star_reward 字段配置赠送额度。

alter table public.items
  add column if not exists star_reward integer not null default 0;

-- 已有「星光值」类特权卡按名称中的数字回填
update public.items
set star_reward = coalesce((regexp_match(name, '(\d+)'))[1]::int, 0)
where star_reward = 0
  and name like '%星光值%';

create or replace function public.redeem_purchase(p_purchase_id uuid, p_member_id uuid)
returns void
language plpgsql security definer as $$
declare
  v_p public.purchases%rowtype;
  v_item public.items%rowtype;
  v_weekly_count int;
  v_week_start timestamptz;
  v_new_star int;
begin
  v_week_start := date_trunc('week', now());
  select * into v_p from public.purchases where id = p_purchase_id for update;
  if not found then raise exception '特权卡不存在'; end if;
  if v_p.status <> 'pending' then raise exception '特权卡已使用或已出售'; end if;
  if v_p.member_id <> p_member_id then raise exception '无权操作'; end if;
  select * into v_item from public.items where id = v_p.item_id;
  if v_item.weekly_limit is not null and v_item.weekly_limit > 0 then
    select count(*) into v_weekly_count
      from public.purchase_usage_records
      where member_id = p_member_id and item_id = v_p.item_id and used_at >= v_week_start;
    if v_weekly_count >= v_item.weekly_limit then
      raise exception '本周该特权卡已达到使用上限（%s次），请下周再使用', v_item.weekly_limit;
    end if;
  end if;
  if v_p.quantity > 1 then
    update public.purchases set quantity = quantity - 1 where id = p_purchase_id;
  else
    update public.purchases set status = 'redeemed', redeemed_by = p_member_id, redeemed_at = now() where id = p_purchase_id;
  end if;
  insert into public.purchase_usage_records (family_id, member_id, purchase_id, item_id, item_name)
  values (v_p.family_id, p_member_id, p_purchase_id, v_p.item_id, v_p.item_name_snapshot);

  -- 星光值类特权卡：使用后自动发放星光
  if coalesce(v_item.star_reward, 0) > 0 then
    update public.members
      set star_value = coalesce(star_value, 0) + v_item.star_reward, updated_at = now()
      where id = p_member_id
      returning star_value into v_new_star;

    insert into public.coin_records
      (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by, balance_type)
    values
      (v_p.family_id, p_member_id, v_item.star_reward, coalesce(v_new_star, 0),
       '使用特权卡: ' || v_item.name, 'purchase', 'purchase', p_purchase_id, p_member_id, 'star');
  end if;
end;
$$;
