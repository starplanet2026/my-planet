-- 0230: 宠物升级挑战题目队列持久化
-- 解决：用户关闭重开升级挑战会刷新题目，可规避不想做的题
-- 逻辑：首次打开分配题目并持久化；答对的题目从队列移除；未答对/未答的保留；通过/关闭清空队列

create table if not exists public.pet_levelup_quiz_queue (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  pet_id uuid not null,
  question_id uuid not null,
  sort_order int not null default 0,
  assigned_at timestamptz not null default now()
);

create index if not exists idx_pet_levelup_quiz_queue_member_pet
  on public.pet_levelup_quiz_queue(member_id, pet_id);

-- 获取队列中未完成的题目（按 sort_order 排序，关联 questions 表取题面）
create or replace function public.get_pet_levelup_quiz_queue(
  p_member_id uuid,
  p_pet_id uuid
)
returns table(
  queue_id uuid,
  question_id uuid,
  sort_order int,
  type text,
  question_text text,
  options jsonb,
  correct_answer text,
  answer2 text,
  explanation text,
  difficulty text
)
language sql security definer as $$
  select q.id, q.question_id, q.sort_order,
         qs.type, qs.question_text, qs.options, qs.correct_answer, qs.answer2, qs.explanation, qs.difficulty
  from public.pet_levelup_quiz_queue q
  join public.questions qs on qs.id = q.question_id
  where q.member_id = p_member_id and q.pet_id = p_pet_id
  order by q.sort_order;
$$;

-- 分配题目（先清空旧队列再插入）
create or replace function public.assign_pet_levelup_quiz(
  p_member_id uuid,
  p_pet_id uuid,
  p_question_ids uuid[]
)
returns void
language plpgsql security definer as $$
begin
  delete from public.pet_levelup_quiz_queue
    where member_id = p_member_id and pet_id = p_pet_id;

  insert into public.pet_levelup_quiz_queue (member_id, pet_id, question_id, sort_order)
  select p_member_id, p_pet_id, unnest(p_question_ids),
         generate_series(1, array_length(p_question_ids, 1));
end;
$$;

-- 从队列移除单题（答对时调用）
create or replace function public.remove_pet_levelup_quiz_question(
  p_member_id uuid,
  p_pet_id uuid,
  p_question_id uuid
)
returns void
language sql security definer as $$
  delete from public.pet_levelup_quiz_queue
  where member_id = p_member_id and pet_id = p_pet_id and question_id = p_question_id;
$$;

-- 清空队列（通过/关闭时调用）
create or replace function public.clear_pet_levelup_quiz_queue(
  p_member_id uuid,
  p_pet_id uuid
)
returns void
language sql security definer as $$
  delete from public.pet_levelup_quiz_queue
  where member_id = p_member_id and pet_id = p_pet_id;
$$;

grant select, insert, update, delete on public.pet_levelup_quiz_queue to anon, authenticated;
grant execute on function public.get_pet_levelup_quiz_queue(uuid, uuid) to anon, authenticated;
grant execute on function public.assign_pet_levelup_quiz(uuid, uuid, uuid[]) to anon, authenticated;
grant execute on function public.remove_pet_levelup_quiz_question(uuid, uuid, uuid) to anon, authenticated;
grant execute on function public.clear_pet_levelup_quiz_queue(uuid, uuid) to anon, authenticated;
