-- 0277: 大转盘抽到的特权卡同步兑换页价格
-- 问题：claim_lucky_wheel_reward 写入 purchases 时 price_paid 硬编码为 0，
--       导致非稀有特权卡进入背包后价格为 0，出售时返还 0 金币。
-- 修复：
--   1. 重建 claim_lucky_wheel_reward：非稀有卡 price_paid 取 items.price（与特权兑换页一致），稀有卡保持 0（不可出售）
--   2. 回填存量：大转盘发放（coin_records category='lucky_wheel'）、price_paid=0、状态 pending 的非稀有卡，同步为 items.price

create or replace function public.claim_lucky_wheel_reward(p_session_id uuid)
returns table(
  reward_type text, reward_key text, reward_name text,
  wish_hit boolean, coin_refunded boolean, message text
) language plpgsql security definer as $$
declare
  v_session public.lucky_wheel_sessions%rowtype;
  v_spin public.lucky_wheel_spins%rowtype;
  v_member public.members%rowtype;
  v_family_id uuid;
  v_item public.items%rowtype;
  v_purchase_id uuid;
  v_code text;
  v_new_star int;
  v_new_coin numeric;
  v_wish_hit boolean := false;
  v_coin_refunded boolean := false;
begin
  select * into v_session from public.lucky_wheel_sessions where id = p_session_id for update;
  if not found then
    return query select null::text, null::text, null::text, false, false, '转盘会话不存在'::text;
    return;
  end if;

  v_family_id := v_session.family_id;
  select * into v_member from public.members where id = v_session.member_id;

  -- 获取最后一次抽取结果
  select * into v_spin from public.lucky_wheel_spins
  where session_id = p_session_id
  order by spin_index desc limit 1;

  if not found or v_spin.is_claimed then
    -- 没有抽取记录或已领取，直接结束
    update public.lucky_wheel_sessions set status = 'completed', completed_at = now() where id = p_session_id;
    return query select null::text, null::text, null::text, false, false, '无可领取的奖励'::text;
    return;
  end if;

  -- 发放奖励
  if v_spin.reward_type = 'star' then
    -- 五百星光值
    v_new_star := v_member.star_value + 500;
    update public.members set star_value = v_new_star, updated_at = now() where id = v_session.member_id;
    insert into public.coin_records (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by, balance_type)
    values (v_family_id, v_session.member_id, 500, v_new_star,
      '幸运大转盘: 五百星光值', 'lucky_wheel', 'lucky_wheel_spin', v_spin.id, v_session.member_id, 'star');
  else
    -- 物品类（普通特权卡 / 稀有券）：写入 purchases
    select * into v_item from public.items where id::text = v_spin.reward_key;
    if found then
      v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
      -- 非稀有卡按兑换页价格记录 price_paid（出售返还的依据）；稀有卡不可出售，保持 0
      insert into public.purchases (family_id, item_id, item_name_snapshot, member_id, price_paid, quantity, code, status)
      values (v_family_id, v_item.id, v_item.name, v_session.member_id,
        case when v_item.category = '稀有' then 0 else v_item.price end, 1, v_code, 'pending')
      returning id into v_purchase_id;
      insert into public.coin_records (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by, balance_type)
      values (v_family_id, v_session.member_id, 0, v_member.coin_balance,
        '幸运大转盘: ' || v_item.name, 'lucky_wheel', 'purchase', v_purchase_id, v_session.member_id, 'coin');
    end if;
  end if;

  -- 许愿判定
  if v_session.wish_reward_key is not null and v_session.wish_reward_key = v_spin.reward_key then
    v_wish_hit := true;
    if v_session.pay_type = 'coin' and not v_session.coin_refunded then
      -- 退还 20 金币
      v_new_coin := v_member.coin_balance + 20;
      update public.members set coin_balance = v_new_coin, updated_at = now() where id = v_session.member_id;
      insert into public.coin_records (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by, balance_type)
      values (v_family_id, v_session.member_id, 20, v_new_coin,
        '幸运大转盘: 许愿成功退还金币', 'lucky_wheel', 'lucky_wheel_session', p_session_id, v_session.member_id, 'coin');
      update public.lucky_wheel_sessions set coin_refunded = true where id = p_session_id;
      v_coin_refunded := true;
    end if;
  end if;

  -- 标记已领取 + session 结束
  update public.lucky_wheel_spins set is_claimed = true where id = v_spin.id;
  update public.lucky_wheel_sessions set status = 'completed', completed_at = now() where id = p_session_id;

  return query select
    v_spin.reward_type, v_spin.reward_key, v_spin.reward_name,
    v_wish_hit, v_coin_refunded, 'ok'::text;
end;
$$;
grant execute on function public.claim_lucky_wheel_reward(uuid) to anon, authenticated;

-- 回填存量：大转盘发放的 pending 非稀有卡 price_paid 同步为兑换页价格
update public.purchases p
set price_paid = i.price
from public.items i
where p.item_id = i.id
  and p.status = 'pending'
  and p.price_paid = 0
  and i.category <> '稀有'
  and exists (
    select 1 from public.coin_records cr
    where cr.ref_type = 'purchase'
      and cr.ref_id::text = p.id::text
      and cr.category = 'lucky_wheel'
  );

notify pgrst, 'reload schema';
