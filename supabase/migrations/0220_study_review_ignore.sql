-- 0220: 陪伴学习审核 - 新增"忽略"功能
-- 需求：家长审核页在"驳回"下增加"忽略"按钮，忽略后该申请
--   1) 从家长审核列表消失（不再 pending）
--   2) 不在孩子前端学习记录列表展示
--   3) 不发放任何奖励（与驳回一致）
-- 实现：
--   1) study_records.review_status 新增 'ignored' 取值
--   2) 新增 RPC: ignore_study_record（设 status=ignored，不发放奖励）
--   3) 重写 get_study_records：过滤掉 'ignored' 记录，孩子端不再展示
--   4) get_pending_study_reviews 已按 review_status='pending' 过滤，无需修改

-- ============================================================
-- 1) review_status 检查约束新增 'ignored'
-- ============================================================
alter table public.study_records
  drop constraint if exists study_records_review_status_check;
alter table public.study_records
  add constraint study_records_review_status_check
  check (review_status in ('pending','approved','rejected','ignored'));

-- ============================================================
-- 2) 新增 ignore_study_record RPC
--    与 reject_study_record 区别：不发奖、不写备注、状态为 ignored
--    孩子端 get_study_records 会过滤掉 ignored 记录
-- ============================================================
create or replace function public.ignore_study_record(
  p_record_id uuid,
  p_reviewer_id uuid
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
    review_status = 'ignored',
    reviewed_at = now(),
    reviewed_by = p_reviewer_id
  where id = p_record_id;

  return query select true, '已忽略'::text;
end;
$$;

grant execute on function public.ignore_study_record(uuid, uuid) to anon, authenticated;

-- ============================================================
-- 3) 重写 get_study_records：过滤掉 'ignored' 记录
--    孩子端"学习记录"列表不再展示被忽略的申请
-- ============================================================
drop function if exists public.get_study_records(uuid, int);
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
    and sr.review_status <> 'ignored'
  order by sr.created_at desc
  limit p_limit;
end;
$$;

grant execute on function public.get_study_records(uuid, int) to anon, authenticated;
