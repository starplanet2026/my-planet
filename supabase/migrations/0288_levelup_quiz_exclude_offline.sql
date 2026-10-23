-- 0288: 升级挑战题目队列剔除已下线/已删除的错题
-- Bug：题目队列持久化后（0230），家长在后台将错题下线或从错题池删除，
--       get_pet_levelup_quiz_queue 仍原样返回队列中的题目，导致已下线/删除的题
--       继续出现在升级挑战里。
-- 修复：读取队列时同步清理——凡在错题池中已非 active（下线/删除）或题目本身
--       已被删除的记录，从队列中物理删除，再返回剩余题目。
-- 效果：队列被清空时前端会自动走重新抽题逻辑（PetLevelUpQuiz.loadQuestions 第2步）。

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
language plpgsql security definer as $$
begin
  -- 清理已下线/已删除的题：
  -- 1) 错题池中不存在该题的 active 记录（被下线或从池中删除）
  -- 2) questions 表中题目已不存在（被物理删除）
  delete from public.pet_levelup_quiz_queue q
  where q.member_id = p_member_id
    and q.pet_id = p_pet_id
    and (
      not exists (
        select 1 from public.wrong_battle_pool wbp
        where wbp.member_id = q.member_id
          and wbp.question_id = q.question_id
          and wbp.status = 'active'
      )
      or not exists (
        select 1 from public.questions qs
        where qs.id = q.question_id
      )
    );

  return query
  select q.id, q.question_id, q.sort_order,
         qs.type, qs.question_text, qs.options, qs.correct_answer, qs.answer2, qs.explanation, qs.difficulty
  from public.pet_levelup_quiz_queue q
  join public.questions qs on qs.id = q.question_id
  join public.wrong_battle_pool wbp
    on wbp.member_id = q.member_id
   and wbp.question_id = q.question_id
   and wbp.status = 'active'
  where q.member_id = p_member_id and q.pet_id = p_pet_id
  order by q.sort_order;
end;
$$;

grant execute on function public.get_pet_levelup_quiz_queue(uuid, uuid) to anon, authenticated;
