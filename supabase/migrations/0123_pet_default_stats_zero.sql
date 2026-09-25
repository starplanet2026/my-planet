-- 0123: 萌宠星球两处修复
-- 1) 新宠物初始体力/清洁/心情默认值由 80 改为 0
--    buy_pet_item 插入 pets 时未指定 hunger/clean/happiness，
--    表字段默认值为 80，导致新宠物一出生三项属性即 80。
alter table public.pets alter column hunger set default 0;
alter table public.pets alter column clean set default 0;
alter table public.pets alter column happiness set default 0;
-- health 保持默认 100 不变

-- 2) 家长更新商店宠物形象图后，已购宠物自动同步最新图片
--    触发器：pet_shop_items.image_url 变更时，级联更新对应 pets.image_url
create or replace function public.sync_pet_image_from_shop()
returns trigger language plpgsql as $$
begin
  if new.image_url is distinct from old.image_url then
    update public.pets set image_url = new.image_url where shop_item_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_pet_image on public.pet_shop_items;
create trigger trg_sync_pet_image
after update of image_url on public.pet_shop_items
for each row execute function public.sync_pet_image_from_shop();
