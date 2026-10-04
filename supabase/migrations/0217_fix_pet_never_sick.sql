-- 0217: 修复宠物永不生病 bug
-- 根因：check_pet_sickness 中 last_care_date 为 null 时回退到 last_check_at，
-- 但 last_check_at 被以下逻辑频繁刷新：
--   1. run_daily_global_pet_reset 每天0点对所有宠物执行 last_check_at = now()
--   2. check_pet 每次打开宠物页执行 last_check_at = now()
--   3. 托管养护等也更新 last_check_at
-- 导致 v_days_no_care 始终为 0~1，永远达不到 sickness_days(3天) 阈值
--
-- 修复：last_care_date 为 null 时回退到 created_at（领养日期），
-- 从未被照料过的宠物从领养日起累计无照料天数

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
  -- （last_check_at 会被每日重置/打开页面等操作刷新，不能代表"最后照料时间"）
  v_last_care_date := coalesce(
    v_pet.last_care_date,
    (v_pet.created_at at time zone 'Asia/Shanghai')::date
  );
  v_days_no_care := v_today - v_last_care_date;

  -- 普通生病触发（连续N天无照料）
  if v_days_no_care >= coalesce(v_trait.sickness_days, 3) then
    if random() < 0.5 then
      update public.pets set has_stomach_issue = true, health = 0 where id = p_pet_id;
    else
      update public.pets set has_skin_issue = true, health = 0 where id = p_pet_id;
    end if;
  end if;

  -- 重病触发（连续N天无照料）
  if v_days_no_care >= coalesce(v_trait.severe_days, 7) then
    update public.pets set has_severe_illness = true, health = 0 where id = p_pet_id;
  end if;
end;
$$;
revoke all on function public.check_pet_sickness(uuid) from public;
grant execute on function public.check_pet_sickness(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
