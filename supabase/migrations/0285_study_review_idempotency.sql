-- 0285: 陪伴学习提交/审核幂等 + 历史重复审核清理
-- 背景：
--   1) study_reward 的「5 分钟内相同 minutes+tasks」去重只查 pending，且并发请求互相看不到
--      未提交事务，快速连点会同时插入多条 pending（已出现 4 条同一秒的记录）。
--   2) get_pending_study_reviews 用 distinct on 折叠展示，审核掉一条后其余重复记录仍在
--      pending，列表刷新后重新出现，家长可反复审核，星光/心情重复发放。
-- 方案：
--   新增 submission_token 提交令牌 + 唯一索引（真正数据库级幂等）；
--   study_reward 支持令牌并兜底唯一冲突；审核通过/驳回时把同组重复 pending 置为 ignored；
--   历史 approved 重复记录保留最早一条，删除其余并回滚星光/心情，写清理日志。

-- ============================================================
-- 一、提交令牌与唯一索引
-- ============================================================
alter table public.study_records
  add column if not exists submission_token uuid;

comment on column public.study_records.submission_token is
  '学生单次学习提交的幂等令牌，同一令牌只允许生成一条待审核记录';

create unique index if not exists uq_study_records_member_token
  on public.study_records(member_id, submission_token)
  where submission_token is not null;

-- ============================================================
-- 二、study_reward：令牌幂等 + 唯一冲突兜底 + 旧客户端 5 分钟去重
-- ============================================================
drop function if exists public.study_reward(uuid, integer, integer, uuid, jsonb, integer);

create or replace function public.study_reward(
  p_member_id uuid,
  p_minutes integer,
  p_reward integer default 0,
  p_pet_id uuid default null,
  p_tasks jsonb default null,
  p_star_earned integer default 0,
  p_submission_token uuid default null
)
returns table(success boolean, message text, happiness_gain integer)
language plpgsql
security definer
as $function$
declare
  v_pet_name text := null;
  v_token_gain int;
  v_dup_id uuid;
begin
  -- 令牌幂等：同一令牌已存在则直接返回成功，不重复插入
  if p_submission_token is not null then
    select sr.happiness_gain into v_token_gain
    from public.study_records sr
    where sr.member_id = p_member_id
      and sr.submission_token = p_submission_token
    limit 1;

    if found then
      return query select true, '已提交审核，等待家长确认'::text, coalesce(v_token_gain, p_minutes);
      return;
    end if;
  end if;

  -- 旧客户端兜底：同一成员 5 分钟内已存在相同 minutes + tasks 的 pending 记录，视为重复提交
  select sr.id into v_dup_id
  from public.study_records sr
  where sr.member_id = p_member_id
    and sr.review_status = 'pending'
    and sr.minutes = p_minutes
    and sr.created_at > now() - interval '5 minutes'
    and (sr.tasks = p_tasks or (sr.tasks is null and p_tasks is null))
  limit 1;

  if v_dup_id is not null then
    return query select true, '已提交审核，等待家长确认'::text, p_minutes;
    return;
  end if;

  -- 取宠物名（仅用于记录展示，不发奖）
  if p_pet_id is not null then
    select name into v_pet_name from public.pets where id = p_pet_id;
  end if;

  -- 仅插入待审核记录；happiness_gain 暂存为分钟数（审核通过后才真正发放）
  begin
    insert into public.study_records
      (member_id, pet_id, pet_name, minutes, happiness_gain, star_earned, tasks, review_status, submission_token)
    values
      (p_member_id, p_pet_id, v_pet_name, p_minutes, p_minutes, p_star_earned, p_tasks, 'pending', p_submission_token);
  exception when unique_violation then
    -- 并发下同一令牌被另一个请求抢先插入：按幂等处理
    return query select true, '已提交审核，等待家长确认'::text, p_minutes;
    return;
  end;

  return query select true, '已提交审核，等待家长确认'::text, p_minutes;
end;
$function$;

-- ============================================================
-- 三、审核函数：统一提示文案 + 同组重复 pending 自动忽略
-- ============================================================
create or replace function public.approve_study_record(p_record_id uuid, p_reviewer_id uuid)
returns table(success boolean, message text, star_granted integer, happiness_granted integer)
language plpgsql
security definer
as $function$
declare
  v_rec record;
  v_star int := 0;
  v_happiness int := 0;
  v_msg text;
