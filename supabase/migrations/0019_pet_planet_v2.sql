-- ============================================================
-- 0019: 萌宠星球 V2（完整养成游戏重构）
-- 1. 重构 pet_shop_items 分类体系（type=pet/supply + subcategory）
-- 2. 新增表：pet_inventory(背包) / pet_checkin(签到) / dog_house(狗窝) / pet_words(单词) / pet_word_progress(游戏进度)
-- 3. 重写 RPC：buy_pet_item(用品存背包) / interact_with_pet(消耗背包物品)
-- 4. 新增 RPC：pet_checkin / upgrade_dog_house / get_dog_house / finish_word_match
-- ============================================================

-- 0. 先删除返回类型变更的旧函数（CREATE OR REPLACE 不支持改返回类型）
drop function if exists public.buy_pet_item(uuid, uuid);
drop function if exists public.interact_with_pet(uuid, uuid, text);

-- ============================================================
-- 1. 重构 pet_shop_items 分类体系
-- ============================================================

-- 1.1 添加 subcategory 列
alter table public.pet_shop_items add column if not exists subcategory text;

-- 1.2 数据迁移：旧分类 → 新分类
-- 用品类（food/toy/medicine）→ type='supply', subcategory=原值
update public.pet_shop_items set subcategory = type, type = 'supply' where type in ('food','toy','medicine');
-- 宠物类（pet）→ subcategory='dog'（0017 种子全是狗）
update public.pet_shop_items set subcategory = 'dog' where type = 'pet' and subcategory is null;

-- 1.3 替换 type CHECK 约束
alter table public.pet_shop_items drop constraint if exists pet_shop_items_type_check;
alter table public.pet_shop_items add constraint pet_shop_items_type_check check (type in ('pet','supply'));

-- 1.4 添加 subcategory CHECK 约束
alter table public.pet_shop_items add constraint pet_shop_items_subcategory_check
  check (subcategory in ('dog','cat','food','clean','toy','medicine','foster'));

-- ============================================================
-- 2. 新增表
-- ============================================================

-- 2.1 pet_inventory：背包
create table if not exists public.pet_inventory (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  item_id uuid not null references public.pet_shop_items(id) on delete cascade,
  item_name_snapshot text not null,
  item_emoji text,
  item_image_url text,
  subcategory text not null,
  quantity int not null default 1,
  created_at timestamptz not null default now(),
  unique (member_id, item_id)
);
create index if not exists idx_pet_inventory_member on public.pet_inventory(member_id);

-- 2.2 pet_checkin：签到记录
create table if not exists public.pet_checkin (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  checkin_date date not null,
  consecutive_days int not null default 1,
  cycle_day int not null default 1,
  star_rewarded int not null default 1,
  created_at timestamptz not null default now(),
  unique (member_id, checkin_date)
);
create index if not exists idx_pet_checkin_member on public.pet_checkin(member_id);

-- 2.3 dog_house：狗窝
create table if not exists public.dog_house (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  level int not null default 1,
  capacity int not null default 3,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (member_id)
);
create index if not exists idx_dog_house_member on public.dog_house(member_id);

-- 2.4 pet_words：单词消消乐词库
create table if not exists public.pet_words (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  word_en text not null,
  word_cn text not null,
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now()
);
create index if not exists idx_pet_words_family on public.pet_words(family_id);

-- 2.5 pet_word_progress：单词游戏进度
create table if not exists public.pet_word_progress (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  total_rounds int not null default 0,
  total_matched int not null default 0,
  best_score int not null default 0,
  last_played_at timestamptz,
  unique (member_id)
);
create index if not exists idx_pet_word_progress_member on public.pet_word_progress(member_id);

-- ============================================================
-- 3. 重写 RPC
-- ============================================================

-- 3.1 buy_pet_item（重写）：购买宠物不变；购买用品存入背包
create or replace function public.buy_pet_item(
  p_member_id uuid,
  p_item_id uuid
)
returns table(success boolean, message text, new_star int, new_coin int, pet_id uuid, inventory_qty int)
language plpgsql security definer as $$
declare
  v_item public.pet_shop_items%rowtype;
  v_member public.members%rowtype;
  v_star int;
  v_coin int;
  v_family_id uuid;
  v_pet_id uuid := null;
  v_inv_qty int := 0;
