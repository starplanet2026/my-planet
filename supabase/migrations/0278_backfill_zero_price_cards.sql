-- 0278: 补齐背包内非稀有 0 元特权卡的价格
-- 背景：0277 已修复大转盘来源卡券的价格同步；本次将剩余手动发放等来源的
--       pending 状态、price_paid=0 的非稀有特权卡价格同步为 items.price，
--       保证出售返还按兑换页同卡价格计算。
-- 注意：排除「幸运大转盘」转盘券本身（消耗券，不作出售计价）。

update public.purchases p
set price_paid = i.price
from public.items i
where p.item_id = i.id
  and p.status = 'pending'
  and p.price_paid = 0
  and i.category <> '稀有'
  and i.name <> '幸运大转盘'
  and i.price > 0;

notify pgrst, 'reload schema';
