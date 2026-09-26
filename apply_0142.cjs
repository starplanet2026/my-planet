const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
(async () => {
  const client = new Client({
    host: 'db.zsqnpwvkbkwiokokldfv.supabase.co', port: 5432,
    user: 'postgres', password: '2OLvZyeTzglU0nID', database: 'postgres',
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  console.log('执行 0142 迁移...');
  const stmts = [
    `create table if not exists public.purchase_usage_records (
      id uuid primary key default gen_random_uuid(),
      family_id uuid not null references public.families(id) on delete cascade,
      member_id uuid not null references public.members(id) on delete cascade,
      purchase_id uuid references public.purchases(id) on delete set null,
      item_id uuid references public.items(id) on delete set null,
      item_name text,
      used_at timestamptz not null default now()
    )`,
    `create index if not exists idx_purchase_usage_member_item on public.purchase_usage_records(member_id, item_id)`,
    `create index if not exists idx_purchase_usage_used_at on public.purchase_usage_records(used_at)`,
    `alter table public.purchase_usage_records enable row level security`,
    `drop policy if exists "家庭成员可查看使用记录" on public.purchase_usage_records`,
    `create policy "家庭成员可查看使用记录" on public.purchase_usage_records for select using (family_id in (select id from public.families))`,
    `drop policy if exists "家庭成员可插入使用记录" on public.purchase_usage_records`,
    `create policy "家庭成员可插入使用记录" on public.purchase_usage_records for insert with check (family_id is not null)`,
    `drop function if exists public.redeem_purchase(uuid, uuid)`,
    `create or replace function public.redeem_purchase(p_purchase_id uuid, p_member_id uuid) returns void language plpgsql security definer as $$
declare
  v_p public.purchases%rowtype;
  v_item public.items%rowtype;
  v_weekly_count int;
  v_week_start timestamptz;
begin
  v_week_start := date_trunc('week', now());
  select * into v_p from public.purchases where id = p_purchase_id for update;
  if not found then raise exception '特权卡不存在'; end if;
  if v_p.status <> 'pending' then raise exception '特权卡已使用或已出售'; end if;
  if v_p.member_id <> p_member_id then raise exception '无权操作'; end if;
  select * into v_item from public.items where id = v_p.item_id;
  if v_item.weekly_limit is not null and v_item.weekly_limit > 0 then
    select count(*) into v_weekly_count from public.purchase_usage_records where member_id = p_member_id and item_id = v_p.item_id and used_at >= v_week_start;
    if v_weekly_count >= v_item.weekly_limit then
      raise exception '本周该特权卡已达到使用上限（%s次），请下周再使用', v_item.weekly_limit;
    end if;
  end if;
  if v_p.quantity > 1 then
    update public.purchases set quantity = quantity - 1, updated_at = now() where id = p_purchase_id;
  else
    update public.purchases set status = 'redeemed', redeemed_by = p_member_id, redeemed_at = now() where id = p_purchase_id;
  end if;
  insert into public.purchase_usage_records (family_id, member_id, purchase_id, item_id, item_name) values (v_p.family_id, p_member_id, p_purchase_id, v_p.item_id, v_p.item_name_snapshot);
end;
$$`,
    `drop function if exists public.sell_purchase(uuid, uuid)`,
    `drop function if exists public.sell_purchase(uuid, uuid, int)`,
    `create or replace function public.sell_purchase(p_purchase_id uuid, p_member_id uuid, p_quantity int default 1) returns table(new_balance numeric, refund numeric) language plpgsql security definer as $$
declare
  v_p public.purchases%rowtype;
  v_member public.members%rowtype;
  v_refund numeric;
  v_sell_qty int;
begin
  if p_quantity is null or p_quantity < 1 then p_quantity := 1; end if;
  select * into v_p from public.purchases where id = p_purchase_id for update;
  if not found then raise exception '特权卡不存在'; end if;
  if v_p.status <> 'pending' then raise exception '特权卡已使用或已出售'; end if;
  if v_p.member_id <> p_member_id then raise exception '无权操作'; end if;
  if p_quantity > v_p.quantity then raise exception '出售数量超过持有数量'; end if;
  v_sell_qty := least(p_quantity, v_p.quantity);
  v_refund := floor(v_p.price_paid * v_sell_qty * 0.9);
  if v_sell_qty < v_p.quantity then
    update public.purchases set quantity = quantity - v_sell_qty, updated_at = now() where id = p_purchase_id;
  else
    update public.purchases set status = 'sold', redeemed_at = now() where id = p_purchase_id;
  end if;
  select * into v_member from public.members where id = p_member_id for update;
  if not found then raise exception '成员不存在'; end if;
  update public.members set coin_balance = coin_balance + v_refund, updated_at = now() where id = p_member_id;
  insert into public.coin_records (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by, balance_type) values (v_p.family_id, p_member_id, v_refund, v_member.coin_balance + v_refund, '背包出售特权卡：' || v_p.item_name_snapshot || ' x' || v_sell_qty, 'shop', 'purchase', v_p.id, p_member_id, 'coin');
  return query select v_member.coin_balance + v_refund, v_refund;
end;
$$`,
    `grant select, insert on public.purchase_usage_records to anon, authenticated`,
    `grant execute on function public.redeem_purchase(uuid, uuid) to anon, authenticated`,
    `grant execute on function public.sell_purchase(uuid, uuid, int) to anon, authenticated`,
    `create or replace function public.cleanup_old_records() returns void language plpgsql security definer as $$
begin
  delete from public.pet_boarding_log where created_at < now() - interval '30 days';
  delete from public.question_records where answered_at < now() - interval '30 days';
  delete from public.dictation_records where created_at < now() - interval '30 days';
  delete from public.tasks where created_at < now() - interval '30 days';
  delete from public.coin_records where created_at < now() - interval '30 days';
  delete from public.pet_messages where created_at < now() - interval '30 days';
  delete from public.purchase_usage_records where used_at < now() - interval '30 days';
end;
$$`,
    `notify pgrst, 'reload schema'`,
  ];
  for (let i = 0; i < stmts.length; i++) {
    try {
      await client.query(stmts[i]);
      console.log(`  ✅ 语句 ${i+1}/${stmts.length}`);
    } catch (e) {
      console.error(`  ❌ 语句 ${i+1}: ${e.message}`);
      throw e;
    }
  }
  console.log('✅ 0142 全部完成');
  await client.end();
})();
