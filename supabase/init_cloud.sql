-- ============================================================
-- My Planet 数据库初始化脚本（一次性执行）
-- 在 Supabase Dashboard → SQL Editor 中粘贴执行
-- ============================================================

-- 启用 pgcrypto 扩展（提供 crypt/gen_salt/gen_random_bytes）
create extension if not exists "pgcrypto";

-- ============================================================
-- 1. 建表
-- ============================================================

-- families：家庭
create table if not exists public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_user_id uuid references auth.users(id) on delete set null,
  parent_pin_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- members：家庭成员（1 家长 + N 孩子）
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

-- tasks：任务
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

-- task_templates：任务模板
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

-- items：商城商品
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

-- purchases：购买记录（券）
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

-- coin_records：金币流水
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

-- settings：键值配置
create table if not exists public.settings (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  key text not null,
  value jsonb,
  updated_at timestamptz not null default now(),
  unique(family_id, key)
);

-- ============================================================
-- 2. RLS 行级安全策略
-- ============================================================

alter table public.families enable row level security;
alter table public.members enable row level security;
alter table public.tasks enable row level security;
alter table public.task_templates enable row level security;
alter table public.items enable row level security;
alter table public.purchases enable row level security;
alter table public.coin_records enable row level security;
alter table public.settings enable row level security;

-- families：仅 owner 可读写
create policy "owner can read family" on public.families
  for select using (owner_user_id = auth.uid());
create policy "owner can write family" on public.families
  for all using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());

-- members
create policy "owner can read members" on public.members
  for select using (
    exists (select 1 from public.families f where f.id = members.family_id and f.owner_user_id = auth.uid())
  );
create policy "owner can write members" on public.members
  for all using (
    exists (select 1 from public.families f where f.id = members.family_id and f.owner_user_id = auth.uid())
  );

-- tasks
create policy "owner can read tasks" on public.tasks
  for select using (
    exists (select 1 from public.families f where f.id = tasks.family_id and f.owner_user_id = auth.uid())
  );
create policy "owner can write tasks" on public.tasks
  for all using (
    exists (select 1 from public.families f where f.id = tasks.family_id and f.owner_user_id = auth.uid())
  );

-- task_templates
create policy "owner can read templates" on public.task_templates
  for select using (
    exists (select 1 from public.families f where f.id = task_templates.family_id and f.owner_user_id = auth.uid())
  );
create policy "owner can write templates" on public.task_templates
  for all using (
    exists (select 1 from public.families f where f.id = task_templates.family_id and f.owner_user_id = auth.uid())
  );

-- items
create policy "owner can read items" on public.items
  for select using (
    exists (select 1 from public.families f where f.id = items.family_id and f.owner_user_id = auth.uid())
  );
create policy "owner can write items" on public.items
  for all using (
    exists (select 1 from public.families f where f.id = items.family_id and f.owner_user_id = auth.uid())
  );

-- purchases
create policy "owner can read purchases" on public.purchases
  for select using (
    exists (select 1 from public.families f where f.id = purchases.family_id and f.owner_user_id = auth.uid())
  );
create policy "owner can write purchases" on public.purchases
  for all using (
    exists (select 1 from public.families f where f.id = purchases.family_id and f.owner_user_id = auth.uid())
  );

-- coin_records
create policy "owner can read records" on public.coin_records
  for select using (
    exists (select 1 from public.families f where f.id = coin_records.family_id and f.owner_user_id = auth.uid())
  );

-- settings
create policy "owner can read settings" on public.settings
  for select using (
    exists (select 1 from public.families f where f.id = settings.family_id and f.owner_user_id = auth.uid())
  );
create policy "owner can write settings" on public.settings
  for all using (
    exists (select 1 from public.families f where f.id = settings.family_id and f.owner_user_id = auth.uid())
  );

-- ============================================================
-- 3. updated_at 触发器
-- ============================================================

create or replace function public.handle_updated_at()
returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger families_updated_at before update on public.families
  for each row execute function public.handle_updated_at();
