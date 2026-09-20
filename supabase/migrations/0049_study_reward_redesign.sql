-- 0049: 陪伴学习奖励重设计
-- 1) study_reward：不再发星光值，改为恢复宠物心情值（= 学习分钟数），保留经验增长
-- 2) study_task_reward：完成单条学习任务时发放对应星光值
-- ============================================================

-- 1) 重建 study_reward：取消 p_reward（保留参数兼容旧调用，但不再加星光值），改为恢复 happiness
drop function if exists public.study_reward(uuid, int, int, uuid);
create or replace function public.study_reward(
  p_member_id uuid,
  p_minutes int,
  p_reward int default 0,        -- 保留参数兼容旧前端，但不再使用
  p_pet_id uuid default null
)
returns table(success boolean, message text, happiness_gain int)
language plpgsql security definer as $$
declare
  v_pet record;
  v_exp_gain int;
  v_happiness_gain int;
  v_new_exp int;
  v_exp_needed int;
  v_level_up boolean := false;
  v_coin_earned int := 0;
begin
  v_happiness_gain := greatest(0, p_minutes);

  if p_pet_id is not null then
    select * into v_pet from public.pets where public.pets.id = p_pet_id for update;
    if found then
      v_exp_gain := (p_minutes / 10) * 10;
      v_new_exp := coalesce(v_pet.exp, 0) + v_exp_gain;
      v_exp_needed := public.exp_needed(v_pet.level);

      if v_new_exp >= v_exp_needed and v_pet.level < coalesce(v_pet.max_level, 3) then
        v_level_up := true;
        v_new_exp := v_new_exp - v_exp_needed;
        v_coin_earned := coalesce(v_pet.upgrade_coin_reward, 5);

        update public.pets set
          level = v_pet.level + 1,
          exp = v_new_exp,
          happiness = least(coalesce(v_pet.current_max_blood, 100), v_pet.happiness + v_happiness_gain),
          current_max_blood = round(coalesce(v_pet.current_max_blood, 100) * 1.05)::int,
          daily_decay_base = coalesce(v_pet.daily_decay_base, 5) + 1,
          coin_balance = coalesce(v_pet.coin_balance, 0) + v_coin_earned
        where public.pets.id = p_pet_id;

        update public.members set coin_balance = coin_balance + v_coin_earned, updated_at = now()
        where public.members.id = p_member_id;
      else
        update public.pets set
          exp = v_new_exp,
          happiness = least(coalesce(v_pet.current_max_blood, 100), v_pet.happiness + v_happiness_gain)
        where public.pets.id = p_pet_id;
      end if;
    end if;
  end if;

  return query select true,
    case
      when v_level_up then '学习完成！宠物心情恢复' || v_happiness_gain || '点，升级啦！+' || v_coin_earned || '金币'
      when p_pet_id is not null then '学习完成！宠物心情恢复' || v_happiness_gain || '点，获得' || v_exp_gain || '经验'
      else '学习完成！'
    end,
    v_happiness_gain;
end;
$$;

grant execute on function public.study_reward(uuid, int, int, uuid) to anon, authenticated;

-- 2) 新增 study_task_reward：完成单条学习任务发放星光值
create or replace function public.study_task_reward(
  p_member_id uuid,
  p_reward int
)
returns table(success boolean, message text, new_star int)
language plpgsql security definer as $$
declare
  v_new_star int := 0;
begin
  if p_reward <= 0 then
    return query select true, '无奖励'::text, 0;
    return;
  end if;

  update public.members set star_value = star_value + p_reward, updated_at = now()
  where public.members.id = p_member_id
  returning star_value into v_new_star;

  return query select true, '获得' || p_reward || '星光值'::text, v_new_star;
end;
$$;

grant execute on function public.study_task_reward(uuid, int) to anon, authenticated;
