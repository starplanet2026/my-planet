-- 0018: pets 表修复列名 + 添加 image_url 列，buy_pet_item 复制 image_url

-- 0. pets 表：修复/补齐所有可能缺失的列
do $$
begin
  -- base_coin_per_hour → base_coin_per_day
  if exists (select 1 from information_schema.columns where table_name = 'pets' and column_name = 'base_coin_per_hour')
     and not exists (select 1 from information_schema.columns where table_name = 'pets' and column_name = 'base_coin_per_day') then
    alter table public.pets rename column base_coin_per_hour to base_coin_per_day;
    raise notice 'pets: 已重命名 base_coin_per_hour → base_coin_per_day';
  end if;
  if not exists (select 1 from information_schema.columns where table_name = 'pets' and column_name = 'base_coin_per_day') then
    alter table public.pets add column base_coin_per_day numeric(10,2) not null default 0;
    raise notice 'pets: 已添加 base_coin_per_day';
  end if;

  -- upgrade_coin_reward
  if not exists (select 1 from information_schema.columns where table_name = 'pets' and column_name = 'upgrade_coin_reward') then
    alter table public.pets add column upgrade_coin_reward int not null default 0;
    raise notice 'pets: 已添加 upgrade_coin_reward';
  end if;

  -- gender
  if not exists (select 1 from information_schema.columns where table_name = 'pets' and column_name = 'gender') then
    alter table public.pets add column gender text;
    raise notice 'pets: 已添加 gender';
  end if;

  -- max_level
  if not exists (select 1 from information_schema.columns where table_name = 'pets' and column_name = 'max_level') then
    alter table public.pets add column max_level int not null default 10;
    raise notice 'pets: 已添加 max_level';
  end if;

  -- exp
  if not exists (select 1 from information_schema.columns where table_name = 'pets' and column_name = 'exp') then
    alter table public.pets add column exp int not null default 0;
    raise notice 'pets: 已添加 exp';
  end if;

  -- exp_to_next
  if not exists (select 1 from information_schema.columns where table_name = 'pets' and column_name = 'exp_to_next') then
    alter table public.pets add column exp_to_next int not null default 100;
    raise notice 'pets: 已添加 exp_to_next';
  end if;

  -- hunger
  if not exists (select 1 from information_schema.columns where table_name = 'pets' and column_name = 'hunger') then
    alter table public.pets add column hunger int not null default 80;
    raise notice 'pets: 已添加 hunger';
  end if;

  -- clean
  if not exists (select 1 from information_schema.columns where table_name = 'pets' and column_name = 'clean') then
    alter table public.pets add column clean int not null default 80;
    raise notice 'pets: 已添加 clean';
  end if;

  -- happiness
  if not exists (select 1 from information_schema.columns where table_name = 'pets' and column_name = 'happiness') then
    alter table public.pets add column happiness int not null default 80;
    raise notice 'pets: 已添加 happiness';
  end if;

  -- health
  if not exists (select 1 from information_schema.columns where table_name = 'pets' and column_name = 'health') then
    alter table public.pets add column health int not null default 100;
    raise notice 'pets: 已添加 health';
  end if;

  -- is_sick
  if not exists (select 1 from information_schema.columns where table_name = 'pets' and column_name = 'is_sick') then
    alter table public.pets add column is_sick boolean not null default false;
    raise notice 'pets: 已添加 is_sick';
  end if;

  -- coin_balance
  if not exists (select 1 from information_schema.columns where table_name = 'pets' and column_name = 'coin_balance') then
    alter table public.pets add column coin_balance numeric(10,2) not null default 0;
    raise notice 'pets: 已添加 coin_balance';
  end if;

  -- last_check_at
  if not exists (select 1 from information_schema.columns where table_name = 'pets' and column_name = 'last_check_at') then
    alter table public.pets add column last_check_at timestamptz not null default now();
    raise notice 'pets: 已添加 last_check_at';
  end if;

  -- shop_item_id
  if not exists (select 1 from information_schema.columns where table_name = 'pets' and column_name = 'shop_item_id') then
    alter table public.pets add column shop_item_id uuid;
    raise notice 'pets: 已添加 shop_item_id';
  end if;

  -- level
  if not exists (select 1 from information_schema.columns where table_name = 'pets' and column_name = 'level') then
    alter table public.pets add column level int not null default 1;
    raise notice 'pets: 已添加 level';
  end if;

  -- emoji
  if not exists (select 1 from information_schema.columns where table_name = 'pets' and column_name = 'emoji') then
    alter table public.pets add column emoji text;
    raise notice 'pets: 已添加 emoji';
  end if;
end;
$$;

-- 1. pets 表添加 image_url 列
alter table public.pets add column if not exists image_url text;

-- 2. 回填：已有宠物从 shop_item 复制 image_url
update public.pets p
set image_url = si.image_url
from public.pet_shop_items si
where p.shop_item_id = si.id and p.image_url is null;

-- 3. 重建 buy_pet_item：购买宠物时复制 image_url
drop function if exists public.buy_pet_item(uuid, uuid);

create function public.buy_pet_item(
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
    -- 创建宠物，复制 emoji + image_url，upgrade_coin_reward = price_coin
    insert into public.pets (family_id, member_id, shop_item_id, name, emoji, image_url, base_coin_per_day, upgrade_coin_reward, coin_balance)
    values (v_family_id, p_member_id, v_item.id, '新宠物', v_item.emoji, v_item.image_url, v_item.base_coin_per_day, v_item.price_coin, 0)
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

grant execute on function public.buy_pet_item(uuid, uuid) to anon, authenticated;

-- 4. 重建 check_pet：使用 base_coin_per_day
drop function if exists public.check_pet(uuid);

create function public.check_pet(
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

grant execute on function public.check_pet(uuid) to anon, authenticated;
