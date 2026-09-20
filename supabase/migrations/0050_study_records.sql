-- 0050: 陪伴学习记录
-- 1) 新增 study_records 表：记录每次学习会话
-- 2) 修改 study_reward：完成后插入一条记录
-- 3) 新增查询 RPC：get_study_records
-- ============================================================

-- 1) 学习记录表
create table if not exists public.study_records (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  pet_id uuid references public.pets(id) on delete set null,
  pet_name text,
  minutes int not null default 0,
  happiness_gain int not null default 0,
  star_earned int not null default 0,
  tasks jsonb,                  -- [{text, reward, done}]
  created_at timestamptz not null default now()
);

create index if not exists idx_study_records_member on public.study_records(member_id, created_at desc);

alter table public.study_records enable row level security;
create policy "study_records_self" on public.study_records
  for select using (auth.uid() is not null);
create policy "study_records_insert" on public.study_records
  for insert with check (true);
create policy "study_records_delete_self" on public.study_records
  for delete using (true);

-- 2) 修改 study_reward：完成后插入一条记录
create or replace function public.study_reward(
  p_member_id uuid,
  p_minutes int,
  p_reward int default 0,
  p_pet_id uuid default null,
  p_tasks jsonb default null,       -- 新增：任务列表 JSON
  p_star_earned int default 0      -- 新增：任务获得的星光值
)
returns table(success boolean, message text, happiness_gain int)
language plpgsql security definer as $$
declare
  v_pet record;
  v_exp_gain int;
  v_happiness_gain int;
  v_new_exp int;
  v_exp_needed int;
  v_level_up boolean := false;
  v_coin_earned int := 0;
  v_pet_name text := null;
begin
  v_happiness_gain := greatest(0, p_minutes);

  if p_pet_id is not null then
    select * into v_pet from public.pets where public.pets.id = p_pet_id for update;
    if found then
      v_pet_name := v_pet.name;
      v_exp_gain := (p_minutes / 10) * 10;
      v_new_exp := coalesce(v_pet.exp, 0) + v_exp_gain;
      v_exp_needed := public.exp_needed(v_pet.level);

      if v_new_exp >= v_exp_needed and v_pet.level < coalesce(v_pet.max_level, 3) then
        v_level_up := true;
        v_new_exp := v_new_exp - v_exp_needed;
        v_coin_earned := coalesce(v_pet.upgrade_coin_reward, 5);

        update public.pets set
          level = v_pet.level + 1,
          exp = v_new_exp,
          happiness = least(coalesce(v_pet.current_max_blood, 100), v_pet.happiness + v_happiness_gain),
          current_max_blood = round(coalesce(v_pet.current_max_blood, 100) * 1.05)::int,
          daily_decay_base = coalesce(v_pet.daily_decay_base, 5) + 1,
          coin_balance = coalesce(v_pet.coin_balance, 0) + v_coin_earned
        where public.pets.id = p_pet_id;

        update public.members set coin_balance = coin_balance + v_coin_earned, updated_at = now()
        where public.members.id = p_member_id;
      else
        update public.pets set
          exp = v_new_exp,
          happiness = least(coalesce(v_pet.current_max_blood, 100), v_pet.happiness + v_happiness_gain)
        where public.pets.id = p_pet_id;
      end if;
    end if;
  end if;

  -- 插入学习记录
  insert into public.study_records (member_id, pet_id, pet_name, minutes, happiness_gain, star_earned, tasks)
  values (p_member_id, p_pet_id, v_pet_name, p_minutes, v_happiness_gain, p_star_earned, p_tasks);

  return query select true,
    case
      when v_level_up then '学习完成！宠物心情恢复' || v_happiness_gain || '点，升级啦！+' || v_coin_earned || '金币'
      when p_pet_id is not null then '学习完成！宠物心情恢复' || v_happiness_gain || '点，获得' || coalesce(v_exp_gain, 0) || '经验'
      else '学习完成！'
    end,
    v_happiness_gain;
end;
$$;

grant execute on function public.study_reward(uuid, int, int, uuid, jsonb, int) to anon, authenticated;

-- 3) 查询学习记录
create or replace function public.get_study_records(
  p_member_id uuid,
  p_limit int default 50
)
returns table(
  id uuid,
  minutes int,
  happiness_gain int,
  star_earned int,
  pet_name text,
  tasks jsonb,
  created_at timestamptz
)
language plpgsql security definer as $$
begin
  return query
  select sr.id, sr.minutes, sr.happiness_gain, sr.star_earned, sr.pet_name, sr.tasks, sr.created_at
  from public.study_records sr
  where sr.member_id = p_member_id
  order by sr.created_at desc
  limit p_limit;
end;
$$;

grant execute on function public.get_study_records(uuid, int) to anon, authenticated;