create trigger members_updated_at before update on public.members
  for each row execute function public.handle_updated_at();
create trigger tasks_updated_at before update on public.tasks
  for each row execute function public.handle_updated_at();
create trigger items_updated_at before update on public.items
  for each row execute function public.handle_updated_at();

-- ============================================================
-- 4. RPC 函数（原子性保证）
-- ============================================================

-- complete_task：完成任务 → 加减金币 → 记账
create or replace function public.complete_task(p_task_id uuid, p_member_id uuid)
returns table(new_balance int, reward int)
language plpgsql security definer as $$
declare
  v_task public.tasks%rowtype;
  v_balance int;
  v_family_id uuid;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then raise exception '任务不存在'; end if;
  if v_task.status <> 'active' then raise exception '任务已不可完成'; end if;
  if v_task.member_id is not null and v_task.member_id <> p_member_id then
    raise exception '此任务不是指派给你的';
  end if;
  v_family_id := v_task.family_id;
  update public.tasks set status = 'completed', completed_by = p_member_id, completed_at = now(), updated_at = now() where id = p_task_id;
  select coin_balance into v_balance from public.members where id = p_member_id for update;
  if not found then raise exception '成员不存在'; end if;
  v_balance := v_balance + v_task.reward_coins;
  if v_balance < 0 then raise exception '金币余额不足，无法扣减'; end if;
  update public.members set coin_balance = v_balance, updated_at = now() where id = p_member_id;
  insert into public.coin_records (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by)
  values (v_family_id, p_member_id, v_task.reward_coins, v_balance, '任务完成: ' || v_task.title, 'task', 'task', v_task.id, p_member_id);
  return query select v_balance, v_task.reward_coins;
end;
$$;

-- purchase_item：购买商品 → 扣币 → 生成券码 → 记账
create or replace function public.purchase_item(p_item_id uuid, p_member_id uuid)
returns table(purchase_id uuid, code text, new_balance int)
language plpgsql security definer as $$
declare
  v_item public.items%rowtype;
  v_balance int;
  v_family_id uuid;
  v_code text;
  v_purchase_id uuid;
  v_expires_at timestamptz;
begin
  select * into v_item from public.items where id = p_item_id for update;
  if not found then raise exception '商品不存在'; end if;
  if v_item.status <> 'active' then raise exception '商品已下架'; end if;
  if v_item.expires_at is not null and v_item.expires_at < now() then raise exception '商品已过期'; end if;
  if v_item.stock is not null and v_item.stock <= 0 then raise exception '商品已售罄'; end if;
  v_family_id := v_item.family_id;
  select coin_balance into v_balance from public.members where id = p_member_id for update;
  if not found then raise exception '成员不存在'; end if;
  if v_balance < v_item.price then raise exception '金币不足'; end if;
  v_balance := v_balance - v_item.price;
  update public.members set coin_balance = v_balance, updated_at = now() where id = p_member_id;
  v_code := upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8));
  if v_item.voucher_validity_days is not null then
    v_expires_at := now() + (v_item.voucher_validity_days || ' days')::interval;
  else
    v_expires_at := null;
  end if;
  insert into public.purchases (family_id, item_id, item_name_snapshot, member_id, price_paid, code, expires_at)
  values (v_family_id, v_item.id, v_item.name, p_member_id, v_item.price, v_code, v_expires_at)
  returning id into v_purchase_id;
  if v_item.stock is not null then
    update public.items set stock = stock - 1, updated_at = now() where id = p_item_id;
  end if;
  insert into public.coin_records (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by)
  values (v_family_id, p_member_id, -v_item.price, v_balance, '商城购买: ' || v_item.name, 'purchase', 'purchase', v_purchase_id, p_member_id);
  return query select v_purchase_id, v_code, v_balance;
end;
$$;

