-- 0251: 修复重病就医 RPC 点击「去医院」报错（两处阻断缺陷）
--
-- 根因1：heal_severe_illness 向 coin_records 写入流水时 category='medical'，
--   但 coin_records_category_check 约束（0150 起）的合法值中没有 medical，
--   INSERT 违反 check 约束导致整个函数抛错回滚。0171 版本起该 RPC 就无法走通，
--   此前一直没有重症宠物实际触发。
--
-- 根因2：治愈消息使用 v_pet.name || ' 已治愈重病…' 拼接，而 name 为 null 的宠物
--   （赵允翔两只均未命名，界面展示品种名）在 PostgreSQL 中 null || text = null，
--   写入 pet_messages.message（NOT NULL）再次抛错。
--
-- 修复：① 约束合法值新增 medical（not valid，沿用 0146/0150 对存量行的处理方式）；
--      ② 重写 heal_severe_illness，消息拼接改为 coalesce(name, breed, '宠物')。

-- ============================================================
-- 一、coin_records category 约束新增 medical
-- ============================================================
alter table public.coin_records drop constraint if exists coin_records_category_check;
alter table public.coin_records add constraint coin_records_category_check
  check (category in (
    'task','purchase','manual','system','task_reject','manual_adjust',
    'challenge','shop','boarding','evolve','study','upgrade',
    'dictation','recitation','lucky_wheel','medical'
  )) not valid;

-- ============================================================
-- 二、重写 heal_severe_illness：修复未命名宠物治愈消息为 null
-- ============================================================
create or replace function public.heal_severe_illness(
  p_member_id uuid,
  p_pet_id uuid
)
returns table(success boolean, message text, new_star int)
language plpgsql security definer as $$
declare
  v_pet record;
  v_member record;
  v_family record;
  v_cost int;
  v_new_star int;
  v_pet_name text;
begin
  select * into v_pet from public.pets where public.pets.id = p_pet_id for update;
  if not found then
    return query select false, '宠物不存在', 0;
    return;
  end if;
  if v_pet.member_id <> p_member_id then
    return query select false, '无权操作', 0;
    return;
  end if;
  if not coalesce(v_pet.has_severe_illness, false) then
    return query select false, '宠物没有重症', 0;
    return;
  end if;

  select * into v_member from public.members where id = p_member_id for update;
  select * into v_family from public.families where id = v_member.family_id;

  -- 重病就医消耗：默认200星光
  v_cost := coalesce(v_family.severe_illness_cost, 200);

  if v_member.star_value < v_cost then
    return query select false, '星光值不足，需要 ' || v_cost || ' 星光值', v_member.star_value;
    return;
  end if;

  -- 宠物展示名：未命名时回退品种名，避免 null || text = null
  v_pet_name := coalesce(v_pet.name, v_pet.breed, '宠物');

  -- 扣除星光值
  v_new_star := v_member.star_value - v_cost;
  update public.members set star_value = v_new_star, updated_at = now() where id = p_member_id;

  -- 星光消耗流水
  insert into public.coin_records (family_id, member_id, amount, balance_after, reason, category, ref_type, ref_id, created_by, balance_type)
  values (v_member.family_id, p_member_id, -v_cost, v_new_star,
    '重病就医消耗星光值', 'medical', 'pet', p_pet_id, p_member_id, 'star');

  -- 重置宠物：健康值恢复100，清除所有疾病标记，属性清零；
  -- 就医算一次照料，更新 last_care_date 避免治愈后立即再触发生病
  update public.pets set
    has_severe_illness = false,
    has_stomach_issue = false,
    has_skin_issue = false,
    is_sick = false,
    health = 100,
    hunger = 0,
    clean = 0,
    happiness = 0,
    days_without_feed = 0,
    days_without_clean = 0,
    days_without_care = 0,
    days_zero_stats = 0,
    last_care_date = (now() at time zone 'Asia/Shanghai')::date,
    last_check_at = now()
  where public.pets.id = p_pet_id;

  -- 写入治愈消息
  perform public.add_pet_message(p_member_id, p_pet_id, 'sick',
    v_pet_name, v_pet_name || ' 已治愈重病，恢复健康啦！');

  return query select true, '治疗成功，宠物已恢复健康', v_new_star;
end;
$$;

grant execute on function public.heal_severe_illness(uuid, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
