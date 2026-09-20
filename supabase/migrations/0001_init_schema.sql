-- My Planet: 初始表结构
-- 7 张表：families / members / tasks / task_templates / items / purchases / coin_records / settings

create extension if not exists "pgcrypto";

-- 1. families：家庭
create table if not exists public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_user_id uuid references auth.users(id) on delete set null,
  parent_pin_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. members：家庭成员（1 家长 + N 孩子）
create table if not exists public.members (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  name text not null,
  role text not null check (role in ('parent','child')),
  avatar_emoji text not null default '🦁',
  coin_balance int not null default 0 check (coin_balance >= 0),
  display_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_members_family on public.members(family_id);

-- 3. tasks：任务
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  member_id uuid references public.members(id) on delete cascade,
  title text not null,
  description text,
  category text not null check (category in ('daily','stage','super','black')),
  reward_coins int not null,
  deadline timestamptz,
  status text not null default 'active' check (status in ('active','completed','expired','deleted')),
  completed_by uuid references public.members(id),
  completed_at timestamptz,
  created_by uuid not null references public.members(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_tasks_family on public.tasks(family_id, category, status);

-- 4. task_templates：任务模板
create table if not exists public.task_templates (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  title text not null,
  description text,
  category text not null check (category in ('daily','stage','super','black')),
  reward_coins int not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_templates_family on public.task_templates(family_id);

-- 5. items：商城商品
create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  name text not null,
  description text,
  price int not null check (price > 0),
  image_url text,
  expires_at timestamptz,
  voucher_validity_days int,
  status text not null default 'active' check (status in ('active','sold_out','expired','deleted')),
  stock int,
  created_by uuid not null references public.members(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_items_family on public.items(family_id, status);

-- 6. purchases：购买记录（券）
create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete restrict,
  item_name_snapshot text not null,
  member_id uuid not null references public.members(id) on delete cascade,
  price_paid int not null,
  code text not null,
  status text not null default 'pending' check (status in ('pending','redeemed','expired','cancelled')),
  redeemed_by uuid references public.members(id),
  redeemed_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique(code)
);
create index if not exists idx_purchases_family on public.purchases(family_id, status);
create index if not exists idx_purchases_member on public.purchases(member_id, status);

-- 7. coin_records：金币流水
create table if not exists public.coin_records (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  amount int not null,
  balance_after int not null,
  reason text not null,
  category text not null check (category in ('task','purchase','manual','system')),
  ref_type text,
  ref_id uuid,
  created_by uuid not null references public.members(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_records_family on public.coin_records(family_id, member_id, created_at desc);

-- 8. settings：键值配置
create table if not exists public.settings (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  key text not null,
  value jsonb,
  updated_at timestamptz not null default now(),
  unique(family_id, key)
);
