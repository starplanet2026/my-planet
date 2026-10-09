-- 诊断：找出所有生病宠物及生病原因
-- 在 Supabase SQL Editor 运行，把结果发我
select
  p.id,
  p.name,
  p.breed,
  m.name as owner,
  p.created_at,
  p.last_care_date,
  p.last_feed_date,
  p.last_clean_date,
  p.last_happiness_date,
  p.last_check_at,
  p.has_stomach_issue as stomach,
  p.has_skin_issue as skin,
  p.has_severe_illness as severe,
  p.is_sick,
  p.trait_id,
  t.sickness_days,
  t.severe_days,
  -- 实际生病判断使用的"最后照料日期"（last_care_date 为 null 时回退到 created_at）
  coalesce(p.last_care_date, (p.created_at at time zone 'Asia/Shanghai')::date) as effective_care_date,
  -- 距今天数（>=3 即触发生病）
  ((now() at time zone 'Asia/Shanghai')::date
    - coalesce(p.last_care_date, (p.created_at at time zone 'Asia/Shanghai')::date)) as days_no_care,
  -- 距领养天数
  ((now() at time zone 'Asia/Shanghai')::date
    - (p.created_at at time zone 'Asia/Shanghai')::date) as days_since_adoption
from public.pets p
left join public.members m on m.id = p.member_id
left join public.pet_traits t on t.id = p.trait_id
where coalesce(p.has_stomach_issue, false)
   or coalesce(p.has_skin_issue, false)
   or coalesce(p.has_severe_illness, false)
   or p.is_sick = true
order by p.created_at desc;
