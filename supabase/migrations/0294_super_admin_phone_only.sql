-- 0294: 超级管理员仅保留「手机号注册」账号
-- 需求变更：同号 163 邮箱注册的账号（18301930238@163.com）不设为超级管理员，按普通用户处理。
-- 0293 同时写入了手机号注册（705e8487-...）与同号邮箱注册（d4d6eee8-...）两条记录，这里移除邮箱那条。

delete from public.app_admins
where user_id = 'd4d6eee8-39a1-445f-8a9e-b118c328f476';

-- 兜底：仅保留手机号注册账号，其余同号账号一律移出管理员名单
delete from public.app_admins
where phone is not null
  and phone <> '+8618301930238';
