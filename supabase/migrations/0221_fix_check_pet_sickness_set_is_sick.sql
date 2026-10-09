-- 0221: 修复 check_pet_sickness 触发生病时不更新 is_sick 字段
--
-- 根因：
--   check_pet_sickness（0217）触发肠胃病/皮肤病/重病时只设
--   has_stomach_issue / has_skin_issue / has_severe_illness = true，health = 0，
--   但不设 is_sick = true。
--   而 is_sick 只在 interact_with_pet 中被更新。
--   导致：check_pet_sickness 触发后，疾病标志=true 但 is_sick=false。
--   前端"喂药"按钮禁用逻辑用 is_sick 判断（!isSick → 禁用），
--   造成宠物显示生病却无法喂药。
--
-- 修复：
--   1) check_pet_sickness 三处 UPDATE 都加上 is_sick = true
--   2) 回填：已有疾病标志=true 但 is_sick=false 的宠物，修正 is_sick=true

create or replace function public.check_pet_sickness(p_pet_id uuid)
returns void
language plpgsql security definer as $$
declare
  v_pet record;
  v_trait record;
  v_today date := (now() at time zone 'Asia/Shanghai')::date;
  v_days_no_care int;
  v_sick boolean;
  v_last_care_date date;
begin
  select * into v_pet from public.pets where id = p_pet_id for update;
  if not found then return; end if;

  -- 已经生病的不重复触发
  v_sick := public.pet_is_sick(
    coalesce(v_pet.has_stomach_issue, false),
    coalesce(v_pet.has_skin_issue, false),
    coalesce(v_pet.has_severe_illness, false)
  );
  if v_sick then return; end if;

  -- 读取特质配置
  select * into v_trait from public.pet_traits
    where id = v_pet.trait_id and is_active = true;
  if not found then
    select * into v_trait from public.pet_traits
      where name = '无特质' and is_active = true limit 1;
  end if;

  -- 计算连续无照料天数：
  -- 优先用 last_care_date（最后一次喂食/清洁/玩耍/就医）
  -- 若从未照料过，用 created_at（领养日期），而非 last_check_at
  v_last_care_date := coalesce(
    v_pet.last_care_date,
    (v_pet.created_at at time zone 'Asia/Shanghai')::date
  );
  v_days_no_care := v_today - v_last_care_date;

  -- 普通生病触发（连续N天无照料）：同步设 is_sick=true
  if v_days_no_care >= coalesce(v_trait.sickness_days, 3) then
    if random() < 0.5 then
      update public.pets
        set has_stomach_issue = true, health = 0, is_sick = true
        where id = p_pet_id;
    else
      update public.pets
        set has_skin_issue = true, health = 0, is_sick = true
        where id = p_pet_id;
    end if;
  end if;

  -- 重病触发（连续N天无照料）：同步设 is_sick=true
  if v_days_no_care >= coalesce(v_trait.severe_days, 7) then
    update public.pets
      set has_severe_illness = true, health = 0, is_sick = true
      where id = p_pet_id;
  end if;
end;
$$;
revoke all on function public.check_pet_sickness(uuid) from public;
grant execute on function public.check_pet_sickness(uuid) to anon, authenticated;

-- ============================================================
-- 数据回填：已有疾病标志=true 但 is_sick=false 的宠物，修正 is_sick=true
-- （历史数据中 check_pet_sickness 触发了疾病但没设 is_sick）
-- ============================================================
update public.pets
set is_sick = true
where is_sick = false
  and (
    coalesce(has_stomach_issue, false)
    or coalesce(has_skin_issue, false)
    or coalesce(has_severe_illness, false)
  );

notify pgrst, 'reload schema';
