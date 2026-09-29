-- 0145: 修复 submit_recitation_result 中 ref_id 类型错误（uuid vs text）
drop function if exists public.submit_recitation_result(uuid, uuid, int, text);
create or replace function public.submit_recitation_result(
  p_instance_id uuid,
  p_member_id uuid,
  p_score int,
  p_recognized_text text
)
returns table(success boolean, message text, passed boolean, awarded_stars int, new_star int)
language plpgsql security definer as $$
declare
  v_inst record;
  v_task record;
  v_member record;
  v_family_id uuid;
  v_passed boolean;
  v_award int := 0;
  v_new_star int;
  v_reward_text text;
begin
  select * into v_inst from public.recitation_instances
    where id = p_instance_id and member_id = p_member_id for update;
  if not found then
    return query select false, '作业实例不存在或无权操作', false, 0, 0;
    return;
  end if;
  if v_inst.status <> 'pending' then
    return query select false, '该作业已提交，不可重复提交', false, 0, 0;
    return;
  end if;

  select * into v_task from public.recitation_tasks where id = v_inst.task_id;
  if not found then
    return query select false, '任务模板已被删除', false, 0, 0;
    return;
  end if;

  select * into v_member from public.members where id = p_member_id for update;
  if not found then
    return query select false, '用户不存在', false, 0, 0;
    return;
  end if;
  v_family_id := v_member.family_id;

  v_passed := (p_score >= coalesce(v_task.pass_threshold, 60));

  if v_passed then
    if v_task.reward_tier1_min is not null
       and p_score between v_task.reward_tier1_min and coalesce(v_task.reward_tier1_max, v_task.reward_tier1_min)
       and coalesce(v_task.reward_tier1_stars, 0) > 0 then
      v_award := v_task.reward_tier1_stars;
    elsif v_task.reward_tier2_min is not null
       and p_score between v_task.reward_tier2_min and coalesce(v_task.reward_tier2_max, v_task.reward_tier2_min)
       and coalesce(v_task.reward_tier2_stars, 0) > 0 then
      v_award := v_task.reward_tier2_stars;
    elsif v_task.reward_tier3_min is not null
       and p_score between v_task.reward_tier3_min and coalesce(v_task.reward_tier3_max, v_task.reward_tier3_min)
       and coalesce(v_task.reward_tier3_stars, 0) > 0 then
      v_award := v_task.reward_tier3_stars;
    end if;
  end if;

  if v_award > 0 then
    v_new_star := v_member.star_value + v_award;
    update public.members set star_value = v_new_star, updated_at = now() where id = p_member_id;

    v_reward_text := '背诵任务：《' || v_task.title || '》得分 ' || p_score::text || ' 奖励';
    insert into public.coin_records
      (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by, balance_type)
    values
      (v_family_id, p_member_id, v_award, v_new_star,
       v_reward_text, 'recitation', 'recitation_instance', p_instance_id, p_member_id, 'star');
  else
    v_new_star := v_member.star_value;
  end if;

  insert into public.question_records (family_id, member_id, is_correct, reward_star, source)
  values (v_family_id, p_member_id, v_passed, v_award, '背诵任务');

  update public.recitation_instances
    set status = 'submitted',
        score = p_score,
        passed = v_passed,
        recognized_text = p_recognized_text,
        awarded_stars = v_award,
        submitted_at = now()
    where id = p_instance_id;

  return query select true, '提交成功', v_passed, v_award, v_new_star;
end;
$$;
grant execute on function public.submit_recitation_result(uuid, uuid, int, text) to anon, authenticated;
