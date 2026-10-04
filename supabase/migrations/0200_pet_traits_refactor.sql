-- 0200: 宠物特质体系重构
-- 废弃旧8条特质及每日衰减倍率逻辑，新建后台可配置的特质模块
-- 新建 pet_traits 配置表 + pet_shop_items/pets 加 trait_id

-- ============================================================
-- 一、新建 pet_traits 配置表
-- ============================================================
create table if not exists public.pet_traits (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  hunger_initial int not null default 0,
  clean_initial int not null default 0,
  happiness_initial int not null default 0,
  exp_multiplier numeric not null default 1.0,
  coin_multiplier numeric not null default 1.0,
  sickness_days int not null default 3,
  severe_days int not null default 7,
  shop_card_text text not null default '',
  detail_text text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.pet_traits is '宠物特质配置表';
comment on column public.pet_traits.hunger_initial is '北京时间0点全局重置时，hunger叠加的数值';
comment on column public.pet_traits.clean_initial is '北京时间0点全局重置时，clean叠加的数值';
comment on column public.pet_traits.happiness_initial is '北京时间0点全局重置时，happiness叠加的数值';
comment on column public.pet_traits.exp_multiplier is '经验值倍率';
comment on column public.pet_traits.coin_multiplier is '金币倍率';
comment on column public.pet_traits.sickness_days is '连续N天无互动进入普通生病';
comment on column public.pet_traits.severe_days is '连续N天无互动进入重病';

-- ============================================================
-- 二、预置7条特质
-- ============================================================
insert into public.pet_traits (name, hunger_initial, clean_initial, happiness_initial, exp_multiplier, coin_multiplier, sickness_days, severe_days, shop_card_text, detail_text) values
  ('有活力', 20, 0, 0, 1.0, 1.0, 3, 7, '体力保有能力+20%', '体力保有能力+20%'),
  ('爱干净', 0, 20, 0, 1.0, 1.0, 3, 7, '清洁保有能力+20%', '清洁保有能力+20%'),
  ('乐天派', 0, 0, 20, 1.0, 1.0, 3, 7, '心情保有能力+20%', '心情保有能力+20%'),
  ('小财迷', 0, 0, 0, 1.0, 1.1, 3, 7, '每日产金+10%', '每日产金+10%'),
  ('爱学习', 0, 0, 0, 1.1, 1.0, 3, 7, '经验值加成+10%', '经验值加成+10%'),
  ('好体魄', 0, 0, 0, 1.0, 1.0, 4, 9, '健康维持能力+30%', '连续4天无互动进入生病；连续9天无互动需就医'),
  ('无特质', 0, 0, 0, 1.0, 1.0, 3, 7, '无加成', '无加成')
on conflict (name) do nothing;

-- ============================================================
-- 三、pet_shop_items 和 pets 加 trait_id
-- ============================================================
alter table public.pet_shop_items
  add column if not exists trait_id uuid references public.pet_traits(id);

alter table public.pets
  add column if not exists trait_id uuid references public.pet_traits(id);

comment on column public.pet_shop_items.trait_id is '绑定的特质ID';
comment on column public.pets.trait_id is '绑定的特质ID（领养时从商店物品复制）';

-- ============================================================
-- 四、给所有无特质的宠物默认绑定"无特质"
-- ============================================================
update public.pets set trait_id = (
  select id from public.pet_traits where name = '无特质' limit 1
) where trait_id is null;

update public.pet_shop_items set trait_id = (
  select id from public.pet_traits where name = '无特质' limit 1
) where trait_id is null and type = 'pet';

-- ============================================================
-- 五、创建索引
-- ============================================================
create index if not exists idx_pet_shop_items_trait_id on public.pet_shop_items(trait_id);
create index if not exists idx_pets_trait_id on public.pets(trait_id);

-- ============================================================
-- 六、RPC：获取所有特质配置（后台管理用）
-- ============================================================
create or replace function public.get_pet_traits()
returns table(
  id uuid,
  name text,
  hunger_initial int,
  clean_initial int,
  happiness_initial int,
  exp_multiplier numeric,
  coin_multiplier numeric,
  sickness_days int,
  severe_days int,
  shop_card_text text,
  detail_text text,
  is_active boolean
)
language plpgsql security definer as $$
begin
  return query
  select t.id, t.name, t.hunger_initial, t.clean_initial, t.happiness_initial,
         t.exp_multiplier, t.coin_multiplier, t.sickness_days, t.severe_days,
         t.shop_card_text, t.detail_text, t.is_active
  from public.pet_traits t
  where t.is_active = true
  order by t.created_at;
end;
$$;
grant execute on function public.get_pet_traits() to anon, authenticated;

-- ============================================================
-- 七、RPC：更新特质配置（后台管理用）
-- ============================================================
create or replace function public.update_pet_trait(
  p_id uuid,
  p_name text default null,
  p_hunger_initial int default null,
  p_clean_initial int default null,
  p_happiness_initial int default null,
  p_exp_multiplier numeric default null,
  p_coin_multiplier numeric default null,
  p_sickness_days int default null,
  p_severe_days int default null,
  p_shop_card_text text default null,
  p_detail_text text default null
)
returns void
language plpgsql security definer as $$
begin
  update public.pet_traits set
    name = coalesce(p_name, name),
    hunger_initial = coalesce(p_hunger_initial, hunger_initial),
    clean_initial = coalesce(p_clean_initial, clean_initial),
    happiness_initial = coalesce(p_happiness_initial, happiness_initial),
    exp_multiplier = coalesce(p_exp_multiplier, exp_multiplier),
    coin_multiplier = coalesce(p_coin_multiplier, coin_multiplier),
    sickness_days = coalesce(p_sickness_days, sickness_days),
    severe_days = coalesce(p_severe_days, severe_days),
    shop_card_text = coalesce(p_shop_card_text, shop_card_text),
    detail_text = coalesce(p_detail_text, detail_text),
    updated_at = now()
  where id = p_id;
end;
$$;
grant execute on function public.update_pet_trait(uuid, text, int, int, int, numeric, numeric, int, int, text, text) to authenticated;

notify pgrst, 'reload schema';
