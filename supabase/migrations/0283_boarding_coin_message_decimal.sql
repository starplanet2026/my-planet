-- 0283: 托管产金消息文案按实际入账金额展示（保留 1 位小数）
-- 背景：run_daily_boarding_care 实际把 base × 特质倍率（如 2 × 1.1 = 2.2）
-- 累加进 pets.coin_balance，但消息文案用 round(...)::int 显示成 2，
-- 与真实入账不一致。改为展示 1 位小数（2.0 显示为 2，2.2 显示为 2.2）。

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

  v_def := replace(
    v_def,
    'v_pet_display || '' 今日产金 '' || round(v_coin_final)::int || '' 金币''',
    'v_pet_display || '' 今日产金 '' || regexp_replace(round(v_coin_final, 1)::text, ''\.0$'', '''') || '' 金币'''
  );

  if position('round(v_coin_final)::int' in v_def) > 0 then
    raise exception 'run_daily_boarding_care coin message replace failed';
  end if;

  execute v_def;
end $$;
