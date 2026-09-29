-- 0168: 陪伴学习家长审核机制
-- 1) study_records 增加审核字段（review_status / review_note / reviewed_at / reviewed_by）
-- 2) 重写 study_reward：仅插入待审核记录，不再直接发放星光/心情
-- 3) 新增 approve_study_record / reject_study_record
-- 4) 新增 get_pending_study_reviews（家长审核列表）
-- 5) 收紧 study_task_templates RLS：仅家长可增删改，孩子仅可勾选 selected

-- ============================================================
-- 1) study_records 增加审核字段
-- ============================================================
alter table public.study_records
  add column if not exists review_status text not null default 'pending'
    check (review_status in ('pending','approved','rejected'));
alter table public.study_records
  add column if not exists review_note text;
alter table public.study_records
  add column if not exists reviewed_at timestamptz;
alter table public.study_records
  add column if not exists reviewed_by uuid references public.members(id) on delete set null;

-- 历史数据默认为已通过（兼容旧记录）
update public.study_records set review_status = 'approved', reviewed_at = now()
where review_status = 'pending' and reviewed_at is null and created_at < now() - interval '1 minute';

create index if not exists idx_study_records_review
  on public.study_records(review_status, created_at desc);

-- ============================================================
-- 2) 重写 study_reward：仅插入待审核记录，不发放任何奖励
--    （奖励在家长审核通过时由 approve_study_record 发放）
-- ============================================================
drop function if exists public.study_reward(uuid, int, int, uuid, jsonb, int);
create or replace function public.study_reward(
  p_member_id uuid,
  p_minutes int,
  p_reward int default 0,
  p_pet_id uuid default null,
  p_tasks jsonb default null,
  p_star_earned int default 0
)
returns table(success boolean, message text, happiness_gain int)
language plpgsql security definer as $$
declare
  v_pet_name text := null;
begin
  -- 取宠物名（仅用于记录展示，不发奖）
  if p_pet_id is not null then
    select name into v_pet_name from public.pets where id = p_pet_id;
  end if;

  -- 仅插入待审核记录；happiness_gain 暂存为分钟数（审核通过后才真正发放）
  insert into public.study_records
    (member_id, pet_id, pet_name, minutes, happiness_gain, star_earned, tasks, review_status)
  values
    (p_member_id, p_pet_id, v_pet_name, p_minutes, p_minutes, p_star_earned, p_tasks, 'pending');

  return query select true, '已提交审核，等待家长确认'::text, p_minutes;
end;
$$;

grant execute on function public.study_reward(uuid, int, int, uuid, jsonb, int) to anon, authenticated;

-- ============================================================
-- 3) 审核通过：发放心情值 + 星光值 + 宠物经验/升级
-- ============================================================
create or replace function public.approve_study_record(
  p_record_id uuid,
  p_reviewer_id uuid
)
returns table(success boolean, message text, star_granted int, happiness_granted int)
language plpgsql security definer as $$
declare
  v_rec record;
  v_pet record;
  v_exp_gain int;
  v_new_exp int;
  v_exp_needed int;
  v_level_up boolean := false;
  v_coin_earned int := 0;
  v_star int := 0;
  v_happiness int := 0;
begin
  select * into v_rec from public.study_records where id = p_record_id for update;
  if not found then
    return query select false, '记录不存在'::text, 0, 0;
    return;
  end if;
  if v_rec.review_status <> 'pending' then
    return query select false, '该记录已审核'::text, 0, 0;
    return;
  end if;

  v_star := coalesce(v_rec.star_earned, 0);
  v_happiness := coalesce(v_rec.happiness_gain, 0);

  -- 发放星光值
  if v_star > 0 then
    update public.members set star_value = star_value + v_star, updated_at = now()
    where id = v_rec.member_id;
  end if;

  -- 发放心情值 + 经验（宠物）
  if v_rec.pet_id is not null then
    select * into v_pet from public.pets where id = v_rec.pet_id for update;
    if found then
      v_exp_gain := (v_happiness / 10) * 10;
      v_new_exp := coalesce(v_pet.exp, 0) + v_exp_gain;
      v_exp_needed := public.exp_needed(v_pet.level);

      if v_new_exp >= v_exp_needed and v_pet.level < coalesce(v_pet.max_level, 3) then
        v_level_up := true;
        v_new_exp := v_new_exp - v_exp_needed;
        v_coin_earned := coalesce(v_pet.upgrade_coin_reward, 5);
        update public.pets set
          level = v_pet.level + 1,
          exp = v_new_exp,
          happiness = least(coalesce(v_pet.current_max_blood, 100), v_pet.happiness + v_happiness),
          current_max_blood = round(coalesce(v_pet.current_max_blood, 100) * 1.05)::int,
          daily_decay_base = coalesce(v_pet.daily_decay_base, 5) + 1,
          coin_balance = coalesce(v_pet.coin_balance, 0) + v_coin_earned
        where id = v_rec.pet_id;
        update public.members set coin_balance = coin_balance + v_coin_earned, updated_at = now()
        where id = v_rec.member_id;
      else
        update public.pets set
          exp = v_new_exp,
          happiness = least(coalesce(v_pet.current_max_blood, 100), v_pet.happiness + v_happiness)
        where id = v_rec.pet_id;
      end if;
    end if;
  end if;

  update public.study_records set
    review_status = 'approved',
    reviewed_at = now(),
    reviewed_by = p_reviewer_id
  where id = p_record_id;

  return query select true,
    case
      when v_level_up then '审核通过！心情+' || v_happiness || '，星光+' || v_star || '，宠物升级！+' || v_coin_earned || '金币'
      else '审核通过！心情+' || v_happiness || '，星光+' || v_star
    end,
    v_star, v_happiness;
