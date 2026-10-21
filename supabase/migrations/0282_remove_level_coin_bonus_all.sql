-- 0282: 删除「等级越高日产金越高」的残留公式
-- 背景：0271 假设日产金唯一路径是 run_daily_boarding_care，漏掉了
--   interact_with_pet 中「四项属性满值后自动发币」的路径，该路径仍保留
--   base × (1 + (level-1) × 0.1) × 特质倍率 的等级加成。
-- 现统一为：日产金 = base_coin_per_day × 特质金币倍率（1/2/5 由商品配置写死）。

do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'interact_with_pet';

  if v_def is null then
    raise exception 'function interact_with_pet not found';
  end if;

  v_def := regexp_replace(
    v_def,
    'v_daily_coin\s*:=\s*coalesce\(v_pet\.base_coin_per_day,\s*1\)\s*\*\s*\(1\s*\+\s*\(coalesce\(v_pet\.level,\s*1\)\s*-\s*1\)\s*\*\s*0\.1\);',
    'v_daily_coin := coalesce(v_pet.base_coin_per_day, 1);'
  );

  if position('(coalesce(v_pet.level, 1) - 1) * 0.1' in v_def) > 0 then
    raise exception 'interact_with_pet level coin bonus replace failed';
  end if;

  execute v_def;
end $$;

notify pgrst, 'reload schema';
