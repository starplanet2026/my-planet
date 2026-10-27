-- 0293: 超级管理员账号 + 公共模板库 + 新功能灰度下发开关
-- 说明：
--   1) app_admins：超级管理员名单（按 auth 用户维度，与家庭无关）。
--   2) app_feature_flags：新功能/模块灰度开关，默认仅超级管理员可见；
--      管理员点击「应用全局」后 is_global=true，普通用户才可见可用。
--   3) achievement_templates / privilege_templates：公共模板库（全局，不隶属任何家庭）。
--      所有人可读（受开关控制），仅超级管理员可增/改/删。
--      普通用户「调取」= 把模板字段复制一份写入自己家庭的 tasks / items，互不影响。
--   4) 原有个人成就卡（tasks）/ 特权卡（items）逻辑完全不动。

-- ============================================================
-- 一、超级管理员名单
-- ============================================================
create table if not exists public.app_admins (
  user_id uuid primary key,
  phone text,
  note text,
  created_at timestamptz not null default now()
);

alter table public.app_admins enable row level security;
-- 不开任何 policy：普通请求无法直接读写，只能通过下方 SECURITY DEFINER 函数判断

create or replace function public.is_super_admin(p_user uuid default auth.uid())
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.app_admins where user_id = p_user);
$$;

grant execute on function public.is_super_admin(uuid) to authenticated, anon;

-- 标记手机号 18301930238 对应的账号为超级管理员
-- 该手机号在 auth 中同时存在「手机号注册」与「163 邮箱注册」两条记录，均视为超级管理员
insert into public.app_admins (user_id, phone, note)
values
  ('705e8487-9fb2-4a15-8158-1ef5264bb14b', '+8618301930238', '超级管理员（手机号注册）'),
  ('d4d6eee8-39a1-445f-8a9e-b118c328f476', '18301930238', '超级管理员（同手机号邮箱注册）')
on conflict (user_id) do nothing;

-- ============================================================
-- 二、新功能灰度开关
-- ============================================================
create table if not exists public.app_feature_flags (
  key text primary key,
  name text not null,
  description text,
  is_global boolean not null default false,
  sort_order int not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.app_feature_flags enable row level security;

drop policy if exists "app_feature_flags_select" on public.app_feature_flags;
create policy "app_feature_flags_select" on public.app_feature_flags
  for select to authenticated using (true);

drop policy if exists "app_feature_flags_admin_write" on public.app_feature_flags;
create policy "app_feature_flags_admin_write" on public.app_feature_flags
  for update to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- 首期新增模块：公共模板库（默认仅超级管理员可见）
insert into public.app_feature_flags (key, name, description, is_global, sort_order)
values ('template_library', '公共模板库', '成就卡 / 特权卡公共模板，可一键调取到个人库', false, 10)
on conflict (key) do nothing;

-- 当前登录账号的应用上下文：是否超级管理员 + 各功能是否已应用全局
create or replace function public.get_my_app_context()
returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'is_super_admin', public.is_super_admin(auth.uid()),
    'features', coalesce(
      (select json_object_agg(key, is_global) from public.app_feature_flags),
      '{}'::json
    )
  );
$$;

grant execute on function public.get_my_app_context() to authenticated;

-- ============================================================
-- 三、公共模板库：成就模板
-- ============================================================
create table if not exists public.achievement_templates (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  category text not null default 'daily',
  reward_coins int not null default 1,
  icon text,
  repeat_days int[] default '{}',
  priority int not null default 0,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.achievement_templates enable row level security;

drop policy if exists "achievement_templates_read" on public.achievement_templates;
create policy "achievement_templates_read" on public.achievement_templates
  for select to authenticated
  using (
    public.is_super_admin()
    or coalesce((select is_global from public.app_feature_flags where key = 'template_library'), false)
  );

drop policy if exists "achievement_templates_admin_insert" on public.achievement_templates;
create policy "achievement_templates_admin_insert" on public.achievement_templates
  for insert to authenticated with check (public.is_super_admin());

drop policy if exists "achievement_templates_admin_update" on public.achievement_templates;
create policy "achievement_templates_admin_update" on public.achievement_templates
  for update to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists "achievement_templates_admin_delete" on public.achievement_templates;
create policy "achievement_templates_admin_delete" on public.achievement_templates
  for delete to authenticated using (public.is_super_admin());

-- ============================================================
-- 四、公共模板库：特权模板
-- ============================================================
create table if not exists public.privilege_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  price int not null default 1,
  image_url text,
  category text,
  weekly_limit int,
  stock int,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.privilege_templates enable row level security;

drop policy if exists "privilege_templates_read" on public.privilege_templates;
create policy "privilege_templates_read" on public.privilege_templates
  for select to authenticated
  using (
    public.is_super_admin()
    or coalesce((select is_global from public.app_feature_flags where key = 'template_library'), false)
  );

drop policy if exists "privilege_templates_admin_insert" on public.privilege_templates;
create policy "privilege_templates_admin_insert" on public.privilege_templates
  for insert to authenticated with check (public.is_super_admin());

drop policy if exists "privilege_templates_admin_update" on public.privilege_templates;
create policy "privilege_templates_admin_update" on public.privilege_templates
  for update to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists "privilege_templates_admin_delete" on public.privilege_templates;
create policy "privilege_templates_admin_delete" on public.privilege_templates
  for delete to authenticated using (public.is_super_admin());