begin
  select * into v_item from public.pet_shop_items where id = p_item_id and status = 'active';
  if not found then return query select false, '商品不存在或已下架', 0, 0, null, 0; return; end if;

  select * into v_member from public.members where id = p_member_id for update;
  v_family_id := v_member.family_id;
  v_star := v_member.star_value;
  v_coin := v_member.coin_balance;

  if v_star < v_item.price_star then
    return query select false, '星光值不足', v_star, v_coin, null, 0; return;
  end if;

  -- 扣星光值
  v_star := v_star - v_item.price_star;
  update public.members set star_value = v_star, updated_at = now() where id = p_member_id;

  if v_item.type = 'pet' then
    -- 购买宠物：创建宠物记录
    insert into public.pets (family_id, member_id, shop_item_id, name, emoji, image_url, base_coin_per_day, upgrade_coin_reward, coin_balance)
    values (v_family_id, p_member_id, v_item.id, '新宠物', v_item.emoji, v_item.image_url, v_item.base_coin_per_day, v_item.price_coin, 0)
    returning id into v_pet_id;
    return query select true, '购买成功！请给宠物取个名字', v_star, v_coin, v_pet_id, 0;
  else
    -- 购买用品：存入背包（ON CONFLICT 累加数量）
    insert into public.pet_inventory (family_id, member_id, item_id, item_name_snapshot, item_emoji, item_image_url, subcategory, quantity)
    values (v_family_id, p_member_id, p_item_id, coalesce(v_item.name, '用品'), v_item.emoji, v_item.image_url, v_item.subcategory, 1)
    on conflict (member_id, item_id) do update set quantity = pet_inventory.quantity + 1
    returning quantity into v_inv_qty;
    return query select true, '已购买并存入背包', v_star, v_coin, null, v_inv_qty;
  end if;
end;
$$;

-- 3.2 interact_with_pet（重写）：消耗背包物品互动
create or replace function public.interact_with_pet(
  p_member_id uuid,
  p_pet_id uuid,
  p_action text,
  p_item_id uuid
)
returns table(success boolean, message text, new_hunger int, new_clean int, new_happiness int, new_health int, inventory_qty int)
language plpgsql security definer as $$
declare
  v_pet public.pets%rowtype;
  v_inv public.pet_inventory%rowtype;
  v_item public.pet_shop_items%rowtype;
  v_required_sub text;
  v_msg text;
begin
  select * into v_pet from public.pets where id = p_pet_id for update;
  if not found then return query select false, '宠物不存在', 0, 0, 0, 0, 0; return; end if;
  if v_pet.member_id <> p_member_id then return query select false, '无权操作', 0, 0, 0, 0, 0; return; end if;

  -- 确定 action 对应的 subcategory
  if p_action = 'feed' then v_required_sub := 'food';
  elsif p_action = 'clean' then v_required_sub := 'clean';
  elsif p_action = 'play' then v_required_sub := 'toy';
  elsif p_action = 'heal' then v_required_sub := 'medicine';
  else return query select false, '未知操作', 0, 0, 0, 0, 0; return; end if;

  -- 治疗需宠物生病
  if p_action = 'heal' and not v_pet.is_sick then
    return query select false, '宠物没有生病', v_pet.hunger, v_pet.clean, v_pet.happiness, v_pet.health, 0; return;
  end if;

  -- 校验背包物品
  select * into v_inv from public.pet_inventory where member_id = p_member_id and item_id = p_item_id for update;
  if not found or v_inv.quantity <= 0 then
    return query select false, '背包无此物品', v_pet.hunger, v_pet.clean, v_pet.happiness, v_pet.health, 0; return;
  end if;
  if v_inv.subcategory <> v_required_sub then
    return query select false, '物品类型不匹配', v_pet.hunger, v_pet.clean, v_pet.happiness, v_pet.health, v_inv.quantity; return;
  end if;

  -- 扣减背包物品
  v_inv.quantity := v_inv.quantity - 1;
  if v_inv.quantity <= 0 then
    delete from public.pet_inventory where id = v_inv.id;
  else
    update public.pet_inventory set quantity = v_inv.quantity where id = v_inv.id;
  end if;

  -- 更新宠物状态
  if p_action = 'feed' then
    v_pet.hunger := least(100, v_pet.hunger + 20);
    v_msg := '喂食成功，饱腹值+20';
  elsif p_action = 'clean' then
    v_pet.clean := least(100, v_pet.clean + 20);
    v_msg := '清洁成功，清洁值+20';
  elsif p_action = 'play' then
    v_pet.happiness := least(100, v_pet.happiness + 20);
    v_msg := '玩耍成功，心情值+20';
  elsif p_action = 'heal' then
    v_pet.is_sick := false;
    v_pet.health := 100;
    v_pet.hunger := 50;
    v_pet.clean := 50;
    v_pet.happiness := 50;
    v_msg := '治疗成功，宠物已恢复健康';
  end if;

  update public.pets set
    hunger = v_pet.hunger, clean = v_pet.clean, happiness = v_pet.happiness,
    health = v_pet.health, is_sick = v_pet.is_sick
  where id = p_pet_id;

  insert into public.pet_actions (pet_id, member_id, action_type, star_cost, coin_cost)
  values (p_pet_id, p_member_id, p_action, 0, 0);

  return query select true, v_msg, v_pet.hunger, v_pet.clean, v_pet.happiness, v_pet.health, v_inv.quantity;
