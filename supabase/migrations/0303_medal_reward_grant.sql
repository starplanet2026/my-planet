-- 0303: 勋章奖励真正发放
-- 此前 award_medal 只记录奖励文案，未实际发放特权卡；现补上：
--   1) 自动把「星光值」类奖励卡绑定到家庭内同名特权卡
--   2) 发放勋章时按 reward_item_id 往背包写入特权卡（每张独立兑换码）
--   3) 对已发放但未给奖励的历史勋章补发

-- ============================================================
-- 1. 记录奖励发放结果，保证补发幂等
-- ============================================================
alter table public.medal_awards
  add column if not exists reward_purchase_id uuid;

-- ============================================================
-- 2. 自动绑定特权卡：奖励文案含「星光值」的勋章，绑定家庭内同名特权卡
-- ============================================================
update public.medals m
set reward_item_id = i.id, updated_at = now()
from public.items i
where i.family_id = m.family_id
  and i.status = 'active'
  and m.reward_item_id is null
  and m.reward_card_name like '%星光值%'
  and i.name like '%星光值%';

-- ============================================================
-- 3. 发放勋章时实际发奖
-- ============================================================
create or replace function public.award_medal(p_member_id uuid, p_medal_id uuid, p_key text)
returns boolean
language plpgsql security definer as $$
declare
  v_family uuid;
  v_medal public.medals%rowtype;
  v_new_id uuid;
  v_item public.items%rowtype;
  v_purchase uuid;
  v_first_purchase uuid;
  v_code text;
  v_i int;
  v_count int;
  v_balance int;
begin
  select family_id into v_family from public.members where id = p_member_id;
  if v_family is null then return false; end if;

  select * into v_medal from public.medals where id = p_medal_id and family_id = v_family;
  if not found or not v_medal.is_active then return false; end if;

  insert into public.medal_awards
    (family_id, member_id, medal_id, award_key, reward_stars, reward_card_name, reward_card_count)
  values
    (v_family, p_member_id, p_medal_id, p_key, v_medal.reward_stars,
     v_medal.reward_card_name, v_medal.reward_card_count)
  on conflict (member_id, medal_id, award_key) do nothing
  returning id into v_new_id;

  if v_new_id is null then return false; end if;

  insert into public.member_medals (family_id, member_id, medal_id, count)
  values (v_family, p_member_id, p_medal_id, 1)
  on conflict (member_id, medal_id) do update
    set count = public.member_medals.count + 1, last_earned_at = now();

  -- 星光奖励
  if v_medal.reward_stars > 0 then
    update public.members
      set star_value = coalesce(star_value, 0) + v_medal.reward_stars, updated_at = now()
      where id = p_member_id
      returning star_value into v_balance;
    insert into public.coin_records
      (family_id, member_id, amount, balance_after, balance_type, category, reason, message, created_by)
    values
      (v_family, p_member_id, v_medal.reward_stars, coalesce(v_balance, 0), 'star', 'medal',
       '勋章奖励：' || v_medal.name, v_medal.name, p_member_id);
  end if;

  -- 特权卡奖励：按张数写入背包，每张独立兑换码
  if v_medal.reward_item_id is not null then
    select * into v_item
    from public.items
    where id = v_medal.reward_item_id and family_id = v_family and status = 'active';

    if found then
      v_count := greatest(coalesce(v_medal.reward_card_count, 1), 1);
      for v_i in 1..v_count loop
        v_code := upper(substr(md5(random()::text || clock_timestamp()::text || v_i::text), 1, 8));
        insert into public.purchases
          (family_id, item_id, item_name_snapshot, member_id, price_paid, code, status, quantity)
        values
          (v_family, v_item.id, v_item.name, p_member_id, 0, v_code, 'pending', 1)
        returning id into v_purchase;
        if v_first_purchase is null then v_first_purchase := v_purchase; end if;
      end loop;

      update public.medal_awards
      set reward_purchase_id = v_first_purchase
      where id = v_new_id;
    end if;
  end if;

  return true;
end;
$$;

-- ============================================================
-- 4. 历史勋章补发奖励
-- ============================================================
do $$
declare
  r record;
  v_item public.items%rowtype;
  v_code text;
  v_i int;
  v_count int;
  v_first uuid;
  v_balance int;
begin
  for r in
    select a.id, a.family_id, a.member_id, a.medal_id, a.reward_stars,
           m.reward_item_id, m.reward_card_count, m.name
    from public.medal_awards a
    join public.medals m on m.id = a.medal_id
    where a.reward_purchase_id is null
      and m.reward_item_id is not null
  loop
    select * into v_item
    from public.items
    where id = r.reward_item_id and family_id = r.family_id and status = 'active';

    if found then
      v_count := greatest(coalesce(r.reward_card_count, 1), 1);
      v_first := null;
      for v_i in 1..v_count loop
        v_code := upper(substr(md5(random()::text || clock_timestamp()::text || v_i::text), 1, 8));
        insert into public.purchases
          (family_id, item_id, item_name_snapshot, member_id, price_paid, code, status, quantity)
        values
          (r.family_id, v_item.id, v_item.name, r.member_id, 0, v_code, 'pending', 1)
        returning id into v_first;
      end loop;
      update public.medal_awards set reward_purchase_id = v_first where id = r.id;
    end if;

    -- 星光类奖励同样补发
    if coalesce(r.reward_stars, 0) > 0 then
      update public.members
        set star_value = coalesce(star_value, 0) + r.reward_stars, updated_at = now()
        where id = r.member_id
        returning star_value into v_balance;
      insert into public.coin_records
        (family_id, member_id, amount, balance_after, balance_type, category, reason, message, created_by)
      values
        (r.family_id, r.member_id, r.reward_stars, coalesce(v_balance, 0), 'star', 'medal',
         '勋章奖励：' || r.name, r.name, r.member_id);
    end if;
  end loop;
end;
$$;
