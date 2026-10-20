-- 0279: 陪伴学习不再给宠物增加经验
-- 业务规则（一直以来）：陪伴学习审核通过只发放「星光值 + 宠物心情值」，不增加宠物经验。
-- 宠物经验仅来自：宠物互动（喂食/清洁/玩耍）与萌宠托管。
--
-- 本次修正两处旧错误逻辑：
--   1) approve_study_record（家长审核通过）：移除按 happiness_gain 折算经验、升级、升级金币等逻辑
--   2) 删除 study_reward 的 4 参数旧版重载：该版本会按分钟直接加经验并升级，已无前端调用
--      （前端实际调用的是 6 参数版本，仅插入 pending 待审核记录，不发奖）

create or replace function public.approve_study_record(p_record_id uuid, p_reviewer_id uuid)
returns table(success boolean, message text, star_granted integer, happiness_granted integer)
language plpgsql security definer as $$
declare
  v_rec record;
  v_pet record;
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
    return query select false, '该记录已审核'::text, 0, 0;
    return;
  end if;

  v_star := coalesce(v_rec.star_earned, 0);
  v_happiness := coalesce(v_rec.happiness_gain, 0);

  -- 发放星光值
  if v_star > 0 then
    update public.members set star_value = star_value + v_star, updated_at = now()
    where id = v_rec.member_id;
  end if;

  -- 只增加宠物心情值（上限为当前血量上限），不增加经验
  if v_rec.pet_id is not null then
    select * into v_pet from public.pets where id = v_rec.pet_id for update;
    if found then
      update public.pets set
        happiness = least(coalesce(v_pet.current_max_blood, 100), v_pet.happiness + v_happiness)
      where id = v_rec.pet_id;
    end if;
  end if;

  update public.study_records set
    review_status = 'approved',
    reviewed_at = now(),
    reviewed_by = p_reviewer_id
  where id = p_record_id;

  -- 写入审核通过消息（不再出现「宠物升级啦」）
  v_msg := '陪伴学习审核通过！获得 ' || v_star || ' 星光值'
    || case when v_happiness > 0 then '，宠物心情 +' || v_happiness else '' end;
  perform public.add_pet_message(v_rec.member_id, v_rec.pet_id, 'study_approved',
    v_rec.pet_name, v_msg);

  return query select true,
    '审核通过！心情+' || v_happiness || '，星光+' || v_star,
    v_star, v_happiness;
end;
$$;
grant execute on function public.approve_study_record(uuid, uuid) to anon, authenticated;

-- 删除会直接加经验的 4 参数旧版（保留仅写待审核记录的 6 参数版本）
drop function if exists public.study_reward(uuid, integer, integer, uuid);

notify pgrst, 'reload schema';