begin
  select * into v_rec from public.study_records where id = p_record_id for update;
  if not found then
    return query select false, '记录不存在'::text, 0, 0;
    return;
  end if;
  if v_rec.review_status <> 'pending' then
    return query select false, '该任务已审核完成'::text, 0, 0;
    return;
  end if;

  v_star := coalesce(v_rec.star_earned, 0);
  v_happiness := coalesce(v_rec.happiness_gain, 0);

  -- 发放星光值
  if v_star > 0 then
    update public.members set star_value = star_value + v_star, updated_at = now()
    where id = v_rec.member_id;
  end if;

  -- 只增加宠物心情值（上限恒为 300），不增加经验
  if v_rec.pet_id is not null then
    update public.pets set
      happiness = least(300, happiness + v_happiness)
    where id = v_rec.pet_id;
  end if;

  update public.study_records set
    review_status = 'approved',
    reviewed_at = now(),
    reviewed_by = p_reviewer_id
  where id = p_record_id;

  -- 同一次提交产生的重复 pending 记录一并忽略，避免审核后再次出现在列表
  update public.study_records sr set
    review_status = 'ignored',
    review_note = '重复提交自动忽略',
    reviewed_at = now(),
    reviewed_by = p_reviewer_id
  where sr.member_id = v_rec.member_id
    and sr.id <> p_record_id
    and sr.review_status = 'pending'
    and sr.minutes = v_rec.minutes
    and sr.pet_id is not distinct from v_rec.pet_id
    and sr.tasks is not distinct from v_rec.tasks
    and sr.created_at between v_rec.created_at - interval '5 minutes'
                            and v_rec.created_at + interval '5 minutes';

  v_msg := '陪伴学习审核通过！获得 ' || v_star || ' 星光值'
    || case when v_happiness > 0 then '，宠物心情 +' || v_happiness else '' end;
  perform public.add_pet_message(v_rec.member_id, v_rec.pet_id, 'study_approved',
    v_rec.pet_name, v_msg);

  return query select true,
    '审核通过！心情+' || v_happiness || '，星光+' || v_star,
    v_star, v_happiness;
end;
$function$;

create or replace function public.reject_study_record(p_record_id uuid, p_reviewer_id uuid, p_note text default null)
returns table(success boolean, message text)
language plpgsql
security definer
as $function$
declare
  v_rec record;
  v_msg text;
begin
  select * into v_rec from public.study_records where id = p_record_id for update;
  if not found then
    return query select false, '记录不存在'::text;
    return;
  end if;
  if v_rec.review_status <> 'pending' then
    return query select false, '该任务已审核完成'::text;
    return;
  end if;

  update public.study_records set
    review_status = 'rejected',
    review_note = p_note,
    reviewed_at = now(),
    reviewed_by = p_reviewer_id
  where id = p_record_id;

  -- 同一次提交产生的重复 pending 记录一并忽略
  update public.study_records sr set
    review_status = 'ignored',
    review_note = '重复提交自动忽略',
    reviewed_at = now(),
    reviewed_by = p_reviewer_id
  where sr.member_id = v_rec.member_id
    and sr.id <> p_record_id
    and sr.review_status = 'pending'
    and sr.minutes = v_rec.minutes
    and sr.pet_id is not distinct from v_rec.pet_id
    and sr.tasks is not distinct from v_rec.tasks
    and sr.created_at between v_rec.created_at - interval '5 minutes'
                            and v_rec.created_at + interval '5 minutes';

  -- 写入驳回消息
  v_msg := '陪伴学习审核未通过'
    || case when p_note is not null and length(trim(p_note)) > 0 then '：' || p_note else '，请重新提交' end;
  perform public.add_pet_message(v_rec.member_id, v_rec.pet_id, 'study_rejected',
    v_rec.pet_name, v_msg);

  return query select true, '已驳回'::text;
end;
$function$;

create or replace function public.ignore_study_record(p_record_id uuid, p_reviewer_id uuid)
returns table(success boolean, message text)
language plpgsql
security definer
as $function$
declare
  v_rec record;
