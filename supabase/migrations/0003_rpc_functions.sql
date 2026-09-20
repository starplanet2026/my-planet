-- My Planet: RPC 函数（原子性保证）
-- 所有金币变动操作在 Postgres 单事务内完成
-- 使用 security definer + FOR UPDATE 行锁确保并发安全

-- 1. complete_task：完成任务 → 加减金币 → 记账
create or replace function public.complete_task(p_task_id uuid, p_member_id uuid)
returns table(new_balance int, reward int)
language plpgsql security definer as $$
declare
  v_task public.tasks%rowtype;
  v_balance int;
  v_family_id uuid;
begin
  -- 锁定任务行
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise exception '任务不存在';
  end if;
  if v_task.status <> 'active' then
    raise exception '任务已不可完成';
  end if;
  -- 如果任务指派了特定成员，校验是否匹配
  if v_task.member_id is not null and v_task.member_id <> p_member_id then
    raise exception '此任务不是指派给你的';
  end if;

  v_family_id := v_task.family_id;

  -- 更新任务状态
  update public.tasks
    set status = 'completed', completed_by = p_member_id, completed_at = now(), updated_at = now()
    where id = p_task_id;

  -- 锁定成员行并更新余额
  select coin_balance into v_balance from public.members where id = p_member_id for update;
  if not found then
    raise exception '成员不存在';
  end if;
  v_balance := v_balance + v_task.reward_coins;
  if v_balance < 0 then
    raise exception '金币余额不足，无法扣减';
  end if;
  update public.members set coin_balance = v_balance, updated_at = now() where id = p_member_id;

  -- 记流水
  insert into public.coin_records (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by)
  values (v_family_id, p_member_id, v_task.reward_coins, v_balance,
          '任务完成: ' || v_task.title, 'task', 'task', v_task.id, p_member_id);

  return query select v_balance, v_task.reward_coins;
end;
$$;

-- 2. purchase_item：购买商品 → 扣币 → 生成券码 → 记账
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
  -- 锁定商品行
  select * into v_item from public.items where id = p_item_id for update;
  if not found then
    raise exception '商品不存在';
  end if;
  if v_item.status <> 'active' then
    raise exception '商品已下架';
  end if;
  if v_item.expires_at is not null and v_item.expires_at < now() then
    raise exception '商品已过期';
  end if;
  if v_item.stock is not null and v_item.stock <= 0 then
    raise exception '商品已售罄';
  end if;

  v_family_id := v_item.family_id;

  -- 锁定成员行并校验余额
  select coin_balance into v_balance from public.members where id = p_member_id for update;
  if not found then
    raise exception '成员不存在';
  end if;
  if v_balance < v_item.price then
    raise exception '金币不足';
  end if;

  -- 扣币
  v_balance := v_balance - v_item.price;
  update public.members set coin_balance = v_balance, updated_at = now() where id = p_member_id;

  -- 生成 8 位券码
  v_code := upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8));

  -- 计算券到期时间
  if v_item.voucher_validity_days is not null then
    v_expires_at := now() + (v_item.voucher_validity_days || ' days')::interval;
  else
    v_expires_at := null;
  end if;

  -- 插入购买记录
  insert into public.purchases (family_id, item_id, item_name_snapshot, member_id, price_paid, code, expires_at)
  values (v_family_id, v_item.id, v_item.name, p_member_id, v_item.price, v_code, v_expires_at)
  returning id into v_purchase_id;

  -- 扣库存
  if v_item.stock is not null then
    update public.items set stock = stock - 1, updated_at = now() where id = p_item_id;
  end if;

  -- 记流水
  insert into public.coin_records (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by)
  values (v_family_id, p_member_id, -v_item.price, v_balance,
          '商城购买: ' || v_item.name, 'purchase', 'purchase', v_purchase_id, p_member_id);

  return query select v_purchase_id, v_code, v_balance;
end;
$$;

-- 3. redeem_purchase：核销券码
create or replace function public.redeem_purchase(p_purchase_id uuid, p_parent_id uuid)
returns void
language plpgsql security definer as $$
declare
  v_p public.purchases%rowtype;
