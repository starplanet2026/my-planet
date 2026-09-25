-- 0124: 回填已购宠物的形象图为商店最新图片
-- 背景：0123 的触发器只对「之后」的图片更新生效；
--       若家长在 0123 部署前已改过商店形象图，已购宠物的 image_url 仍是旧快照。
--       本迁移一次性把所有 pets.image_url 同步为对应 pet_shop_items.image_url。
update public.pets p
set image_url = s.image_url
from public.pet_shop_items s
where p.shop_item_id = s.id
  and p.image_url is distinct from s.image_url;
