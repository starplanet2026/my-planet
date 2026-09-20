-- ============================================================
-- 0026: 单词消消乐错题记录表 + 关卡进度
-- ============================================================

-- 错题记录表：记录用户配对错误的单词
create table if not exists public.pet_wrong_words (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  word_en text not null,
  word_cn text not null,
  wrong_count int default 1,
  last_wrong_at timestamptz default now(),
  created_at timestamptz default now(),
  unique (member_id, word_en)
);

create index if not exists idx_pet_wrong_words_member on public.pet_wrong_words(member_id);

alter table public.pet_wrong_words enable row level security;
drop policy if exists "pet_wrong_words_all" on public.pet_wrong_words;
create policy "pet_wrong_words_all" on public.pet_wrong_words for all using (true) with check (true);

-- 更新 pet_word_progress 表：增加 unlocked_level 字段（默认1）
alter table public.pet_word_progress add column if not exists unlocked_level int default 1;

-- 记录错题 RPC：upsert 错题记录
create or replace function public.record_wrong_word(
  p_member_id uuid,
  p_family_id uuid,
  p_word_en text,
  p_word_cn text
)
returns void
language plpgsql
security definer
as $$
begin
  insert into public.pet_wrong_words (member_id, family_id, word_en, word_cn, wrong_count, last_wrong_at)
  values (p_member_id, p_family_id, p_word_en, p_word_cn, 1, now())
  on conflict (member_id, word_en)
  do update set
    wrong_count = pet_wrong_words.wrong_count + 1,
    last_wrong_at = now();
end;
$$;

-- 解锁下一关 RPC
create or replace function public.unlock_word_level(
  p_member_id uuid,
  p_level int
)
returns void
language plpgsql
security definer
as $$
begin
  update public.pet_word_progress
  set unlocked_level = greatest(unlocked_level, p_level + 1)
  where member_id = p_member_id;
end;
$$;
