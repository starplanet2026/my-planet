-- 0101: Allow custom subjects on challenge_levels
-- Reason: 管理员可新建自定义学科，不再限制为语文/数学/英语

alter table public.challenge_levels
  drop constraint if exists challenge_levels_subject_check;

alter table public.challenge_levels
  add constraint challenge_levels_subject_check
  check (subject is null or length(trim(subject)) > 0);

notify pgrst, 'reload schema';
