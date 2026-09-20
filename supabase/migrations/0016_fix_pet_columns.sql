-- 0016: 修复 pet_shop_items 列名 + 加 gender
-- 将 base_coin_per_hour 重命名为 base_coin_per_day（如果存在旧列）
do $$
begin
  -- 如果 base_coin_per_day 不存在但 base_coin_per_hour 存在，重命名
  if not exists (select 1 from information_schema.columns where table_name = 'pet_shop_items' and column_name = 'base_coin_per_day')
     and exists (select 1 from information_schema.columns where table_name = 'pet_shop_items' and column_name = 'base_coin_per_hour') then
    alter table public.pet_shop_items rename column base_coin_per_hour to base_coin_per_day;
    raise notice '已重命名 base_coin_per_hour → base_coin_per_day';
  end if;

  -- 如果两个都不存在，添加 base_coin_per_day
  if not exists (select 1 from information_schema.columns where table_name = 'pet_shop_items' and column_name = 'base_coin_per_day') then
    alter table public.pet_shop_items add column base_coin_per_day numeric default 1;
    raise notice '已添加 base_coin_per_day';
  end if;

  -- 加 gender 列
  if not exists (select 1 from information_schema.columns where table_name = 'pet_shop_items' and column_name = 'gender') then
    alter table public.pet_shop_items add column gender text;
    raise notice '已添加 gender';
  end if;
end;
$$;
