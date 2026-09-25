-- Reset "tudi" pet hunger and clean to 0, and trigger daily reset

update public.pets
set
  hunger = 0,
  clean = 0,
  happiness = 0,
  happiness_rounds = 0,
  last_check_at = '2020-01-01'::timestamptz
where name = '土地';
