-- 0100: Make questions.challenge_set_id nullable
-- Reason: questions now belong to levels (level_id), not directly to sets.
-- SetDetail no longer shows questions directly; question CRUD moves to LevelDetail.
-- A standalone level may have no set, so challenge_set_id must allow NULL.

alter table public.questions
  alter column challenge_set_id drop not null;

notify pgrst, 'reload schema';
