-- 0304: 大转盘抽到「五百星光值」改为发放特权卡到背包
-- 原先直接给成员加 500 星光值；现与勋章奖励保持一致，改为写入 purchases 背包，
-- 由孩子使用特权卡后由家长手动记录星光值。
-- 若家庭内找不到对应特权卡，则退回原有直接加星光逻辑，避免抽到空奖。

create or replace function public.claim_lucky_wheel_reward(p_session_id uuid)
returns table(reward_type text, reward_key text, reward_name text, wish_hit boolean, coin_refunded boolean, message text)
language plpgsql security definer as $$
declare
  v_session public.lucky_wheel_sessions%rowtype;
  v_spin public.lucky_wheel_spins%rowtype;
  v_member public.members%rowtype;
  v_family_id uuid;
  v_item public.items%rowtype;
  v_star_item public.items%rowtype;
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

  select * into v_spin from public.lucky_wheel_spins
  where session_id = p_session_id
  order by spin_index desc limit 1;

  if not found or v_spin.is_claimed then
    update public.lucky_wheel_sessions set status = 'completed', completed_at = now() where id = p_session_id;
    return query select null::text, null::text, null::text, false, false, '无可领取的奖励'::text;
    return;
  end if;

  if v_spin.reward_type = 'star' then
    -- 五百星光值：优先发放等值特权卡到背包
    select * into v_star_item
    from public.items
    where family_id = v_family_id and status = 'active' and name like '%星光值%'
    order by (category = '稀有') desc, price desc
    limit 1;

    if found then
      v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
      insert into public.purchases (family_id, item_id, item_name_snapshot, member_id, price_paid, quantity, code, status)
      values (v_family_id, v_star_item.id, v_star_item.name, v_session.member_id, 0, 1, v_code, 'pending')
      returning id into v_purchase_id;

      insert into public.coin_records (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by, balance_type)
      values (v_family_id, v_session.member_id, 0, v_member.coin_balance,
        '幸运大转盘: ' || v_star_item.name, 'lucky_wheel', 'purchase', v_purchase_id, v_session.member_id, 'coin');
    else
      -- 兜底：家庭未配置该特权卡时，仍按原逻辑直接加星光
      v_new_star := v_member.star_value + 500;
      update public.members set star_value = v_new_star, updated_at = now() where id = v_session.member_id;
      insert into public.coin_records (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by, balance_type)
      values (v_family_id, v_session.member_id, 500, v_new_star,
        '幸运大转盘: 五百星光值', 'lucky_wheel', 'lucky_wheel_spin', v_spin.id, v_session.member_id, 'star');
    end if;
  else
    -- 物品类（普通特权卡 / 稀有券）：写入 purchases
    select * into v_item from public.items where id::text = v_spin.reward_key;
    if found then
      v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
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
      v_new_coin := v_member.coin_balance + 20;
      update public.members set coin_balance = v_new_coin, updated_at = now() where id = v_session.member_id;
      insert into public.coin_records (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by, balance_type)
      values (v_family_id, v_session.member_id, 20, v_new_coin,
        '幸运大转盘: 许愿成功退还金币', 'lucky_wheel', 'lucky_wheel_session', p_session_id, v_session.member_id, 'coin');
      update public.lucky_wheel_sessions set coin_refunded = true where id = p_session_id;
      v_coin_refunded := true;
    end if;
  end if;

  update public.lucky_wheel_spins set is_claimed = true where id = v_spin.id;
  update public.lucky_wheel_sessions set status = 'completed', completed_at = now() where id = p_session_id;

  return query select
    v_spin.reward_type, v_spin.reward_key, v_spin.reward_name,
    v_wish_hit, v_coin_refunded, 'ok'::text;
end;
$$;
