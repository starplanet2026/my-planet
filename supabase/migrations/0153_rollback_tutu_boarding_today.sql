-- 回滚"屠图"账号今日托管数据
-- 1. 根据 pet_boarding_log 反向恢复宠物属性（体力/清洁/心情/经验/金币）
-- 2. 恢复成员星光值（从 coin_records 反查 boarding 消耗）
-- 3. 清理今日托管相关记录（pet_daily_exp_log → pet_boarding_log → pet_boarding → coin_records）

do $$
declare
  v_member_id uuid;
  v_today date := (now() at time zone 'Asia/Shanghai')::date;
  v_log record;
  v_star_spent numeric := 0;
begin
  -- 查找"屠图"成员
  select id into v_member_id from public.members where name = '屠图' limit 1;
  if v_member_id is null then
    raise notice '未找到名为"屠图"的成员，跳过';
    return;
  end if;

  -- 1. 反向恢复宠物属性：减去托管时补的值
  for v_log in
    select pet_id, hunger_gain, clean_gain, happiness_gain, exp_gain, coin_gain
    from public.pet_boarding_log
    where member_id = v_member_id and board_date = v_today
  loop
    update public.pets set
      hunger = greatest(0, coalesce(hunger, 0) - v_log.hunger_gain),
      clean = greatest(0, coalesce(clean, 0) - v_log.clean_gain),
      happiness = greatest(0, coalesce(happiness, 0) - v_log.happiness_gain),
      exp = greatest(0, coalesce(exp, 0) - v_log.exp_gain),
      coin_balance = greatest(0, coalesce(coin_balance, 0) - v_log.coin_gain)
    where id = v_log.pet_id;
  end loop;

  -- 2. 恢复星光值：从 coin_records 查回今日 boarding 消耗
  select coalesce(sum(abs(amount)), 0) into v_star_spent
  from public.coin_records
  where member_id = v_member_id
    and category = 'boarding'
    and balance_type = 'star'
    and (created_at at time zone 'Asia/Shanghai')::date = v_today;

  if v_star_spent > 0 then
    update public.members
    set star_value = coalesce(star_value, 0) + v_star_spent
    where id = v_member_id;
  end if;

  -- 3. 清理今日托管相关记录（注意顺序：先删依赖方再删被依赖方）

  -- 3a. 删除 pet_daily_exp_log（依赖 pets，用 member_id 查 pets）
  delete from public.pet_daily_exp_log
  where log_date = v_today
    and pet_id in (
      select id from public.pets where member_id = v_member_id
    );

  -- 3b. 删除 pet_boarding_log
  delete from public.pet_boarding_log
  where member_id = v_member_id and board_date = v_today;

  -- 3c. 删除 pet_boarding
  delete from public.pet_boarding
  where member_id = v_member_id and board_date = v_today;

  -- 3d. 删除今日 boarding 相关 coin_records
  delete from public.coin_records
  where member_id = v_member_id
    and category = 'boarding'
    and (created_at at time zone 'Asia/Shanghai')::date = v_today;

  raise notice '已回滚"屠图"账号 % 的今日托管数据，恢复星光值 %', v_member_id, v_star_spent;
end;
$$;