begin
  select * into v_rec from public.study_records where id = p_record_id for update;
  if not found then
    return query select false, '记录不存在'::text;
    return;
  end if;
  if v_rec.review_status <> 'pending' then
    return query select false, '该任务已审核完成'::text;
    return;
  end if;

  update public.study_records set
    review_status = 'ignored',
    reviewed_at = now(),
    reviewed_by = p_reviewer_id
  where id = p_record_id;

  return query select true, '已忽略'::text;
end;
$function$;

-- ============================================================
-- 四、待审核列表：去掉 distinct on，改为逐条返回
--    （重复记录已由上方的插入幂等与审核忽略收敛）
-- ============================================================
create or replace function public.get_pending_study_reviews(p_family_id uuid)
returns table(id uuid, member_id uuid, member_name text, pet_name text, minutes integer,
              happiness_gain integer, star_earned integer, tasks jsonb,
              created_at timestamp with time zone, review_status text)
language plpgsql
security definer
as $function$
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
$function$;

-- ============================================================
-- 五、历史重复 pending：保留最早一条，其余置为 ignored
-- ============================================================
with ranked as (
  select sr.id,
         row_number() over (
           partition by sr.member_id, sr.pet_id, sr.minutes,
                         md5(coalesce(sr.tasks::text, '')),
                         date_trunc('second', sr.created_at)
           order by sr.created_at
         ) as rn
  from public.study_records sr
  where sr.review_status = 'pending'
)
update public.study_records sr set
  review_status = 'ignored',
  review_note = '历史重复提交自动忽略',
  reviewed_at = now()
from ranked r
where r.id = sr.id and r.rn > 1;

-- ============================================================
-- 六、历史重复 approved：保留最早一条，删除其余并回滚奖励
-- ============================================================
create table if not exists public.study_review_cleanup_log (
  record_id uuid primary key,
  member_id uuid,
  pet_id uuid,
  keep_record_id uuid,
  minutes integer,
  star_refunded integer not null default 0,
  happiness_reverted integer not null default 0,
  record_snapshot jsonb,
  created_at timestamp with time zone not null default now()
);

comment on table public.study_review_cleanup_log is
  '陪伴学习重复审核清理台账：记录被删除的重复审核单据及回滚金额';

-- 以「同一成员 + 宠物 + 分钟数 + 任务内容」为组，相邻审核时间 <= 5 分钟视为同一次提交重复审核
create temporary table _study_dup_approved on commit drop as
with ordered as (
  select sr.*,
         lag(sr.id) over w as prev_id,
         lag(sr.created_at) over w as prev_at
  from public.study_records sr
  where sr.review_status = 'approved'
  window w as (
    partition by sr.member_id, sr.pet_id, sr.minutes, md5(coalesce(sr.tasks::text, ''))
    order by sr.created_at
  )
)
select * from ordered
where prev_at is not null
  and created_at - prev_at <= interval '5 minutes';

-- 仅处理尚未记入台账的记录（保证重复执行幂等）
create temporary table _study_dup_new on commit drop as
select d.*
from _study_dup_approved d
where not exists (
  select 1 from public.study_review_cleanup_log l where l.record_id = d.id
);

insert into public.study_review_cleanup_log
  (record_id, member_id, pet_id, keep_record_id, minutes, star_refunded, happiness_reverted, record_snapshot)
select id, member_id, pet_id, prev_id, minutes,
       coalesce(star_earned, 0), coalesce(happiness_gain, 0), to_jsonb(d)
from _study_dup_new d;

-- 回滚多发的星光值
update public.members m
set star_value = greatest(0, m.star_value - x.star_sum), updated_at = now()
from (
  select member_id, sum(coalesce(star_earned, 0)) as star_sum
  from _study_dup_new
  group by member_id
) x
where m.id = x.member_id and x.star_sum > 0;

-- 回滚多发的宠物心情（不扣成负数）
update public.pets p
set happiness = greatest(0, p.happiness - x.hap_sum)
from (
  select pet_id, sum(coalesce(happiness_gain, 0)) as hap_sum
  from _study_dup_new
  where pet_id is not null
  group by pet_id
) x
where p.id = x.pet_id and x.hap_sum > 0;

-- 删除重复审核单据
delete from public.study_records sr
using _study_dup_new d
where sr.id = d.id;

notify pgrst, 'reload schema';
