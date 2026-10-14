-- 0250: 修复宠物重病触发与就医闭环
--
-- Bug1 根因：check_pet_sickness 开头 `if v_sick then return` —— 普通病(3天)触发后
--   函数永远早退，连续无照料满 severe_days(默认7天) 的重病升级永远无法触发。
--   实例：「测试-老用户保留」两只「10.18要去医院」已 10 天无照料，仍停在普通病。
-- 次因：定时任务 run_daily_global_pet_reset 只重置属性，不做生病判定，
--   生病只在用户打开宠物页(check_pet)时才评估，从未打开App的宠物永远不生病。
--
-- Bug2 根因：赵允翔/新 的宠物在库中已是重病，但前端就医入口藏在顶部提示条内
--   不明显（前端另行改造）；后端就医 RPC heal_severe_illness 功能完整，仅需：
--   a) 消耗统一为 200 星光（families.severe_illness_cost 现有一家20/一家200）
--   b) 就医后更新 last_care_date（就医算照料），否则治愈后第二天立刻再生病

-- ============================================================
-- 一、重写 check_pet_sickness：支持普通病→重病升级，重病优先判定
-- ============================================================
create or replace function public.check_pet_sickness(p_pet_id uuid)
returns void
language plpgsql security definer as $$
declare
  v_pet record;
  v_trait record;
  v_today date := (now() at time zone 'Asia/Shanghai')::date;
  v_days_no_care int;
  v_last_care_date date;
begin
  select * into v_pet from public.pets where id = p_pet_id for update;
  if not found then return; end if;

  -- 已是重病：不再重复触发（重病只能通过就医治愈）
  if coalesce(v_pet.has_severe_illness, false) then return; end if;

  -- 读取特质配置
  select * into v_trait from public.pet_traits
    where id = v_pet.trait_id and is_active = true;
  if not found then
    select * into v_trait from public.pet_traits
      where name = '无特质' and is_active = true limit 1;
  end if;

  -- 连续无照料天数：优先 last_care_date，从未照料过用领养日
  v_last_care_date := coalesce(
    v_pet.last_care_date,
    (v_pet.created_at at time zone 'Asia/Shanghai')::date
  );
  v_days_no_care := v_today - v_last_care_date;

  -- 重病触发（连续N天无照料）：优先判定。
  -- 普通病未愈同样会恶化升级为重病（修复旧版普通病触发后永远早退的问题）
  if v_days_no_care >= coalesce(v_trait.severe_days, 7) then
    update public.pets
      set has_severe_illness = true,
          has_stomach_issue = false,
          has_skin_issue = false,
          health = 0,
          is_sick = true
      where id = p_pet_id;
    return;
  end if;

  -- 普通生病触发（连续N天无照料，且当前未生普通病）
  if v_days_no_care >= coalesce(v_trait.sickness_days, 3)
     and not coalesce(v_pet.has_stomach_issue, false)
     and not coalesce(v_pet.has_skin_issue, false) then
    if random() < 0.5 then
      update public.pets set has_stomach_issue = true, health = 0, is_sick = true where id = p_pet_id;
    else
      update public.pets set has_skin_issue = true, health = 0, is_sick = true where id = p_pet_id;
    end if;
  end if;
end;
$$;
revoke all on function public.check_pet_sickness(uuid) from public;
grant execute on function public.check_pet_sickness(uuid) to anon, authenticated;

-- ============================================================
-- 二、每日0点全局重置追加全量生病判定（定时任务补全）
-- ============================================================
create or replace function public.run_daily_global_pet_reset()
returns void
language plpgsql security definer as $$
declare
  v_pet record;
  v_trait record;
begin
  for v_pet in
    select id, trait_id from public.pets
  loop
    select * into v_trait from public.pet_traits
      where id = v_pet.trait_id and is_active = true;
    if not found then
      select * into v_trait from public.pet_traits
        where name = '无特质' and is_active = true limit 1;
    end if;

    -- 全局重置：属性清零 + 叠加特质初始加成
    update public.pets set
      hunger = least(100, coalesce(v_trait.hunger_initial, 0)),
      clean = least(100, coalesce(v_trait.clean_initial, 0)),
      happiness = least(300, coalesce(v_trait.happiness_initial, 0)),
      last_check_at = now()
    where id = v_pet.id;

    -- 生病判定：每日对所有宠物执行（含从未打开App的宠物）
    perform public.check_pet_sickness(v_pet.id);
  end loop;
end;
$$;
revoke all on function public.run_daily_global_pet_reset() from public;
grant execute on function public.run_daily_global_pet_reset() to anon, authenticated;

-- ============================================================
-- 三、heal_severe_illness：默认消耗200 + 就医计为照料（更新last_care_date）
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
    v_pet.name, v_pet.name || ' 已治愈重病，恢复健康啦！');

  return query select true, '治疗成功，宠物已恢复健康', v_new_star;
end;
$$;

grant execute on function public.heal_severe_illness(uuid, uuid) to anon, authenticated;

-- ============================================================
-- 四、就医消耗统一为200：列默认值 + 存量数据
-- ============================================================
alter table public.families alter column severe_illness_cost set default 200;
update public.families set severe_illness_cost = 200 where coalesce(severe_illness_cost, 0) <> 200;

-- ============================================================
-- 五、存量数据修复：全量执行一次生病判定（普通病满 severe_days 升级为重病）
-- ============================================================
do $$
declare
  v_id uuid;
begin
  for v_id in select id from public.pets where not coalesce(has_severe_illness, false)
  loop
    perform public.check_pet_sickness(v_id);
  end loop;
end $$;

notify pgrst, 'reload schema';
