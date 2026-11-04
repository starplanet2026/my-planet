-- 0296: 勋章模块 V1.0
-- 规则模型（固定 3 套）：
--   streak  连续打卡：仅统计「周一到周日每天都循环」的成就，按单条成就独立统计分段连续天数
--   collect 分类集齐：统计该类别下成就累计完成次数（同一张卡完成多次算多次）
--   daily   当日活跃：统计某自然日成就完成次数
-- 勋章可叠加：同一条件每次满足各发 1 枚；断签不回收，重新连续可再次获得

-- ============================================================
-- 0. 金币流水新增 medal 分类
-- ============================================================
alter table public.coin_records drop constraint if exists coin_records_category_check;
alter table public.coin_records add constraint coin_records_category_check
  check (category = any (array['task','purchase','manual','system','task_reject','manual_adjust','challenge','shop','boarding','evolve','study','upgrade','dictation','recitation','lucky_wheel','medical','medal'])) not valid;

-- ============================================================
-- 1. 公共勋章模板库
-- ============================================================
create table if not exists public.medal_templates (
  id uuid primary key default gen_random_uuid(),
  code text,
  name text not null,
  series text not null check (series in ('streak','collect','daily')),
  threshold int not null default 1,
  subcategory text,
  tier text,
  condition_text text,
  description text,
  icon text,
  reward_stars int not null default 0,
  reward_card_name text,
  reward_card_count int not null default 1,
  is_active boolean not null default true,
  priority int not null default 0,
  created_by uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists medal_templates_code_key on public.medal_templates (code) where code is not null;

-- ============================================================
-- 2. 个人（家庭）勋章库
-- ============================================================
create table if not exists public.medals (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  template_id uuid references public.medal_templates(id) on delete set null,
  code text,
  name text not null,
  series text not null check (series in ('streak','collect','daily')),
  threshold int not null default 1,
  subcategory text,
  tier text,
  condition_text text,
  description text,
  icon text,
  reward_stars int not null default 0,
  reward_card_name text,
  reward_card_count int not null default 1,
  reward_item_id uuid references public.items(id) on delete set null,
  is_active boolean not null default true,
  priority int not null default 0,
  created_by uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists medals_family_code_key on public.medals (family_id, code) where code is not null;
create index if not exists medals_family_idx on public.medals (family_id);

-- ============================================================
-- 3. 孩子持有勋章 + 发放流水
-- ============================================================
create table if not exists public.member_medals (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  medal_id uuid not null references public.medals(id) on delete cascade,
  count int not null default 0,
  first_earned_at timestamptz not null default now(),
  last_earned_at timestamptz not null default now(),
  unique (member_id, medal_id)
);
create index if not exists member_medals_member_idx on public.member_medals (member_id);

create table if not exists public.medal_awards (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  medal_id uuid not null references public.medals(id) on delete cascade,
  award_key text not null,
  reward_stars int not null default 0,
  reward_card_name text,
  reward_card_count int not null default 0,
  created_at timestamptz not null default now(),
  unique (member_id, medal_id, award_key)
);

-- ============================================================
-- 4. 发放单枚勋章（幂等）
-- ============================================================
create or replace function public.award_medal(p_member_id uuid, p_medal_id uuid, p_key text)
returns boolean
language plpgsql security definer as $$
declare
  v_family uuid;
  v_medal public.medals%rowtype;
  v_new_id uuid;
begin
  select family_id into v_family from public.members where id = p_member_id;
  if v_family is null then return false; end if;

  select * into v_medal from public.medals where id = p_medal_id and family_id = v_family;
  if not found or not v_medal.is_active then return false; end if;

  insert into public.medal_awards
    (family_id, member_id, medal_id, award_key, reward_stars, reward_card_name, reward_card_count)
  values
    (v_family, p_member_id, p_medal_id, p_key, v_medal.reward_stars,
     v_medal.reward_card_name, v_medal.reward_card_count)
  on conflict (member_id, medal_id, award_key) do nothing
  returning id into v_new_id;

  if v_new_id is null then return false; end if;

  insert into public.member_medals (family_id, member_id, medal_id, count)
  values (v_family, p_member_id, p_medal_id, 1)
  on conflict (member_id, medal_id) do update
    set count = public.member_medals.count + 1, last_earned_at = now();

  if v_medal.reward_stars > 0 then
    update public.members
      set star_value = coalesce(star_value, 0) + v_medal.reward_stars, updated_at = now()
      where id = p_member_id;
    insert into public.coin_records
      (family_id, member_id, amount, balance_type, category, reason, message)
    values
      (v_family, p_member_id, v_medal.reward_stars, 'star', 'medal',
       '勋章奖励：' || v_medal.name, v_medal.name);
  end if;

  return true;
end;
$$;

-- ============================================================
-- 5. 全量判定并发放（可重复调用，幂等）
-- ============================================================
create or replace function public.sync_member_medals(p_member_id uuid)
returns int
language plpgsql security definer as $$
declare
  v_family uuid;
  v_task record;
  v_medal record;
  v_dates date[];
  v_i int;
  v_seg_start date;
  v_prev date;
  v_seg_len int;
  v_total int;
  v_target int;
  v_current int;
  v_day date;
  v_day_count int;
  v_awards int := 0;
begin
  select family_id into v_family from public.members where id = p_member_id;
  if v_family is null then return 0; end if;

  -- ---------- 连续打卡：仅统计 7 天全循环的成就 ----------
  for v_task in
    select t.id
    from public.tasks t
    where t.family_id = v_family
      and t.repeat_days @> array[0,1,2,3,4,5,6]
      and exists (
        select 1 from public.coin_records cr
        where cr.member_id = p_member_id and cr.category = 'task' and cr.ref_id = t.id
      )
  loop
    select array_agg(d order by d) into v_dates
    from (
      select distinct (cr.created_at at time zone 'Asia/Shanghai')::date as d
      from public.coin_records cr
      where cr.member_id = p_member_id and cr.category = 'task' and cr.ref_id = v_task.id
    ) s;

    if v_dates is null then continue; end if;

    v_seg_start := v_dates[1];
    v_prev := v_dates[1];
    for v_i in 2 .. array_length(v_dates, 1) loop
      if v_dates[v_i] = v_prev + 1 then
        v_prev := v_dates[v_i];
      else
        v_seg_len := (v_prev - v_seg_start) + 1;
        for v_medal in
          select * from public.medals
          where family_id = v_family and is_active and series = 'streak'
        loop
          if v_seg_len >= v_medal.threshold then
            if public.award_medal(p_member_id, v_medal.id,
                'streak:' || v_task.id || ':' || v_seg_start) then
              v_awards := v_awards + 1;
            end if;
          end if;
        end loop;
        v_seg_start := v_dates[v_i];
        v_prev := v_dates[v_i];
      end if;
    end loop;

    v_seg_len := (v_prev - v_seg_start) + 1;
    for v_medal in
      select * from public.medals
      where family_id = v_family and is_active and series = 'streak'
    loop
      if v_seg_len >= v_medal.threshold then
        if public.award_medal(p_member_id, v_medal.id,
            'streak:' || v_task.id || ':' || v_seg_start) then
          v_awards := v_awards + 1;
        end if;
      end if;
    end loop;
  end loop;

  -- ---------- 分类集齐：累计完成次数达到阈值 ----------
  for v_medal in
    select * from public.medals
    where family_id = v_family and is_active and series = 'collect'
  loop
    select count(*) into v_total
    from public.coin_records cr
    join public.tasks t on t.id = cr.ref_id
    where cr.member_id = p_member_id
      and cr.category = 'task'
      and t.subcategory = v_medal.subcategory;

    v_target := floor(coalesce(v_total, 0) / greatest(v_medal.threshold, 1));
    select coalesce(m.count, 0) into v_current
    from public.member_medals m
    where m.member_id = p_member_id and m.medal_id = v_medal.id;
    v_current := coalesce(v_current, 0);

    while v_current < v_target loop
      v_current := v_current + 1;
      if public.award_medal(p_member_id, v_medal.id, 'collect:' || v_current) then
        v_awards := v_awards + 1;
      end if;
    end loop;
  end loop;

  -- ---------- 当日活跃：单日完成条数达到阈值 ----------
  for v_medal in
    select * from public.medals
    where family_id = v_family and is_active and series = 'daily'
  loop
    for v_day, v_day_count in
      select (cr.created_at at time zone 'Asia/Shanghai')::date as d, count(*)
      from public.coin_records cr
      where cr.member_id = p_member_id and cr.category = 'task'
      group by 1
      having count(*) >= v_medal.threshold
    loop
      if public.award_medal(p_member_id, v_medal.id, 'daily:' || v_day) then
        v_awards := v_awards + 1;
      end if;
    end loop;
  end loop;

  return v_awards;
end;
$$;

-- 成就完成（写 coin_records category='task'）后自动判定
create or replace function public.trg_coin_record_medal_sync()
returns trigger language plpgsql security definer as $$
begin
  perform public.sync_member_medals(new.member_id);
  return new;
end;
$$;

drop trigger if exists coin_record_medal_sync on public.coin_records;
create trigger coin_record_medal_sync
  after insert on public.coin_records
  for each row
  when (new.category = 'task' and new.member_id is not null)
  execute function public.trg_coin_record_medal_sync();

-- ============================================================
-- 6. RLS
-- ============================================================
alter table public.medal_templates enable row level security;
alter table public.medals enable row level security;
alter table public.member_medals enable row level security;
alter table public.medal_awards enable row level security;

drop policy if exists medal_templates_read on public.medal_templates;
create policy medal_templates_read on public.medal_templates
  for select using (auth.uid() is not null);
drop policy if exists medal_templates_admin_write on public.medal_templates;
create policy medal_templates_admin_write on public.medal_templates
  for all using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists medals_family_all on public.medals;
create policy medals_family_all on public.medals
  for all
  using (exists (select 1 from public.families f where f.id = medals.family_id and f.owner_user_id = auth.uid()))
  with check (exists (select 1 from public.families f where f.id = medals.family_id and f.owner_user_id = auth.uid()));

drop policy if exists member_medals_family_read on public.member_medals;
create policy member_medals_family_read on public.member_medals
  for select
  using (exists (select 1 from public.families f where f.id = member_medals.family_id and f.owner_user_id = auth.uid()));

drop policy if exists medal_awards_family_read on public.medal_awards;
create policy medal_awards_family_read on public.medal_awards
  for select
  using (exists (select 1 from public.families f where f.id = medal_awards.family_id and f.owner_user_id = auth.uid()));
