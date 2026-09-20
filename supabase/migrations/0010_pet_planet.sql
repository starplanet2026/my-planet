-- ============================================================
-- 0010: 萌宠星球（宠物养成模块）
-- pet_shop_items: 商店商品（宠物/食物/玩具/药品）
-- pets: 已购买的宠物
-- pet_actions: 互动记录
-- ============================================================

-- 1. pet_shop_items：商店商品
create table if not exists public.pet_shop_items (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  type text not null check (type in ('pet','food','toy','medicine')),
  name text,  -- 宠物名称留空，购买时用户命名；食物/玩具/药品需要名称
  emoji text,
  image_url text,
  description text,
  price_star int not null default 0,
  price_coin int not null default 0,  -- 宠物：初始升级奖励金币；其他：金币价格
  -- 宠物特有属性
  breed text,
  base_coin_per_day numeric(10,2) not null default 0,  -- 基础每天产金
  rarity text default 'common' check (rarity in ('common','rare','epic')),
  stock int,
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. pets：已购买的宠物
create table if not exists public.pets (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  shop_item_id uuid references public.pet_shop_items(id) on delete set null,
  name text not null,
  emoji text,
  gender text check (gender in ('male','female')),
  level int not null default 1,
  max_level int not null default 10,
  exp int not null default 0,
  exp_to_next int not null default 100,
  base_coin_per_day numeric(10,2) not null default 0,  -- 基础每天产金
  upgrade_coin_reward int not null default 0,  -- 升级奖励金币（初始值，每级+20%）
  hunger int not null default 80,
  clean int not null default 80,
  happiness int not null default 80,
  health int not null default 100,
  coin_balance numeric(10,2) not null default 0,
  is_sick boolean not null default false,
  last_check_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- 3. pet_actions：互动记录
create table if not exists public.pet_actions (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  action_type text not null check (action_type in ('feed','clean','play','heal','claim_coin')),
  star_cost int not null default 0,
  coin_cost int not null default 0,
  coin_gain numeric(10,2) not null default 0,
  created_at timestamptz not null default now()
);

-- 索引
create index if not exists idx_pet_shop_items_family on public.pet_shop_items(family_id);
create index if not exists idx_pets_member on public.pets(member_id);
create index if not exists idx_pet_actions_pet on public.pet_actions(pet_id);

-- ============================================================
-- RPC 函数
-- ============================================================

-- buy_pet_item: 购买商品（宠物/食物/玩具/药品）
-- 购买宠物时不设名称，返回 pet_id 由前端让用户命名
create or replace function public.buy_pet_item(
  p_member_id uuid,
  p_item_id uuid
)
returns table(success boolean, message text, new_star int, new_coin int, pet_id uuid)
language plpgsql security definer as $$
declare
  v_item public.pet_shop_items%rowtype;
  v_member public.members%rowtype;
  v_star int;
  v_coin int;
  v_family_id uuid;
  v_pet_id uuid := null;
begin
  select * into v_item from public.pet_shop_items where id = p_item_id and status = 'active';
  if not found then return query select false, '商品不存在或已下架', 0, 0, null; return; end if;

  select * into v_member from public.members where id = p_member_id for update;
  v_family_id := v_member.family_id;
  v_star := v_member.star_value;
  v_coin := v_member.coin_balance;

  if v_star < v_item.price_star then
    return query select false, '星光值不足', v_star, v_coin, null; return;
  end if;
  -- 只有非宠物才扣金币价格；宠物的 price_coin 是升级奖励金币，购买时不扣
  if v_item.type <> 'pet' and v_coin < v_item.price_coin then
    return query select false, '金币不足', v_star, v_coin, null; return;
  end if;

  -- 扣款
  v_star := v_star - v_item.price_star;
  if v_item.type <> 'pet' then
    v_coin := v_coin - v_item.price_coin;
  end if;
  update public.members set star_value = v_star, coin_balance = v_coin, updated_at = now() where id = p_member_id;

  if v_item.type = 'pet' then
    -- 创建宠物，名称留空，upgrade_coin_reward = price_coin
    insert into public.pets (family_id, member_id, shop_item_id, name, emoji, base_coin_per_day, upgrade_coin_reward, coin_balance)
    values (v_family_id, p_member_id, v_item.id, '新宠物', v_item.emoji, v_item.base_coin_per_day, v_item.price_coin, 0)
    returning id into v_pet_id;
    return query select true, '购买成功！请给宠物取个名字', v_star, v_coin, v_pet_id;
  else
    if v_item.type = 'food' then
      update public.pets set hunger = least(100, hunger + 30) where member_id = p_member_id and is_sick = false;
      return query select true, '已购买并喂食所有宠物', v_star, v_coin, null;
    elsif v_item.type = 'toy' then
      update public.pets set happiness = least(100, happiness + 30) where member_id = p_member_id and is_sick = false;
      return query select true, '已购买玩具，所有宠物开心值+30', v_star, v_coin, null;
    elsif v_item.type = 'medicine' then
      update public.pets set is_sick = false, health = 100, hunger = 50, clean = 50, happiness = 50
      where member_id = p_member_id and is_sick = true;
      return query select true, '已购买药品，所有生病宠物已治愈', v_star, v_coin, null;
    end if;
  end if;
end;
$$;

-- interact_with_pet: 与宠物互动（喂食/清洁/玩耍/治疗）
create or replace function public.interact_with_pet(
  p_member_id uuid,
  p_pet_id uuid,
  p_action text
)
returns table(success boolean, message text, new_star int)
language plpgsql security definer as $$
declare
  v_pet public.pets%rowtype;
  v_member public.members%rowtype;
  v_star int;
  v_cost int := 0;
  v_msg text;
begin
  select * into v_pet from public.pets where id = p_pet_id;
  if not found then return query select false, '宠物不存在', 0; return; end if;
  if v_pet.member_id <> p_member_id then return query select false, '无权操作', 0; return; end if;

  select * into v_member from public.members where id = p_member_id for update;
  v_star := v_member.star_value;

  if p_action = 'feed' then
    v_cost := 5;
    if v_star < v_cost then return query select false, '星光值不足', v_star; return; end if;
    v_star := v_star - v_cost;
    update public.pets set hunger = least(100, hunger + 20) where id = p_pet_id;
    v_msg := '喂食成功，饥饿值+20';
  elsif p_action = 'clean' then
    v_cost := 3;
    if v_star < v_cost then return query select false, '星光值不足', v_star; return; end if;
    v_star := v_star - v_cost;
    update public.pets set clean = least(100, clean + 20) where id = p_pet_id;
    v_msg := '清洁成功，清洁值+20';
  elsif p_action = 'play' then
    v_cost := 4;
    if v_star < v_cost then return query select false, '星光值不足', v_star; return; end if;
    v_star := v_star - v_cost;
    update public.pets set happiness = least(100, happiness + 20) where id = p_pet_id;
    v_msg := '玩耍成功，开心值+20';
  elsif p_action = 'heal' then
    v_cost := 20;
    if v_star < v_cost then return query select false, '星光值不足', v_star; return; end if;
    if not v_pet.is_sick then return query select false, '宠物没有生病', v_star; return; end if;
    v_star := v_star - v_cost;
    update public.pets set is_sick = false, health = 100, hunger = 50, clean = 50, happiness = 50 where id = p_pet_id;
    v_msg := '治疗成功，宠物已恢复健康';
  else
    return query select false, '未知操作', v_star; return;
  end if;

  update public.members set star_value = v_star, updated_at = now() where id = p_member_id;

  insert into public.pet_actions (pet_id, member_id, action_type, star_cost)
  values (p_pet_id, p_member_id, p_action, v_cost);

  return query select true, v_msg, v_star;
end;
$$;

-- check_pet: 结算宠物状态（懒计算，打开页面时调用）
-- 计算状态衰减、金币产出（按天）、经验增长、升级奖励金币
create or replace function public.check_pet(
  p_pet_id uuid
)
returns public.pets
language plpgsql security definer as $$
declare
  v_pet public.pets%rowtype;
  v_elapsed_days numeric;
  v_coin_rate numeric;
  v_exp_gain int;
  v_level_up boolean := false;
  v_level_reward numeric := 0;
  v_coin_balance numeric;
begin
  select * into v_pet from public.pets where id = p_pet_id for update;
  if not found then raise exception '宠物不存在'; end if;

  -- 计算经过的天数
  v_elapsed_days := extract(epoch from (now() - v_pet.last_check_at)) / 86400;
  if v_elapsed_days < 0.0001 then
    return v_pet;
  end if;

  -- 状态衰减（按天：饥饿-5/天，清洁-4/天，开心-3/天）
  v_pet.hunger := greatest(0, v_pet.hunger - 5 * v_elapsed_days);
  v_pet.clean := greatest(0, v_pet.clean - 4 * v_elapsed_days);
  v_pet.happiness := greatest(0, v_pet.happiness - 3 * v_elapsed_days);

  -- 生病判定
  if v_pet.hunger < 20 or v_pet.clean < 20 or v_pet.happiness < 20 then
    if not v_pet.is_sick then
      v_pet.is_sick := true;
      v_pet.health := greatest(0, v_pet.health - 30);
    end if;
  end if;

  -- 金币产出和经验增长（状态都>30且没生病时）
  if not v_pet.is_sick and v_pet.hunger > 30 and v_pet.clean > 30 and v_pet.happiness > 30 then
    -- 产金按天计算：base_coin_per_day * (1 + (level-1)*0.2)
    v_coin_rate := v_pet.base_coin_per_day * (1 + (v_pet.level - 1) * 0.2);
    v_coin_balance := v_coin_rate * v_elapsed_days;
    v_pet.coin_balance := v_pet.coin_balance + v_coin_balance;

    -- 经验增长（每天2点）
    v_exp_gain := floor(2 * v_elapsed_days);
    v_pet.exp := v_pet.exp + v_exp_gain;

    -- 升级判断（最高10级）
    while v_pet.exp >= v_pet.exp_to_next and v_pet.level < v_pet.max_level loop
      v_pet.exp := v_pet.exp - v_pet.exp_to_next;
      v_pet.level := v_pet.level + 1;
      v_pet.exp_to_next := floor(v_pet.exp_to_next * 1.5);
      v_level_up := true;
      -- 升级奖励金币 = 初始值 * (1 + (level-1)*0.2)
      v_level_reward := v_level_reward + v_pet.upgrade_coin_reward * (1 + (v_pet.level - 1) * 0.2);
    end loop;

    if v_level_up then
      v_pet.coin_balance := v_pet.coin_balance + v_level_reward;
    end if;
  end if;

  v_pet.last_check_at := now();

  update public.pets set
    hunger = v_pet.hunger,
    clean = v_pet.clean,
    happiness = v_pet.happiness,
    health = v_pet.health,
    is_sick = v_pet.is_sick,
    coin_balance = v_pet.coin_balance,
    level = v_pet.level,
    exp = v_pet.exp,
    exp_to_next = v_pet.exp_to_next,
    last_check_at = v_pet.last_check_at
  where id = p_pet_id;

  return v_pet;
end;
$$;

-- claim_pet_coins: 领取宠物产出的金币
create or replace function public.claim_pet_coins(
  p_member_id uuid,
  p_pet_id uuid
)
returns table(success boolean, message text, claimed numeric, new_coin int)
language plpgsql security definer as $$
declare
  v_pet public.pets%rowtype;
  v_member public.members%rowtype;
  v_claimed numeric;
  v_new_coin int;
begin
  select * into v_pet from public.pets where id = p_pet_id for update;
  if not found then return query select false, '宠物不存在', 0, 0; return; end if;
  if v_pet.member_id <> p_member_id then return query select false, '无权操作', 0, 0; return; end if;

  if v_pet.coin_balance < 1 then
    return query select false, '暂无可领取金币', 0, 0; return;
  end if;

  v_claimed := floor(v_pet.coin_balance);
  v_pet.coin_balance := v_pet.coin_balance - v_claimed;

  select * into v_member from public.members where id = p_member_id for update;
  v_new_coin := v_member.coin_balance + v_claimed;
  update public.members set coin_balance = v_new_coin, updated_at = now() where id = p_member_id;

  update public.pets set coin_balance = v_pet.coin_balance where id = p_pet_id;

  insert into public.pet_actions (pet_id, member_id, action_type, coin_gain)
  values (p_pet_id, p_member_id, 'claim_coin', v_claimed);

  return query select true, '已领取 ' || v_claimed || ' 金币', v_claimed, v_new_coin;
end;
$$;

-- update_pet_info: 修改宠物名字和性别
create or replace function public.update_pet_info(
  p_pet_id uuid,
  p_member_id uuid,
  p_name text,
  p_gender text
)
returns void
language plpgsql security definer as $$
declare
  v_pet public.pets%rowtype;
begin
  select * into v_pet from public.pets where id = p_pet_id;
  if not found then raise exception '宠物不存在'; end if;
  if v_pet.member_id <> p_member_id then raise exception '无权操作'; end if;

  update public.pets set name = p_name, gender = p_gender where id = p_pet_id;
end;
$$;

-- 授权
grant execute on function public.buy_pet_item(uuid, uuid) to anon, authenticated;
grant execute on function public.interact_with_pet(uuid, uuid, text) to anon, authenticated;
grant execute on function public.check_pet(uuid) to anon, authenticated;
grant execute on function public.claim_pet_coins(uuid, uuid) to anon, authenticated;
grant execute on function public.update_pet_info(uuid, uuid, text, text) to anon, authenticated;

-- RLS
alter table public.pet_shop_items enable row level security;
alter table public.pets enable row level security;
alter table public.pet_actions enable row level security;

create policy "pet_shop_select" on public.pet_shop_items for select using (true);
create policy "pet_shop_insert" on public.pet_shop_items for insert with check (true);
create policy "pet_shop_update" on public.pet_shop_items for update using (true);
create policy "pet_shop_delete" on public.pet_shop_items for delete using (true);

create policy "pets_select" on public.pets for select using (true);
create policy "pets_insert" on public.pets for insert with check (true);
create policy "pets_update" on public.pets for update using (true);

create policy "pet_actions_select" on public.pet_actions for select using (true);
create policy "pet_actions_insert" on public.pet_actions for insert with check (true);