end;
$$;

grant execute on function public.approve_study_record(uuid, uuid) to anon, authenticated;

-- ============================================================
-- 4) 审核驳回：不发奖，记录备注
-- ============================================================
create or replace function public.reject_study_record(
  p_record_id uuid,
  p_reviewer_id uuid,
  p_note text default null
)
returns table(success boolean, message text)
language plpgsql security definer as $$
declare
  v_rec record;
begin
  select * into v_rec from public.study_records where id = p_record_id for update;
  if not found then
    return query select false, '记录不存在'::text;
    return;
  end if;
  if v_rec.review_status <> 'pending' then
    return query select false, '该记录已审核'::text;
    return;
  end if;

  update public.study_records set
    review_status = 'rejected',
    review_note = p_note,
    reviewed_at = now(),
    reviewed_by = p_reviewer_id
  where id = p_record_id;

  return query select true, '已驳回'::text;
end;
$$;

grant execute on function public.reject_study_record(uuid, uuid, text) to anon, authenticated;

-- ============================================================
-- 5) 家长审核列表：返回家庭内所有待审核学习记录
-- ============================================================
create or replace function public.get_pending_study_reviews(
  p_family_id uuid
)
returns table(
  id uuid,
  member_id uuid,
  member_name text,
  pet_name text,
  minutes int,
  happiness_gain int,
  star_earned int,
  tasks jsonb,
  created_at timestamptz,
  review_status text
)
language plpgsql security definer as $$
begin
  return query
  select sr.id, sr.member_id, m.name, sr.pet_name, sr.minutes,
         sr.happiness_gain, sr.star_earned, sr.tasks, sr.created_at, sr.review_status
  from public.study_records sr
  join public.members m on m.id = sr.member_id
  where m.family_id = p_family_id
    and sr.review_status = 'pending'
  order by sr.created_at desc;
end;
$$;

grant execute on function public.get_pending_study_reviews(uuid) to anon, authenticated;

-- ============================================================
-- 6) 收紧 study_task_templates RLS：
--    - select: 认证用户均可
--    - insert/update/delete: 仅家庭成员中的家长（family.owner_user_id = auth.uid()）
--    - 孩子仅可更新 selected 字段（勾选任务）
-- ============================================================
drop policy if exists "study_task_templates_auth_all" on public.study_task_templates;

-- 家长判断辅助：当前认证用户是否为该 member 所属家庭的家长
create or replace function public.is_family_parent(p_member_id uuid)
returns boolean
language sql security definer stable as $$
  select exists (
    select 1 from public.members m
    join public.families f on f.id = m.family_id
    where m.id = p_member_id and f.owner_user_id = auth.uid()
  );
$$;

create policy "study_task_templates_select" on public.study_task_templates
  for select to authenticated using (true);

create policy "study_task_templates_parent_write" on public.study_task_templates
  for all to authenticated
  using (public.is_family_parent(member_id))
  with check (public.is_family_parent(member_id));

-- 孩子仅可更新 selected 字段
create policy "study_task_templates_child_select" on public.study_task_templates
  for update to authenticated
  using (true)
  with check (
    -- 仅当新值与旧值只有 selected 不同时允许（即孩子只能勾选）
    (text = (select text from public.study_task_templates where id = study_task_templates.id))
    and (reward = (select reward from public.study_task_templates where id = study_task_templates.id))
    and (member_id = (select member_id from public.study_task_templates where id = study_task_templates.id))
    and (display_order = (select display_order from public.study_task_templates where id = study_task_templates.id))
  );

-- ============================================================
-- 7) study_records RLS：家长可更新审核字段
-- ============================================================
drop policy if exists "study_records_self" on public.study_records;
drop policy if exists "study_records_insert" on public.study_records;
drop policy if exists "study_records_delete_self" on public.study_records;

create policy "study_records_select" on public.study_records
  for select to authenticated using (true);

create policy "study_records_insert" on public.study_records
  for insert to authenticated with check (true);

create policy "study_records_update_review" on public.study_records
  for update to authenticated
  using (public.is_family_parent(member_id))
  with check (public.is_family_parent(member_id));
