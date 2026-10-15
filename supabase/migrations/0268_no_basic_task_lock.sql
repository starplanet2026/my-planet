-- 0268 解锁判定口径调整：家长未标记任何基础任务时，第一档（基础任务完成）视作未完成
-- 背景：原逻辑 v_basic_done := (v_basic = 0) or (v_basic_matched >= v_basic) 将「无基础任务」视作
--       第一档已完成 → 未完成全部任务时也进入等级1（仅锁宠物店）
-- 新口径：无基础任务（v_basic = 0）时第一档未完成 → 等级2（全部锁定），
--         需完成当日全部已发布任务才解锁（all_done → 等级0）
-- 保持不变：家长未发布任何任务（published = 0）仍视作全部完成（等级0）

create or replace function public.get_study_unlock_state(p_member_id uuid)
returns table(basic_done boolean, all_done boolean, published_count int, basic_count int)
language plpgsql security definer stable as $$
declare
  v_published int := 0; v_basic int := 0; v_matched int := 0; v_basic_matched int := 0;
  v_today date := (now() at time zone 'Asia/Shanghai')::date;
  v_basic_done boolean; v_all_done boolean;
begin
  with published as (
    select t.text, t.is_basic from public.study_task_templates t
    where t.member_id = p_member_id and t.selected = true
  ), done as (
    select distinct x->>'text' as text
    from public.study_records sr
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(sr.tasks) = 'array' then sr.tasks else '[]'::jsonb end) x
    where sr.member_id = p_member_id and sr.review_status = 'approved'
      and (sr.created_at at time zone 'Asia/Shanghai')::date = v_today
      and jsonb_typeof(x) = 'object' and coalesce((x->>'done')::boolean, false)
  )
  select count(*), count(*) filter (where p.is_basic),
         count(*) filter (where d.text is not null),
         count(*) filter (where p.is_basic and d.text is not null)
    into v_published, v_basic, v_matched, v_basic_matched
  from published p left join done d on d.text = p.text;

  if v_published = 0 then
    v_basic_done := true; v_all_done := true;
  else
    v_basic_done := (v_basic > 0 and v_basic_matched >= v_basic);
    v_all_done := (v_matched >= v_published);
  end if;
  return query select v_basic_done, v_all_done, v_published, v_basic;
end; $$;

grant execute on function public.get_study_unlock_state(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
