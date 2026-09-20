-- ============================================================
-- 0014: 新增3张稀有特权卡
-- ============================================================

do $$
declare
  v_family_id uuid;
  v_parent_id uuid;
begin
  select id into v_family_id from public.families order by created_at limit 1;
  if v_family_id is null then return; end if;

  select id into v_parent_id from public.members
    where family_id = v_family_id and role = 'parent' order by created_at limit 1;
  if v_parent_id is null then return; end if;

  -- 1. 积分膨胀券
  insert into public.items (family_id, name, description, price, weekly_limit, status, created_by, category)
  select v_family_id, '积分膨胀券', '此券可以与其他券同时叠加使用，让你的收入翻倍！', 9999, null, 'active', v_parent_id, '稀有'
  where not exists (select 1 from public.items where family_id = v_family_id and name = '积分膨胀券');

  -- 2. 免抠积分券
  insert into public.items (family_id, name, description, price, weekly_limit, status, created_by, category)
  select v_family_id, '免抠积分券', '凭此券可以免扣积分一次。让你逃过一劫！', 9999, null, 'active', v_parent_id, '稀有'
  where not exists (select 1 from public.items where family_id = v_family_id and name = '免抠积分券');

  -- 3. 幸运大转盘
  insert into public.items (family_id, name, description, price, weekly_limit, status, created_by, category)
  select v_family_id, '幸运大转盘', '凭此券可以玩转幸运大转盘一次。更棒的是，可以抽3次，选取一次结果哟～', 9999, null, 'active', v_parent_id, '稀有'
  where not exists (select 1 from public.items where family_id = v_family_id and name = '幸运大转盘');

  raise notice '3张稀有卡已上架';
end;
$$;
