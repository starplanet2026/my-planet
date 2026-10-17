-- 0271: 日产金币去等级加成（方案A）+ 进化产金固定化
-- 背景：日产金币唯一产金路径为 run_daily_boarding_care，原公式
--   base × (1 + upgrade_percent% × (level-1)) × 特质倍率
-- 与全站 UI 展示的 base 值不符（家长预期"商店标的 5 就是 5"）。
-- 改为：日产 = base_coin_per_day × 特质 coin_multiplier。
-- 同时修复 evolve_pet 的随机产金（2+random()→2.0、3+random()→3.0），
-- 避免进化后基础产金出现 2.26 之类不可预期的随机小数。

-- 1) run_daily_boarding_care：产金公式去等级加成
do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'run_daily_boarding_care';

  if v_def is null then
    raise exception 'function run_daily_boarding_care not found';
  end if;

  if position('upgrade_percent, 10.0' in v_def) > 0 then
    v_def := regexp_replace(v_def,
      'v_daily_coin\s*:=\s*coalesce\(v_pet\.base_coin_per_day,\s*0\)\s*\*\s*\(1\.0\s*\+\s*coalesce\(v_pet\.upgrade_percent,\s*10\.0\)\s*/\s*100\.0\s*\*\s*\(coalesce\(v_pet\.level,\s*1\)\s*-\s*1\)\);\s*v_coin_final\s*:=\s*v_daily_coin\s*\*\s*coalesce\(v_trait\.coin_multiplier,\s*1\.0\);',
      'v_coin_final := coalesce(v_pet.base_coin_per_day, 0) * coalesce(v_trait.coin_multiplier, 1.0);'
    );
    if position('upgrade_percent, 10.0' in v_def) > 0 then
      raise exception 'run_daily_boarding_care coin formula replace failed';
    end if;
    execute v_def;
  end if;
end $$;

-- 2) evolve_pet：随机产金改固定值
do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'evolve_pet';

  if v_def is null then
    raise exception 'function evolve_pet not found';
  end if;

  if position('random()' in v_def) > 0 then
    v_def := regexp_replace(v_def, 'v_new_base_coin\s*:=\s*2\s*\+\s*random\(\)\s*;', 'v_new_base_coin := 2.0;');
    v_def := regexp_replace(v_def, 'v_new_base_coin\s*:=\s*3\s*\+\s*random\(\)\s*;', 'v_new_base_coin := 3.0;');
    execute v_def;
  end if;
end $$;

notify pgrst, 'reload schema';
