-- 0015: pet_shop_items 加 gender 列
alter table public.pet_shop_items add column if not exists gender text;
