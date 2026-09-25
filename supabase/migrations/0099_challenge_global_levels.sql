-- 0099: Global level library + set-level many-to-many ref
-- 1. challenge_levels -> top-level entity (nullable set_id, add subject/target_section/published)
-- 2. New junction table challenge_set_levels (set_id, level_id, sort_order)
-- 3. Migrate existing levels to global library + create junction records
-- 4. Rewrite get_challenge_boards RPC (add standalone levels per board)

-- ============================================================
-- 1. challenge_levels schema changes
-- ============================================================

-- Drop old FK (on delete cascade) and unique constraint
alter table public.challenge_levels
  drop constraint if exists challenge_levels_challenge_set_id_fkey;
alter table public.challenge_levels
  drop constraint if exists challenge_levels_challenge_set_id_level_no_key;

-- Make challenge_set_id nullable (legacy compat, no longer the link)
alter table public.challenge_levels
  alter column challenge_set_id drop not null;

-- Re-add FK with on delete set null (delete set won't delete global level)
alter table public.challenge_levels
  add constraint challenge_levels_challenge_set_id_fkey
  foreign key (challenge_set_id) references public.challenge_sets(id)
  on delete set null;

-- Add new columns
alter table public.challenge_levels
  add column if not exists subject text
  check (subject is null or subject in ('语文','数学','英语'));

alter table public.challenge_levels
  add column if not exists target_section text
  check (target_section is null or target_section in ('today_review','gap_check','advance'));

alter table public.challenge_levels
  add column if not exists published boolean not null default false;

-- ============================================================
-- 2. Junction table: challenge_set_levels
-- ============================================================

create table if not exists public.challenge_set_levels (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references public.challenge_sets(id) on delete cascade,
  level_id uuid not null references public.challenge_levels(id) on delete cascade,
  sort_order int not null default 1,
  created_at timestamptz not null default now(),
  unique (set_id, level_id)
);

create index if not exists idx_csl_set on public.challenge_set_levels(set_id);
create index if not exists idx_csl_level on public.challenge_set_levels(level_id);

alter table public.challenge_set_levels enable row level security;
create policy "csl_select" on public.challenge_set_levels for select using (true);
create policy "csl_insert" on public.challenge_set_levels for insert with check (true);
create policy "csl_update" on public.challenge_set_levels for update using (true);
create policy "csl_delete" on public.challenge_set_levels for delete using (true);

-- ============================================================
-- 3. Migrate existing data
-- ============================================================

-- 3.1 Create junction records for existing set-level relationships
insert into public.challenge_set_levels (set_id, level_id, sort_order)
select l.challenge_set_id, l.id, l.level_no
from public.challenge_levels l
where l.challenge_set_id is not null
  and not exists (
    select 1 from public.challenge_set_levels c
    where c.level_id = l.id and c.set_id = l.challenge_set_id
  )
on conflict (set_id, level_id) do nothing;

-- 3.2 Backfill target_section from set.board (only for non-wrong_battle boards)
update public.challenge_levels l
  set target_section = s.board
  from public.challenge_sets s
  where l.challenge_set_id = s.id
    and s.board in ('today_review','gap_check','advance')
    and l.target_section is null;

-- 3.3 Backfill published from status='active'
update public.challenge_levels set published = true where status = 'active';

-- ============================================================
-- 4. Rewrite get_challenge_boards RPC
--    Each board now includes: sets (with levels via junction) + standalone levels
-- ============================================================

create or replace function public.get_challenge_boards(p_member_id uuid)
returns jsonb
language plpgsql security definer as $$
declare
  v_result jsonb;
begin
  select jsonb_agg(
    jsonb_build_object(
      'board', s.board,
      'sets', (
        select coalesce(jsonb_agg(
          jsonb_build_object(
            'id', cs.id,
            'title', cs.title,
            'description', cs.description,
            'type', cs.type,
            'status', cs.status,
            'reward_easy', cs.reward_easy,
            'reward_medium', cs.reward_medium,
            'reward_hard', cs.reward_hard,
            'knowledge_points', cs.knowledge_points,
            'easy_count', (
              select count(*) from public.questions q
              join public.challenge_set_levels csl on csl.level_id = q.level_id
              where csl.set_id = cs.id and q.is_active = true and q.difficulty = 'easy'
            ),
            'medium_count', (
              select count(*) from public.questions q
              join public.challenge_set_levels csl on csl.level_id = q.level_id
              where csl.set_id = cs.id and q.is_active = true and q.difficulty = 'medium'
            ),
            'hard_count', (
              select count(*) from public.questions q
              join public.challenge_set_levels csl on csl.level_id = q.level_id
              where csl.set_id = cs.id and q.is_active = true and q.difficulty = 'hard'
            ),
            'levels', (
              select coalesce(jsonb_agg(
                jsonb_build_object(
                  'id', lv.id,
                  'level_no', lv.level_no,
                  'sort_order', csl.sort_order,
                  'title', lv.title,
                  'description', lv.description,
                  'pass_reward', lv.pass_reward,
                  'status', lv.status,
                  'subject', lv.subject,
                  'target_section', lv.target_section,
                  'total', (select count(*) from public.questions q where q.level_id = lv.id and q.is_active = true),
                  'mastered', (
                    select count(*) from public.question_progress p
                    where p.question_id in (select id from public.questions where level_id = lv.id and is_active = true)
                      and p.member_id = p_member_id
                      and p.is_mastered = true
                  ),
                  'is_cleared', (
                    select coalesce(bool_and(p.is_mastered), false) from public.question_progress p
                    where p.question_id in (select id from public.questions where level_id = lv.id and is_active = true)
                      and p.member_id = p_member_id
                  ),
                  'is_paused', (
                    select exists(
                      select 1 from public.challenge_level_progress clp
                      where clp.level_id = lv.id and clp.member_id = p_member_id and clp.is_paused = true
                    )
                  ),
                  'cleared_ids', (
                    select coalesce(array_agg(p.question_id), '{}')
                    from public.question_progress p
                    where p.question_id in (select id from public.questions where level_id = lv.id and is_active = true)
                      and p.member_id = p_member_id
                      and p.is_mastered = true
                  )
                )
                order by csl.sort_order
              ), '[]'::jsonb)
              from public.challenge_set_levels csl
              join public.challenge_levels lv on lv.id = csl.level_id
              where csl.set_id = cs.id and lv.status = 'active'
            )
          )
          order by cs.created_at desc
        ), '[]'::jsonb)
        from public.challenge_sets cs
        where cs.board = s.board
      ),
      'levels', (
        select coalesce(jsonb_agg(
          jsonb_build_object(
            'id', lv.id,
            'level_no', lv.level_no,
            'sort_order', 0,
            'title', lv.title,
            'description', lv.description,
            'pass_reward', lv.pass_reward,
            'status', lv.status,
            'subject', lv.subject,
            'target_section', lv.target_section,
            'total', (select count(*) from public.questions q where q.level_id = lv.id and q.is_active = true),
            'mastered', (
              select count(*) from public.question_progress p
              where p.question_id in (select id from public.questions where level_id = lv.id and is_active = true)
                and p.member_id = p_member_id
                and p.is_mastered = true
            ),
            'is_cleared', (
              select coalesce(bool_and(p.is_mastered), false) from public.question_progress p
              where p.question_id in (select id from public.questions where level_id = lv.id and is_active = true)
                and p.member_id = p_member_id
            ),
            'is_paused', (
              select exists(
                select 1 from public.challenge_level_progress clp
                where clp.level_id = lv.id and clp.member_id = p_member_id and clp.is_paused = true
              )
            ),
            'cleared_ids', (
              select coalesce(array_agg(p.question_id), '{}')
              from public.question_progress p
              where p.question_id in (select id from public.questions where level_id = lv.id and is_active = true)
                and p.member_id = p_member_id
                and p.is_mastered = true
            )
          )
          order by lv.created_at desc
        ), '[]'::jsonb)
        from public.challenge_levels lv
        where lv.published = true
          and lv.target_section = s.board
          and s.board in ('today_review','gap_check','advance')
      )
    )
  )
  into v_result
  from (
    select 'today_review' as board
    union all select 'gap_check'
    union all select 'wrong_battle'
    union all select 'advance'
  ) s;

  return coalesce(v_result, '[]'::jsonb);
end;
$$;

grant execute on function public.get_challenge_boards(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
