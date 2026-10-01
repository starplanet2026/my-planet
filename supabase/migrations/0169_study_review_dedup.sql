-- 0169: 修复陪伴学习审核重复数据问题
-- 1) study_reward 增加去重校验：同一成员 5 分钟内已有 pending 记录则不重复插入
-- 2) 清理历史重复 pending 记录（按 member_id + minutes + tasks 分组，保留最早一条）
-- 3) get_pending_study_reviews 增加 distinct 去重兜底

-- ============================================================
-- 1) 重写 study_reward：插入前去重
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
  v_dup_id uuid;
begin
  -- 去重校验：同一成员 5 分钟内已存在相同 minutes + tasks 的 pending 记录，视为重复提交
  select sr.id into v_dup_id
  from public.study_records sr
  where sr.member_id = p_member_id
    and sr.review_status = 'pending'
    and sr.minutes = p_minutes
    and sr.created_at > now() - interval '5 minutes'
    and (sr.tasks = p_tasks or (sr.tasks is null and p_tasks is null))
  limit 1;

  if v_dup_id is not null then
    -- 重复提交：不插入新记录，直接返回成功
    return query select true, '已提交审核，等待家长确认'::text, p_minutes;
    return;
  end if;

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
-- 2) 清理历史重复 pending 记录
--    按 (member_id, minutes, tasks) 分组，保留最早一条，删除其余重复
-- ============================================================
delete from public.study_records
where review_status = 'pending'
  and id in (
    select id
    from (
      select id,
             row_number() over (
               partition by member_id, minutes, tasks
               order by created_at asc, id asc
             ) as rn
      from public.study_records
      where review_status = 'pending'
    ) t
    where t.rn > 1
  );

-- ============================================================
-- 3) get_pending_study_reviews 增加 distinct 去重兜底
-- ============================================================
drop function if exists public.get_pending_study_reviews(uuid);
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
  select distinct on (sr.member_id, sr.minutes, sr.tasks)
         sr.id, sr.member_id, m.name, sr.pet_name, sr.minutes,
         sr.happiness_gain, sr.star_earned, sr.tasks, sr.created_at, sr.review_status
  from public.study_records sr
  join public.members m on m.id = sr.member_id
  where m.family_id = p_family_id
    and sr.review_status = 'pending'
  order by sr.member_id, sr.minutes, sr.tasks, sr.created_at desc;
end;
$$;

grant execute on function public.get_pending_study_reviews(uuid) to anon, authenticated;
