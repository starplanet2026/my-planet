-- 0307: Racer 经验数据修正（单条处理工单）
-- 背景：Racer 满级后正常送入进修；修复「陪伴学习额外加经验」时做了经验回溯扣减，
--       导致进修中的 Racer 经验不足、显示未满级，属历史修正特例。
-- 处理：补足经验至满级标准，保持进修状态，不消耗/扣减星光，仅记录后台备注。

-- 后台人工处理备注日志
create table if not exists public.pet_admin_notes (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null,
  member_id uuid not null,
  pet_id uuid not null,
  note text not null,
  operator text,
  created_at timestamptz not null default now()
);

alter table public.pet_admin_notes enable row level security;

drop policy if exists "owner can read pet admin notes" on public.pet_admin_notes;
create policy "owner can read pet admin notes"
  on public.pet_admin_notes for select
  using (exists (
    select 1 from public.families f
    where f.id = pet_admin_notes.family_id and f.owner_user_id = auth.uid()
  ));

do $$
declare
  v_pet_id uuid := '5d77eacf-3740-40e1-bf1d-2a2a9e31d157';
  v_pet record;
  v_old_level int;
  v_old_exp int;
  v_max int;
  v_exp_cap int;
begin
  select * into v_pet from public.pets where id = v_pet_id for update;
  if not found then return; end if;

  v_old_level := coalesce(v_pet.level, 1);
  v_old_exp := coalesce(v_pet.exp, 0);
  v_max := public.pet_standard_max_level(coalesce(v_pet.rarity, 'common'));
  v_exp_cap := public.exp_needed(v_max, coalesce(v_pet.rarity, 'common'));

  -- 已满级满经验则无需处理
  if v_old_level >= v_max and v_old_exp >= v_exp_cap then
    return;
  end if;

  -- 只改经验/等级，保持 is_studying 等进修状态不变；不产生星光流水
  update public.pets
  set level = v_max,
      exp = v_exp_cap,
      pending_levelup = false
  where id = v_pet_id;

  insert into public.pet_admin_notes (family_id, member_id, pet_id, note, operator)
  values (
    v_pet.family_id, v_pet.member_id, v_pet_id,
    format('人工补满经验（Lv.%s 经验%s → Lv.%s 经验%s）。原因：修复陪伴学习经验回溯导致进修中经验不足；本次调整不消耗、不扣减星光，无星光流水扣费，进修状态保持不变。',
           v_old_level, v_old_exp, v_max, v_exp_cap),
    '系统管理员'
  );
end;
$$;

notify pgrst, 'reload schema';
