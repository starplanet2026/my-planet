-- 0280: 回退陪伴学习错误赠送的宠物经验与等级
-- 背景：历史 approve_study_record 会把 happiness_gain 折算成经验加给宠物，违反「陪伴学习不加经验」的业务规则。
-- 本迁移只回退 level / exp / exp_to_next / pending_levelup 四个字段。
-- 不处理：星光补偿、金币扣除（由运营手动操作）；current_max_blood、daily_decay_base（另行排查）。
-- 幂等：已回退过的宠物记录在 study_exp_rollback_log 中，重复执行会跳过。

create table if not exists public.study_exp_rollback_log (
  pet_id uuid primary key,
  pet_name text,
  old_level int,
  new_level int,
  old_exp int,
  new_exp int,
  wrong_exp int,
  rolled_back_at timestamptz not null default now()
);

do $$
declare
  v_pet record;
  v_wrong int;
  v_ne int;
  v_nl int;
  v_need int;
  v_next int;
begin
  for v_pet in
    select p.id, p.name, p.level, p.exp, p.max_level,
           coalesce(p.rarity, 'common') as rarity
    from public.pets p
    where exists (
      select 1 from public.study_records s
      where s.pet_id = p.id and s.review_status = 'approved'
    )
    and not exists (
      select 1 from public.study_exp_rollback_log l where l.pet_id = p.id
    )
    order by p.id
  loop
    select coalesce(sum((s.happiness_gain / 10) * 10), 0) into v_wrong
    from public.study_records s
    where s.pet_id = v_pet.id and s.review_status = 'approved';

    v_nl := coalesce(v_pet.level, 1);
    v_ne := coalesce(v_pet.exp, 0);

    if v_wrong > 0 then
      v_ne := v_ne - v_wrong;

      -- 经验扣成负数时逐级回落，并把上一级的升级门槛加回来
      while v_ne < 0 and v_nl > 1 loop
        v_nl := v_nl - 1;
        v_need := public.exp_needed(v_nl, v_pet.rarity);
        v_ne := v_ne + v_need;
      end loop;

      v_ne := greatest(v_ne, 0);
      v_next := public.exp_needed(v_nl, v_pet.rarity);

      update public.pets
        set level = v_nl,
            exp = v_ne,
            exp_to_next = v_next,
            pending_levelup = false
        where id = v_pet.id;
    end if;

    insert into public.study_exp_rollback_log
      (pet_id, pet_name, old_level, new_level, old_exp, new_exp, wrong_exp)
    values
      (v_pet.id, v_pet.name, v_pet.level, v_nl, coalesce(v_pet.exp, 0), v_ne, v_wrong)
    on conflict (pet_id) do nothing;
  end loop;
end $$;

notify pgrst, 'reload schema';
