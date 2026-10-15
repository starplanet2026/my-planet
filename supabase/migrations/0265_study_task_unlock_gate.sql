-- 0265: 陪伴学习任务分级解锁萌宠星球功能
-- ------------------------------------------------------------------
-- 需求：陪伴学习任务完成状态分级解锁萌宠星球板块功能（仅限制前端手动点击）
--   第一层（基础任务）：完成当日全部【基础任务】→ 解锁萌宠星球除宠物店外的全部功能
--                       并解锁底部「领取成就 / 特权兑换 / 我的星球」三个板块
--   第二层（全部任务）：完成当日全部已发布任务 → 解锁【宠物店】入口
--   无已发布任务时视作全部完成；权限每日重置；后台托管定时任务不受限制
--
-- 本迁移只做三件事：
--   1) study_task_templates 增加 is_basic 字段（家长端标记「基础任务」）
--   2) 收紧孩子端更新策略：is_basic / subject 不允许孩子修改
--   3) 新增 RPC get_study_unlock_state：返回当日两层解锁状态（实时计算，无新增存储字段）
--
-- 「完成」口径：仅统计「家长审核通过(approved)」的当日学习记录中的 done 任务
-- 当日换日按北京时间 (now() at time zone 'Asia/Shanghai')::date
-- ------------------------------------------------------------------

-- ============================================================
-- 1) 基础任务标记字段
-- ============================================================
alter table public.study_task_templates
  add column if not exists is_basic boolean not null default false;

-- ============================================================
-- 2) 收紧孩子端更新策略（沿用 0168，补 is_basic / subject 不可变，防止越权改标记）
-- ============================================================
drop policy if exists "study_task_templates_child_select" on public.study_task_templates;
create policy "study_task_templates_child_select" on public.study_task_templates
  for update to authenticated
  using (true)
  with check (
    (text = (select text from public.study_task_templates where id = study_task_templates.id))
    and (reward = (select reward from public.study_task_templates where id = study_task_templates.id))
    and (member_id = (select member_id from public.study_task_templates where id = study_task_templates.id))
    and (display_order = (select display_order from public.study_task_templates where id = study_task_templates.id))
    and (subject = (select subject from public.study_task_templates where id = study_task_templates.id))
    and (is_basic = (select is_basic from public.study_task_templates where id = study_task_templates.id))
  );

-- ============================================================
-- 3) 当日解锁状态 RPC
--    basic_done   ：当日基础任务是否全部完成（无基础任务视作完成）
--    all_done     ：当日已发布任务是否全部完成（无已发布任务视作完成）
--    published_count / basic_count：已发布任务数 / 其中的基础任务数
-- ============================================================
create or replace function public.get_study_unlock_state(p_member_id uuid)
returns table(basic_done boolean, all_done boolean, published_count int, basic_count int)
language plpgsql security definer stable as $$
declare
  v_published int := 0;
  v_basic int := 0;
  v_matched int := 0;
  v_basic_matched int := 0;
  v_today date := (now() at time zone 'Asia/Shanghai')::date;
  v_basic_done boolean;
  v_all_done boolean;
begin
  with published as (
    select t.text, t.is_basic
    from public.study_task_templates t
    where t.member_id = p_member_id
      and t.selected = true
  ),
  done as (
    select distinct x->>'text' as text
    from public.study_records sr
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(sr.tasks) = 'array' then sr.tasks else '[]'::jsonb end
    ) x
    where sr.member_id = p_member_id
      and sr.review_status = 'approved'
      and (sr.created_at at time zone 'Asia/Shanghai')::date = v_today
      and jsonb_typeof(x) = 'object'
      and coalesce((x->>'done')::boolean, false)
  )
  select count(*),
         count(*) filter (where p.is_basic),
         count(*) filter (where d.text is not null),
         count(*) filter (where p.is_basic and d.text is not null)
    into v_published, v_basic, v_matched, v_basic_matched
  from published p
  left join done d on d.text = p.text;

  if v_published = 0 then
    -- 家长未发布任务：视作全部完成
    v_basic_done := true;
    v_all_done := true;
  else
    v_basic_done := (v_basic = 0) or (v_basic_matched >= v_basic);
    v_all_done := (v_matched >= v_published);
  end if;

  return query select v_basic_done, v_all_done, v_published, v_basic;
end;
$$;

grant execute on function public.get_study_unlock_state(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
