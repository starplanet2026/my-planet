-- 0136: 修复 get_gacha_config 列名歧义
-- 原因：RETURNS TABLE(adopt_cost int, ...) 的输出列名会成为同名变量，
--       函数体内 select adopt_cost, ... 同时匹配"输出变量"和"表字段"，
--       报 column reference "adopt_cost" is ambiguous。
-- 修复：给 gacha_config 表加别名 c，select 中所有列用 c. 限定。

DROP FUNCTION IF EXISTS public.get_gacha_config();
CREATE OR REPLACE FUNCTION public.get_gacha_config()
RETURNS TABLE(
  adopt_cost int,
  cancel_penalty int,
  rarity_common_prob numeric,
  rarity_rare_prob numeric,
  rarity_epic_prob numeric
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
begin
  return query select
    c.adopt_cost,
    c.cancel_penalty,
    c.rarity_common_prob,
    c.rarity_rare_prob,
    c.rarity_epic_prob
    from public.gacha_config c
    where c.id = 1;
end;
$$;
GRANT EXECUTE ON FUNCTION public.get_gacha_config() TO anon, authenticated;
