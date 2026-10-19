-- 0273: 进修每日星光调整 —— 普通稀有度 5⭐/天 → 10⭐/天（稀有 20 / 史诗 50 不变）

create or replace function public.study_daily_star(p_rarity text)
returns int language sql immutable as $$
  select case p_rarity
    when 'common' then 10
    when 'rare' then 20
    when 'epic' then 50
    else 0
  end;
$$;
revoke all on function public.study_daily_star(text) from public;
grant execute on function public.study_daily_star(text) to anon, authenticated;

notify pgrst, 'reload schema';
