-- 0284: claim_pet_coins 领完后 coin_balance 直接清零，不再残留小数
-- 原逻辑：floor(balance) 领走整数后 balance := balance - floor(balance)，
--   小数部分（0.2 / 0.25 / 0.1）永远留在库里，下次托管再加又涨回去，
--   长期看每个带 coin_multiplier 的宠物都会积累越来越多小数，
--   虽然 UI 条件 <1 会隐藏 icon，但 coin_balance 的小数部分是无主资产。
-- 新逻辑：v_claimed := floor(balance) 后直接 coin_balance := 0，
--   小数部分视作宠物自然消耗掉（与"今日金币领完即归零"语义一致）。

create or replace function public.claim_pet_coins(p_member_id uuid, p_pet_id uuid)
 returns table(success boolean, message text, claimed numeric, new_coin integer)
 language plpgsql
 security definer
as $function$
declare
  v_pet public.pets%rowtype;
  v_member public.members%rowtype;
  v_claimed numeric;
  v_new_coin int;
begin
  select * into v_pet from public.pets where id = p_pet_id for update;
  if not found then return query select false, '宠物不存在', 0, 0; return; end if;
  if v_pet.member_id <> p_member_id then return query select false, '无权操作', 0, 0; return; end if;

  if v_pet.coin_balance < 1 then
    return query select false, '暂无可领取金币', 0, 0; return;
  end if;

  v_claimed := floor(v_pet.coin_balance);

  select * into v_member from public.members where id = p_member_id for update;
  v_new_coin := v_member.coin_balance + v_claimed;
  update public.members set coin_balance = v_new_coin, updated_at = now() where id = p_member_id;

  -- 直接清零，不保留小数
  update public.pets set coin_balance = 0 where id = p_pet_id;

  insert into public.pet_actions (pet_id, member_id, action_type, coin_gain)
  values (p_pet_id, p_member_id, 'claim_coin', v_claimed);

  return query select true, '已领取 ' || v_claimed || ' 金币', v_claimed, v_new_coin;
end;
$function$;

notify pgrst, 'reload schema';