end;
$$;

-- ============================================================
-- 4. 新增 RPC
-- ============================================================

-- 4.1 pet_checkin：签到
create or replace function public.pet_checkin(
  p_member_id uuid
)
returns table(success boolean, message text, star_rewarded int, new_star int, consecutive_days int, cycle_day int, already_checked boolean)
language plpgsql security definer as $$
declare
  v_member public.members%rowtype;
  v_last public.pet_checkin%rowtype;
  v_family_id uuid;
  v_today date := current_date;
  v_consec int := 1;
  v_cycle int := 1;
  v_reward int := 1;
  v_star int;
begin
  select * into v_member from public.members where id = p_member_id for update;
  v_family_id := v_member.family_id;
  v_star := v_member.star_value;

  -- 查最近一条签到记录
  select * into v_last from public.pet_checkin where member_id = p_member_id order by checkin_date desc limit 1;

  if v_last.checkin_date = v_today then
    -- 今日已签到
    return query select false, '今日已签到', 0, v_star, v_last.consecutive_days, v_last.cycle_day, true;
    return;
  end if;

  if v_last.checkin_date = v_today - 1 then
    -- 连续签到
    v_consec := v_last.consecutive_days + 1;
    v_cycle := (v_last.cycle_day % 5) + 1;
  else
    -- 断签
    v_consec := 1;
    v_cycle := 1;
  end if;

  -- 奖励：1-4天 +1，第5天 +4
  if v_cycle <= 4 then v_reward := 1;
  else v_reward := 4; end if;

  v_star := v_star + v_reward;
  update public.members set star_value = v_star, updated_at = now() where id = p_member_id;

  insert into public.pet_checkin (family_id, member_id, checkin_date, consecutive_days, cycle_day, star_rewarded)
  values (v_family_id, p_member_id, v_today, v_consec, v_cycle, v_reward);

  return query select true, '签到成功！获得 ' || v_reward || ' 星光值', v_reward, v_star, v_consec, v_cycle, false;
end;
$$;

-- 4.2 get_dog_house：获取狗窝信息（首次自动初始化）
create or replace function public.get_dog_house(
  p_member_id uuid
)
returns table(level int, capacity int, current_pet_count int, upgrade_cost int)
language plpgsql security definer as $$
declare
  v_member public.members%rowtype;
  v_house public.dog_house%rowtype;
  v_count int;
begin
  select * into v_member from public.members where id = p_member_id;
  if not found then return; end if;

  -- 首次自动初始化
  select * into v_house from public.dog_house where member_id = p_member_id;
  if not found then
    insert into public.dog_house (family_id, member_id, level, capacity)
    values (v_member.family_id, p_member_id, 1, 3)
    returning * into v_house;
  end if;

  select count(*) into v_count from public.pets where member_id = p_member_id;

  return query select v_house.level, v_house.capacity, v_count, 50 * v_house.level;
end;
$$;

-- 4.3 upgrade_dog_house：升级狗窝
create or replace function public.upgrade_dog_house(
  p_member_id uuid
)
returns table(success boolean, message text, new_level int, new_capacity int, new_star int)
language plpgsql security definer as $$
declare
  v_member public.members%rowtype;
  v_house public.dog_house%rowtype;
  v_cost int;
  v_star int;
