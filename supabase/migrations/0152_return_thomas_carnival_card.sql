-- 退回 Thomas 抽到的"游乐场狂欢卡"
-- 删除 Thomas 名下 status='pending' 的游乐场狂欢卡购买记录

delete from public.purchases
where member_id = (select id from public.members where name = 'Thomas' limit 1)
  and item_name_snapshot = '游乐场狂欢卡'
  and status = 'pending';
