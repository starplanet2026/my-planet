-- 0216: 修复三个问题
-- 1. check_pet_sickness 中 date - timestamptz 产生 interval 导致 integer 转换失败
--    报错：invalid input syntax for type integer: "1 day"
-- 2. run_daily_global_pet_reset 从未调度 cron，导致北京时间0点属性未重置
-- 3. 修正托管 cron 时间注释

-- ============================================================
-- 一、修复 check_pet_sickness：last_check_at 是 timestamptz，
--    与 date 相减会得到 interval 而非 integer
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

  -- 计算连续无互动天数：
  -- last_care_date 是 date，last_check_at 是 timestamptz
  -- 必须先把 last_check_at 转成 date，否则 date - timestamptz = interval
  v_last_care_date := coalesce(
    v_pet.last_care_date,
    (v_pet.last_check_at at time zone 'Asia/Shanghai')::date,
    v_today
  );
  v_days_no_care := v_today - v_last_care_date;

  -- 普通生病触发（连续N天无互动）
  if v_days_no_care >= coalesce(v_trait.sickness_days, 3) then
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
-- 二、调度 run_daily_global_pet_reset 到北京时间0点（UTC 16:00）
--    注意：需早于 boarding care（UTC 16:00）执行，
--    这里设为 UTC 15:59（北京时间 23:59）确保先重置属性
-- ============================================================
do $$
begin
  if exists (select 1 from cron.job where jobname = 'daily_global_pet_reset') then
    perform cron.unschedule('daily_global_pet_reset');
  end if;
end $$;

select cron.schedule(
  'daily_global_pet_reset',
  '59 15 * * *',
  $$select public.run_daily_global_pet_reset();$$
);

notify pgrst, 'reload schema';
