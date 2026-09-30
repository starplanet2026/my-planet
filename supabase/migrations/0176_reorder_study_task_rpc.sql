-- 0176: 修复陪伴学习任务拖拽排序 RLS 报错
-- 根因：reorderStudyTaskTemplates 用 upsert（INSERT ON CONFLICT）操作，
--        触发 INSERT 路径的 RLS WITH CHECK 检查；
--        study_task_templates 的 RLS 策略只对 authenticated 生效，anon 被拦截
-- 修复：新增 security definer 的 RPC，绕过 RLS 做 UPDATE（仅更新 display_order）

create or replace function public.reorder_study_task_templates(p_ids uuid[])
returns void
language plpgsql security definer as $$
declare
  i int;
begin
  for i in 1..array_length(p_ids, 1) loop
    update public.study_task_templates
    set display_order = i
    where id = p_ids[i];
  end loop;
end;
$$;

revoke all on function public.reorder_study_task_templates(uuid[]) from public;
grant execute on function public.reorder_study_task_templates(uuid[]) to anon, authenticated;

notify pgrst, 'reload schema';