begin
  select * into v_member from public.members where id = p_member_id for update;
  v_star := v_member.star_value;

  select * into v_house from public.dog_house where member_id = p_member_id for update;
  if not found then
    insert into public.dog_house (family_id, member_id, level, capacity)
    values (v_member.family_id, p_member_id, 1, 3)
    returning * into v_house;
  end if;

  v_cost := 50 * v_house.level;
  if v_star < v_cost then
    return query select false, '星光值不足', v_house.level, v_house.capacity, v_star; return;
  end if;

  v_star := v_star - v_cost;
  v_house.level := v_house.level + 1;
  v_house.capacity := v_house.capacity + 2;

  update public.members set star_value = v_star, updated_at = now() where id = p_member_id;
  update public.dog_house set level = v_house.level, capacity = v_house.capacity, updated_at = now() where member_id = p_member_id;

  return query select true, '狗窝升级成功！容量+2', v_house.level, v_house.capacity, v_star;
end;
$$;

-- 4.4 finish_word_match：单词游戏结算
create or replace function public.finish_word_match(
  p_member_id uuid,
  p_matched_count int
)
returns table(success boolean, star_rewarded int, new_star int, new_best_score int)
language plpgsql security definer as $$
declare
  v_member public.members%rowtype;
  v_prog public.pet_word_progress%rowtype;
  v_reward int;
  v_star int;
begin
  select * into v_member from public.members where id = p_member_id for update;
  v_star := v_member.star_value;

  -- 奖励：每配对1个+1星光值
  v_reward := p_matched_count;
  v_star := v_star + v_reward;
  update public.members set star_value = v_star, updated_at = now() where id = p_member_id;

  -- 更新进度
  select * into v_prog from public.pet_word_progress where member_id = p_member_id;
  if not found then
    insert into public.pet_word_progress (family_id, member_id, total_rounds, total_matched, best_score, last_played_at)
    values (v_member.family_id, p_member_id, 1, p_matched_count, p_matched_count, now())
    returning * into v_prog;
    v_prog.best_score := p_matched_count;
  else
    update public.pet_word_progress set
      total_rounds = total_rounds + 1,
      total_matched = total_matched + p_matched_count,
      best_score = greatest(best_score, p_matched_count),
      last_played_at = now()
    where member_id = p_member_id
    returning * into v_prog;
  end if;

  return query select true, v_reward, v_star, v_prog.best_score;
end;
$$;

-- ============================================================
-- 5. RLS 与授权
-- ============================================================

alter table public.pet_inventory enable row level security;
alter table public.pet_checkin enable row level security;
alter table public.dog_house enable row level security;
alter table public.pet_words enable row level security;
alter table public.pet_word_progress enable row level security;

-- 背包
create policy "pet_inv_select" on public.pet_inventory for select using (true);
create policy "pet_inv_insert" on public.pet_inventory for insert with check (true);
create policy "pet_inv_update" on public.pet_inventory for update using (true);
create policy "pet_inv_delete" on public.pet_inventory for delete using (true);

-- 签到
create policy "pet_checkin_select" on public.pet_checkin for select using (true);
create policy "pet_checkin_insert" on public.pet_checkin for insert with check (true);

-- 狗窝
create policy "dog_house_select" on public.dog_house for select using (true);
create policy "dog_house_insert" on public.dog_house for insert with check (true);
create policy "dog_house_update" on public.dog_house for update using (true);

-- 单词词库
create policy "pet_words_select" on public.pet_words for select using (true);
create policy "pet_words_insert" on public.pet_words for insert with check (true);
create policy "pet_words_update" on public.pet_words for update using (true);
create policy "pet_words_delete" on public.pet_words for delete using (true);

-- 游戏进度
create policy "pet_word_prog_select" on public.pet_word_progress for select using (true);
create policy "pet_word_prog_insert" on public.pet_word_progress for insert with check (true);
create policy "pet_word_prog_update" on public.pet_word_progress for update using (true);

-- 授权
grant execute on function public.buy_pet_item(uuid, uuid) to anon, authenticated;
grant execute on function public.interact_with_pet(uuid, uuid, text, uuid) to anon, authenticated;
grant execute on function public.pet_checkin(uuid) to anon, authenticated;
grant execute on function public.get_dog_house(uuid) to anon, authenticated;
grant execute on function public.upgrade_dog_house(uuid) to anon, authenticated;
grant execute on function public.finish_word_match(uuid, int) to anon, authenticated;
