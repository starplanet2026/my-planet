-- 0106_auto_feed_wrong_battle_pool.sql
-- 智慧星战：答错自动进入错题混战池
-- 需求：智慧星战板块内所有关卡和题集所产生的错题都进入错题混战池；萌宠闯关单词错词不进。
-- 实现要点：
--   1. wrong_battle_pool 新增 source_level_id 列（补齐关卡来源维度，原有 source_challenge_set_id 保留题集维度）
--   2. 重写 answer_question：答错分支追加「自动入池」（IF NOT EXISTS 去重，复用已有 (member_id, question_id) where status='active' 唯一索引）
--   3. answer_word（萌宠单词）走独立 RPC，本迁移不动 → 单词错词天然不进池
--   4. added_by 留 NULL（区别于家长手动导入：手动导入 added_by = 家长 member_id）

-- ① 池表补关卡来源列
alter table public.wrong_battle_pool
  add column if not exists source_level_id uuid references public.challenge_levels(id) on delete set null;

create index if not exists idx_wbp_level on public.wrong_battle_pool(source_level_id);

-- ② 重写 answer_question（基于 0088 当前版，仅答错分支追加自动入池）
drop function if exists public.answer_question(uuid, uuid, text);

create function public.answer_question(
  p_member_id uuid,
  p_question_id uuid,
  p_answer text
)
returns table(is_correct boolean, reward int, is_mastered boolean, bonus_reward int, new_star int)
language plpgsql security definer as $$
declare
  v_q public.questions%rowtype;
  v_family_id uuid;
  v_star int;
  v_reward int := 0;
  v_bonus int := 0;
  v_correct boolean;
  v_prog public.question_progress%rowtype;
  v_now_mastered boolean := false;
begin
  select * into v_q from public.questions where id = p_question_id;
  if not found then raise exception '题目不存在'; end if;

  select family_id into v_family_id from public.members where id = p_member_id;

  if v_q.type in ('choice','multi_choice','correct') then
    v_correct := (
      (select string_agg(c, '' order by c) from (
        select lower(ch) as c from unnest(string_to_array(lower(trim(p_answer)), NULL)) as t(ch) where ch ~ '[a-z]'
      ) s)
      =
      (select string_agg(c, '' order by c) from (
        select lower(ch) as c from unnest(string_to_array(lower(trim(v_q.correct_answer)), NULL)) as t(ch) where ch ~ '[a-z]'
      ) s)
    );
  else
    v_correct := lower(trim(p_answer)) = lower(trim(v_q.correct_answer));
  end if;

  select * into v_prog from public.question_progress
    where member_id = p_member_id and question_id = p_question_id;
  if not found then
    insert into public.question_progress (member_id, question_id, attempt_count, correct_count, is_mastered, last_attempt_at)
    values (p_member_id, p_question_id, 0, 0, false, now())
    returning * into v_prog;
  end if;

  if v_correct then
    v_reward := case v_q.difficulty
      when 'easy' then 1
      when 'hard' then 3
      else 2
    end;
    v_now_mastered := true;

    select star_value into v_star from public.members where id = p_member_id for update;
    v_star := v_star + v_reward;
    update public.members set star_value = v_star, updated_at = now() where id = p_member_id;

    update public.question_progress
    set attempt_count = attempt_count + 1,
        correct_count = correct_count + 1,
        is_mastered = true,
        last_attempt_at = now(),
        mastered_at = coalesce(mastered_at, now())
    where id = v_prog.id;
  else
    update public.question_progress
    set attempt_count = attempt_count + 1,
        last_attempt_at = now()
    where id = v_prog.id;

    -- 答错：自动进入错题混战池（智慧星战所有关卡/题集来源）
    -- 复用 (member_id, question_id) where status='active' 唯一索引去重；
    -- 若该题曾被家长手动移除（status='removed'），此处重新插入一条 active 记录
    if not exists (
      select 1 from public.wrong_battle_pool
      where member_id = p_member_id and question_id = p_question_id and status = 'active'
    ) then
      insert into public.wrong_battle_pool
        (family_id, member_id, question_id, source_challenge_set_id, source_level_id, status)
      values
        (v_family_id, p_member_id, p_question_id, v_q.challenge_set_id, v_q.level_id, 'active');
    end if;
  end if;

  insert into public.question_records (family_id, member_id, challenge_set_id, question_id, is_correct, reward_star)
  values (v_family_id, p_member_id, v_q.challenge_set_id, p_question_id, v_correct, v_reward);

  return query select v_correct, v_reward, v_now_mastered, v_bonus, v_star;
end;
$$;

grant execute on function public.answer_question(uuid, uuid, text) to anon, authenticated;