-- redeem_purchase：核销券码
create or replace function public.redeem_purchase(p_purchase_id uuid, p_parent_id uuid)
returns void
language plpgsql security definer as $$
declare v_p public.purchases%rowtype;
begin
  select * into v_p from public.purchases where id = p_purchase_id for update;
  if not found then raise exception '券不存在'; end if;
  if v_p.status <> 'pending' then raise exception '券已核销或已失效'; end if;
  if v_p.expires_at is not null and v_p.expires_at < now() then
    update public.purchases set status = 'expired' where id = p_purchase_id;
    raise exception '券已过期';
  end if;
  update public.purchases set status = 'redeemed', redeemed_by = p_parent_id, redeemed_at = now() where id = p_purchase_id;
end;
$$;

-- adjust_coins：家长手动调整金币
create or replace function public.adjust_coins(p_member_id uuid, p_amount int, p_reason text, p_parent_id uuid)
returns table(new_balance int)
language plpgsql security definer as $$
declare v_family_id uuid; v_balance int;
begin
  select family_id, coin_balance into v_family_id, v_balance from public.members where id = p_member_id for update;
  if not found then raise exception '成员不存在'; end if;
  v_balance := v_balance + p_amount;
  if v_balance < 0 then raise exception '调整后余额不能为负'; end if;
  update public.members set coin_balance = v_balance, updated_at = now() where id = p_member_id;
  insert into public.coin_records (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by)
  values (v_family_id, p_member_id, p_amount, v_balance, '家长调整: ' || coalesce(p_reason, '无说明'), 'manual', 'manual', p_parent_id, p_parent_id);
  return query select v_balance;
end;
$$;

-- verify_parent_pin：验证家长 PIN
create or replace function public.verify_parent_pin(p_pin text)
returns boolean
language plpgsql security definer as $$
declare v_hash text;
begin
  select parent_pin_hash into v_hash from public.families where owner_user_id = auth.uid();
  return v_hash is not null and crypt(p_pin, v_hash) = v_hash;
end;
$$;

-- init_family：初始化家庭（首次设置）
create or replace function public.init_family(p_name text, p_pin text, p_child_name text, p_child_emoji text)
returns table(family_id uuid, member_id uuid)
language plpgsql security definer as $$
declare v_fam_id uuid; v_mem_id uuid; v_pin_hash text;
begin
  v_pin_hash := crypt(p_pin, gen_salt('bf'));
  insert into public.families (name, owner_user_id, parent_pin_hash)
  values (p_name, auth.uid(), v_pin_hash) returning id into v_fam_id;
  insert into public.members (family_id, name, role, avatar_emoji, display_order)
  values (v_fam_id, p_name, 'parent', '👑', 0);
  insert into public.members (family_id, name, role, avatar_emoji, display_order)
  values (v_fam_id, p_child_name, 'child', coalesce(p_child_emoji, '🦁'), 1) returning id into v_mem_id;
  return query select v_fam_id, v_mem_id;
end;
$$;

-- add_child：添加孩子
create or replace function public.add_child(p_family_id uuid, p_name text, p_emoji text)
returns uuid
language plpgsql security definer as $$
declare v_id uuid; v_max_order int;
begin
  select coalesce(max(display_order), 0) into v_max_order from public.members where family_id = p_family_id;
  insert into public.members (family_id, name, role, avatar_emoji, display_order)
  values (p_family_id, p_name, 'child', coalesce(p_emoji, '🦁'), v_max_order + 1) returning id into v_id;
  return v_id;
end;
$$;

-- 授权 anon 角色可执行这些 RPC
grant execute on function public.complete_task(uuid, uuid) to anon, authenticated;
grant execute on function public.purchase_item(uuid, uuid) to anon, authenticated;
grant execute on function public.redeem_purchase(uuid, uuid) to anon, authenticated;
grant execute on function public.adjust_coins(uuid, int, text, uuid) to anon, authenticated;
grant execute on function public.verify_parent_pin(text) to anon, authenticated;
grant execute on function public.init_family(text, text, text, text) to anon, authenticated;
grant execute on function public.add_child(uuid, text, text) to anon, authenticated;

-- ============================================================
-- 执行成功！数据库初始化完成。
-- ============================================================