begin
  select * into v_p from public.purchases where id = p_purchase_id for update;
  if not found then
    raise exception '券不存在';
  end if;
  if v_p.status <> 'pending' then
    raise exception '券已核销或已失效';
  end if;
  if v_p.expires_at is not null and v_p.expires_at < now() then
    update public.purchases set status = 'expired' where id = p_purchase_id;
    raise exception '券已过期';
  end if;
  update public.purchases
    set status = 'redeemed', redeemed_by = p_parent_id, redeemed_at = now()
    where id = p_purchase_id;
end;
$$;

-- 4. adjust_coins：家长手动调整金币
create or replace function public.adjust_coins(p_member_id uuid, p_amount int, p_reason text, p_parent_id uuid)
returns table(new_balance int)
language plpgsql security definer as $$
declare
  v_family_id uuid;
  v_balance int;
begin
  select family_id, coin_balance into v_family_id, v_balance from public.members where id = p_member_id for update;
  if not found then
    raise exception '成员不存在';
  end if;
  v_balance := v_balance + p_amount;
  if v_balance < 0 then
    raise exception '调整后余额不能为负';
  end if;
  update public.members set coin_balance = v_balance, updated_at = now() where id = p_member_id;
  insert into public.coin_records (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by)
  values (v_family_id, p_member_id, p_amount, v_balance,
          '家长调整: ' || coalesce(p_reason, '无说明'), 'manual', 'manual', p_parent_id, p_parent_id);
  return query select v_balance;
end;
$$;

-- 5. verify_parent_pin：验证家长 PIN
create or replace function public.verify_parent_pin(p_pin text)
returns boolean
language plpgsql security definer as $$
declare
  v_hash text;
begin
  select parent_pin_hash into v_hash from public.families where owner_user_id = auth.uid();
  return v_hash is not null and crypt(p_pin, v_hash) = v_hash;
end;
$$;

-- 6. init_family：初始化家庭（首次设置）
create or replace function public.init_family(p_name text, p_pin text, p_child_name text, p_child_emoji text)
returns table(family_id uuid, member_id uuid)
language plpgsql security definer as $$
declare
  v_fam_id uuid;
  v_mem_id uuid;
  v_pin_hash text;
begin
  v_pin_hash := crypt(p_pin, gen_salt('bf'));
  insert into public.families (name, owner_user_id, parent_pin_hash)
  values (p_name, auth.uid(), v_pin_hash)
  returning id into v_fam_id;

  -- 家长成员行
  insert into public.members (family_id, name, role, avatar_emoji, display_order)
  values (v_fam_id, p_name, 'parent', '👑', 0);

  -- 第一个孩子
  insert into public.members (family_id, name, role, avatar_emoji, display_order)
  values (v_fam_id, p_child_name, 'child', coalesce(p_child_emoji, '🦁'), 1)
  returning id into v_mem_id;

  return query select v_fam_id, v_mem_id;
end;
$$;

-- 7. add_child：添加孩子
create or replace function public.add_child(p_family_id uuid, p_name text, p_emoji text)
returns uuid
language plpgsql security definer as $$
declare
  v_id uuid;
  v_max_order int;
begin
  select coalesce(max(display_order), 0) into v_max_order from public.members where family_id = p_family_id;
  insert into public.members (family_id, name, role, avatar_emoji, display_order)
  values (p_family_id, p_name, 'child', coalesce(p_emoji, '🦁'), v_max_order + 1)
  returning id into v_id;
  return v_id;
end;
$$;

-- 给所有 RPC 显式授权 anon 角色（MVP 简化，实际依赖 RLS + PIN 保护）
grant execute on function public.complete_task(uuid, uuid) to anon, authenticated;
grant execute on function public.purchase_item(uuid, uuid) to anon, authenticated;
grant execute on function public.redeem_purchase(uuid, uuid) to anon, authenticated;
grant execute on function public.adjust_coins(uuid, int, text, uuid) to anon, authenticated;
grant execute on function public.verify_parent_pin(text) to anon, authenticated;
grant execute on function public.init_family(text, text, text, text) to anon, authenticated;
grant execute on function public.add_child(uuid, text, text) to anon, authenticated;
