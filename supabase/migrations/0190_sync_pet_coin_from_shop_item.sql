-- 0190: 同步已领养宠物的 base_coin_per_day / upgrade_coin_reward 与商店物品一致
-- 背景：领养时从商店物品复制这两个字段到 pets 表，后续改商店物品不会同步，
--       导致宠物展示/实际产金与后台设置不一致。此迁移一次性修复历史数据。

do $$
declare
  v_coin_count int;
  v_upgrade_count int;
begin
  -- 同步 base_coin_per_day
  with updated as (
    update public.pets p
    set base_coin_per_day = i.base_coin_per_day
    from public.pet_shop_items i
    where p.shop_item_id = i.id
      and i.base_coin_per_day is not null
      and coalesce(p.base_coin_per_day, -1) <> i.base_coin_per_day
    returning 1
  )
  select count(*) into v_coin_count from updated;

  -- 同步 upgrade_coin_reward
  with updated as (
    update public.pets p
    set upgrade_coin_reward = i.upgrade_coin_reward
    from public.pet_shop_items i
    where p.shop_item_id = i.id
      and i.upgrade_coin_reward is not null
      and coalesce(p.upgrade_coin_reward, -1) <> i.upgrade_coin_reward
    returning 1
  )
  select count(*) into v_upgrade_count from updated;

  raise notice '同步 base_coin_per_day: % 只宠物; 同步 upgrade_coin_reward: % 只宠物', v_coin_count, v_upgrade_count;
end $$;
