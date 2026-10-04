-- 0201: 新建全局0点重置函数 + 修改生病触发逻辑
-- 北京时间0:00对所有宠物执行：hunger/clean/happiness → 0 + 叠加特质初始加成
-- 生病触发改为基于last_care_date判断（非好体魄默认3/7天，好体魄4/9天）
-- 注意：check_pet的每日衰减逻辑删除需要读取0171完整源码，此迁移仅新建全局重置函数
-- check_pet的重写将在完整代码环境可用后单独处理

-- ============================================================
-- 一、新建全局0点重置函数
-- ============================================================
create or replace function public.run_daily_global_pet_reset()
returns void
language plpgsql security definer as $$
declare
  v_pet record;
  v_trait record;
  v_today date := (now() at time zone 'Asia/Shanghai')::date;
begin
  for v_pet in
    select p.id, p.trait_id
    from public.pets p
    where p.id is not null
  loop
    -- 读取特质配置
    select * into v_trait from public.pet_traits
      where id = v_pet.trait_id and is_active = true;

    -- 如果没有绑定特质，使用无特质默认值
    if not found then
      select * into v_trait from public.pet_traits
        where name = '无特质' and is_active = true limit 1;
    end if;

    -- 全局重置：属性清零 + 叠加特质初始加成
    update public.pets set
      hunger = least(100, coalesce(v_trait.hunger_initial, 0)),
      clean = least(100, coalesce(v_trait.clean_initial, 0)),
      happiness = least(300, coalesce(v_trait.happiness_initial, 0)),
      last_check_at = now()
    where id = v_pet.id;
  end loop;
end;
$$;
revoke all on function public.run_daily_global_pet_reset() from public;
grant execute on function public.run_daily_global_pet_reset() to anon, authenticated;

-- ============================================================
-- 二、生病触发函数（基于last_care_date判断，替代days_zero_stats）
-- ============================================================
create or replace function public.check_pet_sickness(p_pet_id uuid)
returns void
language plpgsql security definer as $$
declare
  v_pet record;
  v_trait record;
  v_today date := (now() at time zone 'Asia/Shanghai')::date;
  v_days_no_care int;
  v_sick boolean;
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

  -- 计算连续无互动天数
  v_days_no_care := v_today - coalesce(v_pet.last_care_date, v_pet.last_check_at, v_today);

  -- 普通生病触发（连续N天无互动）
  if v_days_no_care >= coalesce(v_trait.sickness_days, 3) then
    -- 随机分配一种普通病
    if random() < 0.5 then
      update public.pets set has_stomach_issue = true, health = 0 where id = p_pet_id;
    else
      update public.pets set has_skin_issue = true, health = 0 where id = p_pet_id;
    end if;
  end if;

  -- 重病触发（连续N天无互动）
  if v_days_no_care >= coalesce(v_trait.severe_days, 7) then
    update public.pets set has_severe_illness = true, health = 0 where id = p_pet_id;
  end if;
end;
$$;
revoke all on function public.check_pet_sickness(uuid) from public;
grant execute on function public.check_pet_sickness(uuid) to anon, authenticated;

-- ============================================================
-- 三、更新托管调度时间到北京时间1:00
-- 注意：Supabase cron调度需在SQL Editor手动执行或通过Dashboard设置
-- 以下为参考调度SQL（如已有调度需先取消旧的）
-- ============================================================
-- 取消旧的0点调度（如果存在）
-- select cron.unschedule('daily-boarding-care');
-- 新建1点调度
-- select cron.schedule(
--   'daily-boarding-care',
--   '0 1 * * *',
--   $$select public.run_daily_boarding_care()$$
-- );

notify pgrst, 'reload schema';
