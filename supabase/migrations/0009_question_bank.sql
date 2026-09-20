-- ============================================================
-- 0009: 智慧星战（题库模块）
-- challenge_sets: 挑战赛/题集
-- questions: 题目（选择题、数学计算）
-- words: 单词（词表背诵）
-- question_records: 答题记录
-- wrong_questions: 错题本
-- ============================================================

-- 1. challenge_sets：挑战赛/题集
create table if not exists public.challenge_sets (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  title text not null,
  description text,
  type text not null check (type in ('word_vocab','math','choice')),
  reward_star int not null default 5,
  status text not null default 'draft' check (status in ('draft','active')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. questions：题目（选择题、数学计算）
create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  challenge_set_id uuid not null references public.challenge_sets(id) on delete cascade,
  type text not null check (type in ('choice','math')),
  question_text text not null,
  options jsonb,        -- 选择题选项 ['A.xxx','B.xxx',...]
  correct_answer text not null,  -- 选择题存选项字母，数学题存数字
  explanation text,
  difficulty text not null default 'medium' check (difficulty in ('easy','medium','hard')),
  created_at timestamptz not null default now()
);

-- 3. words：单词（词表背诵）
create table if not exists public.words (
  id uuid primary key default gen_random_uuid(),
  challenge_set_id uuid not null references public.challenge_sets(id) on delete cascade,
  word_en text not null,
  word_cn text not null,
  phonetic text,
  example_sentence text,
  created_at timestamptz not null default now()
);

-- 4. word_progress：单词掌握进度（每个孩子每个单词的进度）
create table if not exists public.word_progress (
  id uuid primary key default gen_random_uuid(),
  word_id uuid not null references public.words(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  -- 4种题型是否通过：en2cn, cn2en, listen2cn, cn2spell
  pass_en2cn boolean not null default false,
  pass_cn2en boolean not null default false,
  pass_listen boolean not null default false,
  pass_spell boolean not null default false,
  is_familiar boolean not null default false,  -- 标记熟悉，只需考拼写
  is_mastered boolean not null default false,  -- 是否已掌握
  review_stage int not null default 0,  -- 艾宾浩斯阶段 0-4
  next_review_at timestamptz,  -- 下次复习时间
  wrong_count int not null default 0,
  last_reviewed_at timestamptz,
  unique (word_id, member_id)
);

-- 5. question_records：答题记录
create table if not exists public.question_records (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  challenge_set_id uuid references public.challenge_sets(id) on delete set null,
  question_id uuid references public.questions(id) on delete set null,
  word_id uuid references public.words(id) on delete set null,
  is_correct boolean not null,
  reward_star int not null default 0,
  answered_at timestamptz not null default now()
);

-- 6. wrong_questions：错题本
create table if not exists public.wrong_questions (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  question_id uuid references public.questions(id) on delete set null,
  word_id uuid references public.words(id) on delete set null,
  challenge_set_id uuid references public.challenge_sets(id) on delete set null,
  wrong_count int not null default 1,
  correct_count int not null default 0,  -- 复习答对次数
  status text not null default 'active' check (status in ('active','mastered')),
  last_wrong_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- 索引
create index if not exists idx_challenge_sets_family on public.challenge_sets(family_id);
create index if not exists idx_questions_set on public.questions(challenge_set_id);
create index if not exists idx_words_set on public.words(challenge_set_id);
create index if not exists idx_word_progress_member on public.word_progress(member_id);
create index if not exists idx_question_records_member on public.question_records(member_id);
create index if not exists idx_wrong_questions_member on public.wrong_questions(member_id);

-- wrong_questions 部分唯一索引（活跃错题，同一题不重复）
create unique index if not exists uniq_wrong_q_member_question
  on public.wrong_questions (member_id, question_id)
  where question_id is not null and status = 'active';
create unique index if not exists uniq_wrong_q_member_word
  on public.wrong_questions (member_id, word_id)
  where word_id is not null and status = 'active';

-- ============================================================
-- RPC 函数
-- ============================================================

-- answer_question: 答题（选择题/数学题）
-- 判分 + 加星光值 + 记录错题
create or replace function public.answer_question(
  p_member_id uuid,
  p_question_id uuid,
  p_answer text
)
returns table(is_correct boolean, reward int, new_star int)
language plpgsql security definer as $$
declare
  v_q public.questions%rowtype;
  v_set public.challenge_sets%rowtype;
  v_family_id uuid;
  v_star int;
  v_reward int := 0;
  v_correct boolean;
begin
  select * into v_q from public.questions where id = p_question_id;
  if not found then raise exception '题目不存在'; end if;

  select * into v_set from public.challenge_sets where id = v_q.challenge_set_id;
  v_family_id := v_set.family_id;

  -- 判分（去除空格后比较）
  v_correct := lower(trim(p_answer)) = lower(trim(v_q.correct_answer));

  if v_correct then
    v_reward := v_set.reward_star;
    -- 加星光值
    select star_value into v_star from public.members where id = p_member_id for update;
    v_star := v_star + v_reward;
    update public.members set star_value = v_star, updated_at = now() where id = p_member_id;

    -- 检查错题本：如果在错题本中，答对则 correct_count+1，达到2次则移除
    update public.wrong_questions
    set correct_count = correct_count + 1,
        status = case when correct_count + 1 >= 2 then 'mastered' else status end
    where member_id = p_member_id and question_id = p_question_id and status = 'active';
  else
    -- 答错：加入或更新错题本
    insert into public.wrong_questions (family_id, member_id, question_id, challenge_set_id, wrong_count, last_wrong_at)
    values (v_family_id, p_member_id, p_question_id, v_q.challenge_set_id, 1, now())
    on conflict (member_id, question_id)
    do update set wrong_count = wrong_questions.wrong_count + 1, last_wrong_at = now(), status = 'active';
  end if;

  -- 记录答题
  insert into public.question_records (family_id, member_id, challenge_set_id, question_id, is_correct, reward_star)
  values (v_family_id, p_member_id, v_q.challenge_set_id, p_question_id, v_correct, v_reward);

  return query select v_correct, v_reward, v_star;
end;
$$;

-- answer_word: 背单词（4种题型之一）
-- p_question_type: en2cn / cn2en / listen / spell
create or replace function public.answer_word(
  p_member_id uuid,
  p_word_id uuid,
  p_question_type text,
  p_answer text,
  p_is_familiar boolean default false
)
returns table(is_correct boolean, reward int, is_mastered boolean, new_star int)
language plpgsql security definer as $$
declare
  v_word public.words%rowtype;
  v_set public.challenge_sets%rowtype;
  v_family_id uuid;
  v_star int;
  v_reward int := 0;
  v_correct boolean;
  v_prog public.word_progress%rowtype;
  v_mastered boolean := false;
  v_review_stage int;
  v_next_review timestamptz;
begin
  select * into v_word from public.words where id = p_word_id;
  if not found then raise exception '单词不存在'; end if;

  select * into v_set from public.challenge_sets where id = v_word.challenge_set_id;
  v_family_id := v_set.family_id;

  -- 判分
  if p_question_type = 'en2cn' then
    v_correct := lower(trim(p_answer)) = lower(trim(v_word.word_cn));
  elsif p_question_type = 'cn2en' then
    v_correct := lower(trim(p_answer)) = lower(trim(v_word.word_en));
  elsif p_question_type = 'listen' then
    v_correct := lower(trim(p_answer)) = lower(trim(v_word.word_cn));
  elsif p_question_type = 'spell' then
    v_correct := lower(trim(p_answer)) = lower(trim(v_word.word_en));
  else
    raise exception '题型错误';
  end if;

  -- 查找或创建进度
  select * into v_prog from public.word_progress where word_id = p_word_id and member_id = p_member_id;
  if not found then
    insert into public.word_progress (word_id, member_id)
    values (p_word_id, p_member_id)
    returning * into v_prog;
  end if;

  if v_correct then
    v_reward := v_set.reward_star;
    -- 加星光值
    select star_value into v_star from public.members where id = p_member_id for update;
    v_star := v_star + v_reward;
    update public.members set star_value = v_star, updated_at = now() where id = p_member_id;

    -- 更新进度
    if p_question_type = 'en2cn' then
      update public.word_progress set pass_en2cn = true where id = v_prog.id;
    elsif p_question_type = 'cn2en' then
      update public.word_progress set pass_cn2en = true where id = v_prog.id;
    elsif p_question_type = 'listen' then
      update public.word_progress set pass_listen = true where id = v_prog.id;
    elsif p_question_type = 'spell' then
      update public.word_progress set pass_spell = true where id = v_prog.id;
    end if;

    -- 熟悉模式：只考拼写，对就算掌握
    if p_is_familiar then
      update public.word_progress
      set is_mastered = true, is_familiar = true,
          pass_en2cn = true, pass_cn2en = true, pass_listen = true, pass_spell = true
      where id = v_prog.id;
      v_mastered := true;
    else
      -- 检查4项是否全通过
      select * into v_prog from public.word_progress where id = v_prog.id;
      if v_prog.pass_en2cn and v_prog.pass_cn2en and v_prog.pass_listen and v_prog.pass_spell then
        update public.word_progress set is_mastered = true where id = v_prog.id;
        v_mastered := true;
      end if;
    end if;

    -- 如果之前在错题本中，更新
    update public.wrong_questions
    set correct_count = correct_count + 1,
        status = case when correct_count + 1 >= 2 then 'mastered' else status end
    where member_id = p_member_id and word_id = p_word_id and status = 'active';

  else
    -- 答错：更新 wrong_count，当天不重考
    update public.word_progress
    set wrong_count = wrong_count + 1,
        next_review_at = now() + interval '1 day'  -- 艾宾浩斯第1阶段：1天后
    where id = v_prog.id;

    -- 加入错题本
    insert into public.wrong_questions (family_id, member_id, word_id, challenge_set_id, wrong_count, last_wrong_at)
    values (v_family_id, p_member_id, p_word_id, v_word.challenge_set_id, 1, now())
    on conflict (member_id, word_id)
    do update set wrong_count = wrong_questions.wrong_count + 1, last_wrong_at = now(), status = 'active';
  end if;

  -- 记录答题
  insert into public.question_records (family_id, member_id, challenge_set_id, word_id, is_correct, reward_star)
  values (v_family_id, p_member_id, v_word.challenge_set_id, p_word_id, v_correct, v_reward);

  return query select v_correct, v_reward, v_mastered, v_star;
end;
$$;

-- review_wrong_question: 复习错题（答对2次移除）
create or replace function public.review_wrong_question(
  p_wrong_id uuid,
  p_member_id uuid,
  p_is_correct boolean
)
returns table(removed boolean, new_star int)
language plpgsql security definer as $$
declare
  v_wrong public.wrong_questions%rowtype;
  v_family_id uuid;
  v_star int;
  v_removed boolean := false;
begin
  select * into v_wrong from public.wrong_questions where id = p_wrong_id;
  if not found then raise exception '错题不存在'; end if;
  if v_wrong.member_id <> p_member_id then raise exception '无权操作'; end if;

  v_family_id := v_wrong.family_id;

  if p_is_correct then
    update public.wrong_questions
    set correct_count = correct_count + 1,
        status = case when correct_count + 1 >= 2 then 'mastered' else status end
    where id = p_wrong_id;

    if (v_wrong.correct_count + 1) >= 2 then
      v_removed := true;
    end if;
  else
    update public.wrong_questions
    set wrong_count = wrong_count + 1, last_wrong_at = now()
    where id = p_wrong_id;
  end if;

  -- 返回当前星光值
  select star_value into v_star from public.members where id = p_member_id;

  return query select v_removed, v_star;
end;
$$;

-- 授权
grant execute on function public.answer_question(uuid, uuid, text) to anon, authenticated;
grant execute on function public.answer_word(uuid, uuid, text, text, boolean) to anon, authenticated;
grant execute on function public.review_wrong_question(uuid, uuid, boolean) to anon, authenticated;

-- RLS
alter table public.challenge_sets enable row level security;
alter table public.questions enable row level security;
alter table public.words enable row level security;
alter table public.word_progress enable row level security;
alter table public.question_records enable row level security;
alter table public.wrong_questions enable row level security;

-- challenge_sets RLS
create policy "challenge_sets_select" on public.challenge_sets for select using (true);
create policy "challenge_sets_insert" on public.challenge_sets for insert with check (true);
create policy "challenge_sets_update" on public.challenge_sets for update using (true);
create policy "challenge_sets_delete" on public.challenge_sets for delete using (true);

-- questions RLS
create policy "questions_select" on public.questions for select using (true);
create policy "questions_insert" on public.questions for insert with check (true);
create policy "questions_update" on public.questions for update using (true);
create policy "questions_delete" on public.questions for delete using (true);

-- words RLS
create policy "words_select" on public.words for select using (true);
create policy "words_insert" on public.words for insert with check (true);
create policy "words_update" on public.words for update using (true);
create policy "words_delete" on public.words for delete using (true);

-- word_progress RLS
create policy "word_progress_select" on public.word_progress for select using (true);
create policy "word_progress_insert" on public.word_progress for insert with check (true);
create policy "word_progress_update" on public.word_progress for update using (true);
create policy "word_progress_delete" on public.word_progress for delete using (true);

-- question_records RLS
create policy "records_select" on public.question_records for select using (true);
create policy "records_insert" on public.question_records for insert with check (true);

-- wrong_questions RLS
create policy "wrong_select" on public.wrong_questions for select using (true);
create policy "wrong_insert" on public.wrong_questions for insert with check (true);
create policy "wrong_update" on public.wrong_questions for update using (true);
