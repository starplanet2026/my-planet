-- 0192: 修复 finish_challenge_level 硬编码通关奖励为 3，改为读取关卡 pass_reward
-- 背景：finish_challenge_level 中 v_level_reward 硬编码为 3，
--       未读取 challenge_levels.pass_reward，导致后台配置 30 但实际只发 3。
-- 同时补发历史用户少领的星光值差额。

-- ====================================================
-- 一、重写 finish_challenge_level：读取 pass_reward
-- ====================================================
drop function if exists public.finish_challenge_level(uuid, uuid);

create or replace function public.finish_challenge_level(
  p_member_id uuid,
  p_level_id uuid
)
returns table(level_awarded boolean, level_reward int, set_awarded boolean, set_reward int, new_star int)
language plpgsql security definer as $$
declare
  v_level public.challenge_levels%rowtype;
  v_set public.challenge_sets%rowtype;
  v_set_id uuid;
  v_total int;
  v_mastered int;
  v_star int;
  v_level_reward int;
  v_set_reward int := 0;
  v_level_awarded boolean := false;
  v_set_awarded boolean := false;
  v_family_id uuid;
begin
  select * into v_level from public.challenge_levels where id = p_level_id;
  if not found then raise exception '关卡不存在'; end if;

  -- 读取关卡配置的通关奖励，null 时回退到默认 3
  v_level_reward := coalesce(v_level.pass_reward, 3);

  v_set_id := v_level.challenge_set_id;

  select count(*) into v_total from public.questions
    where level_id = p_level_id and is_active = true;
  select count(*) into v_mastered from public.question_progress p
    where p.member_id = p_member_id and p.is_mastered = true
      and p.question_id in (select id from public.questions where level_id = p_level_id and is_active = true);

  if v_total = 0 or v_mastered < v_total then
    select star_value into v_star from public.members where id = p_member_id;
    return query select false, 0, false, 0, v_star;
    return;
  end if;

  select family_id into v_family_id from public.members where id = p_member_id;

  begin
    insert into public.level_clear_log (member_id, level_id, reward_star)
    values (p_member_id, p_level_id, v_level_reward);
    v_level_awarded := true;
    select star_value into v_star from public.members where id = p_member_id for update;
    v_star := v_star + v_level_reward;
    update public.members set star_value = v_star, updated_at = now() where id = p_member_id;
    perform public.add_session_stars(p_member_id, v_level_reward);
  exception when unique_violation then
    v_level_awarded := false;
    select star_value into v_star from public.members where id = p_member_id;
  end;

  -- 题集全部通关检查
  select count(*) into v_total from public.questions q
    join public.challenge_levels l on l.id = q.level_id
    where l.challenge_set_id = v_set_id and q.is_active = true;
  select count(*) into v_mastered from public.question_progress p
    where p.member_id = p_member_id and p.is_mastered = true
      and p.question_id in (
        select q.id from public.questions q
        join public.challenge_levels l on l.id = q.level_id
        where l.challenge_set_id = v_set_id and q.is_active = true
      );

  if v_total > 0 and v_mastered >= v_total then
    v_set_reward := floor(v_total::numeric / 5)::int;
    if v_set_reward > 0 then
      begin
        insert into public.set_clear_log (member_id, challenge_set_id, reward_star)
        values (p_member_id, v_set_id, v_set_reward);
        v_set_awarded := true;
        select star_value into v_star from public.members where id = p_member_id for update;
        v_star := v_star + v_set_reward;
        update public.members set star_value = v_star, updated_at = now() where id = p_member_id;
        perform public.add_session_stars(p_member_id, v_set_reward);
      exception when unique_violation then
        v_set_awarded := false;
        select star_value into v_star from public.members where id = p_member_id;
      end;
    end if;
  end if;

  return query select v_level_awarded, v_level_reward, v_set_awarded, v_set_reward, v_star;
end;
$$;

grant execute on function public.finish_challenge_level(uuid, uuid) to anon, authenticated;

-- ====================================================
-- 二、补发历史用户少领的关卡通关奖励差额
--   level_clear_log.reward_star 记录了实际发放值（硬编码 3），
--   challenge_levels.pass_reward 是后台配置值。
--   差额 = pass_reward - reward_star，补发到 member.star_value。
-- ====================================================
do $$
declare
  r record;
  v_diff int;
  v_count int := 0;
begin
  for r in
    select l.member_id, l.level_id, l.reward_star as logged_reward,
           coalesce(c.pass_reward, 3) as configured_reward
    from public.level_clear_log l
    join public.challenge_levels c on c.id = l.level_id
    where coalesce(c.pass_reward, 3) > l.reward_star
  loop
    v_diff := r.configured_reward - r.logged_reward;
    -- 补发星光值
    update public.members
      set star_value = star_value + v_diff, updated_at = now()
      where id = r.member_id;
    -- 修正日志记录为正确值
    update public.level_clear_log
      set reward_star = r.configured_reward
      where member_id = r.member_id and level_id = r.level_id;
    v_count := v_count + 1;
  end loop;
  raise notice '补发关卡奖励差额: % 条记录', v_count;
end $$;
