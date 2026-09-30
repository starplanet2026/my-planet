-- 0169: 陪伴学习审核结果写入宠物消息 + 未读标记
-- 1) pet_messages 新增 read 列（未读标记）
-- 2) event_type 新增 'study_approved' / 'study_rejected'
-- 3) approve_study_record / reject_study_record 审核后写入消息
-- 4) 新增 mark_pet_messages_read RPC（打开消息面板时标记已读）

-- ============================================================
-- 1) pet_messages 新增 read 列
-- ============================================================
alter table public.pet_messages
  add column if not exists read boolean not null default false;

create index if not exists idx_pet_messages_unread
  on public.pet_messages(member_id, read) where read = false;

-- ============================================================
-- 2) 扩展 event_type 约束
-- ============================================================
alter table public.pet_messages
  drop constraint if exists pet_messages_event_type_check;
alter table public.pet_messages
  add constraint pet_messages_event_type_check
  check (event_type in ('level_up','coin_harvest','sick','new_pet','level_reward','study_approved','study_rejected'));

-- ============================================================
-- 3) 重写 approve_study_record：审核通过后写入消息
-- ============================================================
drop function if exists public.approve_study_record(uuid, uuid);
create or replace function public.approve_study_record(
  p_record_id uuid,
  p_reviewer_id uuid
)
returns table(success boolean, message text, star_granted int, happiness_granted int)
language plpgsql security definer as $$
declare
  v_rec record;
  v_pet record;
  v_exp_gain int;
  v_new_exp int;
  v_exp_needed int;
  v_level_up boolean := false;
  v_coin_earned int := 0;
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

  if v_star > 0 then
    update public.members set star_value = star_value + v_star, updated_at = now()
    where id = v_rec.member_id;
  end if;

  if v_rec.pet_id is not null then
    select * into v_pet from public.pets where id = v_rec.pet_id for update;
    if found then
      v_exp_gain := (v_happiness / 10) * 10;
      v_new_exp := coalesce(v_pet.exp, 0) + v_exp_gain;
      v_exp_needed := public.exp_needed(v_pet.level);
      if v_new_exp >= v_exp_needed and v_pet.level < coalesce(v_pet.max_level, 3) then
        v_level_up := true;
        v_new_exp := v_new_exp - v_exp_needed;
        v_coin_earned := coalesce(v_pet.upgrade_coin_reward, 5);
        update public.pets set
          level = v_pet.level + 1,
          exp = v_new_exp,
          happiness = least(coalesce(v_pet.current_max_blood, 100), v_pet.happiness + v_happiness),
          current_max_blood = round(coalesce(v_pet.current_max_blood, 100) * 1.05)::int,
          daily_decay_base = coalesce(v_pet.daily_decay_base, 5) + 1,
          coin_balance = coalesce(v_pet.coin_balance, 0) + v_coin_earned
        where id = v_rec.pet_id;
        update public.members set coin_balance = coin_balance + v_coin_earned, updated_at = now()
        where id = v_rec.member_id;
      else
        update public.pets set
          exp = v_new_exp,
          happiness = least(coalesce(v_pet.current_max_blood, 100), v_pet.happiness + v_happiness)
        where id = v_rec.pet_id;
      end if;
    end if;
  end if;

  update public.study_records set
    review_status = 'approved',
    reviewed_at = now(),
    reviewed_by = p_reviewer_id
  where id = p_record_id;

  -- 写入审核通过消息
  v_msg := '陪伴学习审核通过！获得 ' || v_star || ' 星光值'
    || case when v_happiness > 0 then '，宠物心情 +' || v_happiness else '' end
    || case when v_level_up then '，宠物升级啦！' else '' end;
  perform public.add_pet_message(v_rec.member_id, v_rec.pet_id, 'study_approved',
    v_rec.pet_name, v_msg);

  return query select true,
    case
      when v_level_up then '审核通过！心情+' || v_happiness || '，星光+' || v_star || '，宠物升级！+' || v_coin_earned || '金币'
      else '审核通过！心情+' || v_happiness || '，星光+' || v_star
    end,
    v_star, v_happiness;
end;
$$;
grant execute on function public.approve_study_record(uuid, uuid) to anon, authenticated;

-- ============================================================
-- 4) 重写 reject_study_record：驳回后写入消息
-- ============================================================
drop function if exists public.reject_study_record(uuid, uuid, text);
create or replace function public.reject_study_record(
  p_record_id uuid,
  p_reviewer_id uuid,
  p_note text default null
)
returns table(success boolean, message text)
language plpgsql security definer as $$
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
    return query select false, '该记录已审核'::text;
    return;
  end if;

  update public.study_records set
    review_status = 'rejected',
    review_note = p_note,
    reviewed_at = now(),
    reviewed_by = p_reviewer_id
  where id = p_record_id;

  -- 写入驳回消息
  v_msg := '陪伴学习审核未通过'
    || case when p_note is not null and length(trim(p_note)) > 0 then '：' || p_note else '，请重新提交' end;
  perform public.add_pet_message(v_rec.member_id, v_rec.pet_id, 'study_rejected',
    v_rec.pet_name, v_msg);

  return query select true, '已驳回'::text;
end;
$$;
grant execute on function public.reject_study_record(uuid, uuid, text) to anon, authenticated;

-- ============================================================
-- 5) 标记所有宠物消息为已读
-- ============================================================
create or replace function public.mark_pet_messages_read(p_member_id uuid)
returns void language plpgsql security definer as $$
begin
  update public.pet_messages set read = true
  where member_id = p_member_id and read = false;
end;
$$;
grant execute on function public.mark_pet_messages_read(uuid) to anon, authenticated;
