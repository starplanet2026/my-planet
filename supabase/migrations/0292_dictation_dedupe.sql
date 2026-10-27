-- 0292: 家默词条库/错词库去重
-- 现状：
--   · 错词库已有唯一索引 (member_id, subject, lower(btrim(answer)))，无重复数据；
--   · 词条库没有唯一约束，存在 46 组重复（共 54 条冗余），因前端仅按
--     family+subject+textbook+unit+answer 精确匹配，大小写/空格/教材单元差异都会漏判。
-- 本次：
--   1. 词条库按 (family_id, subject, lower(btrim(answer))) 去重，每组保留 1 条
--      （优先保留中文/拼音更完整的一条，其次最早创建）；
--   2. 词条库加唯一索引，后续重复写入被数据库拦截；
--   3. 错词库新增 BEFORE INSERT 合并触发器：万一出现同词重复插入，
--      保留记忆节点最靠前（current_node 最大，即第 X 天 X 最大）的一条。

-- 1. 词条库去重
with ranked as (
  select id,
         row_number() over (
           partition by family_id, subject, lower(btrim(answer))
           order by (nullif(btrim(chinese_meaning), '') is not null) desc,
                    (nullif(btrim(pinyin), '') is not null) desc,
                    created_at asc,
                    id
         ) as rn
  from public.dictation_words
)
delete from public.dictation_words w
using ranked r
where w.id = r.id and r.rn > 1;

-- 2. 词条库唯一索引
create unique index if not exists dictation_words_family_subject_norm_answer_key
  on public.dictation_words (family_id, subject, lower(btrim(answer)));

-- 3. 错词库重复插入合并（保留节点最靠前的记录）
create or replace function public.merge_dup_error_word()
returns trigger
language plpgsql security definer as $$
declare
  v_ex public.dictation_error_words%rowtype;
begin
  select * into v_ex
  from public.dictation_error_words
  where member_id = new.member_id
    and subject = new.subject
    and lower(btrim(answer)) = lower(btrim(new.answer))
  limit 1;

  if v_ex.id is null then
    return new;
  end if;

  -- 已存在同词：保留节点最大（第 X 天最大）的进度，补齐缺失的中文/拼音
  update public.dictation_error_words set
    current_node = greatest(coalesce(v_ex.current_node, 0), coalesce(new.current_node, 0)),
    status = case when coalesce(new.current_node, 0) > coalesce(v_ex.current_node, 0)
                  then new.status else v_ex.status end,
    next_review_date = case when coalesce(new.current_node, 0) > coalesce(v_ex.current_node, 0)
                            then new.next_review_date else v_ex.next_review_date end,
    last_review_date = greatest(v_ex.last_review_date, new.last_review_date),
    review_count = greatest(coalesce(v_ex.review_count, 0), coalesce(new.review_count, 0)),
    error_count = greatest(coalesce(v_ex.error_count, 0), coalesce(new.error_count, 0)),
    chinese_meaning = coalesce(nullif(btrim(v_ex.chinese_meaning), ''), nullif(btrim(new.chinese_meaning), '')),
    pinyin = coalesce(nullif(btrim(v_ex.pinyin), ''), nullif(btrim(new.pinyin), '')),
    part_of_speech = coalesce(nullif(btrim(v_ex.part_of_speech), ''), nullif(btrim(new.part_of_speech), ''))
  where id = v_ex.id;

  return null;
end;
$$;

drop trigger if exists trg_merge_dup_error_word on public.dictation_error_words;
create trigger trg_merge_dup_error_word
  before insert on public.dictation_error_words
  for each row execute function public.merge_dup_error_word();

-- 验证
select
  (select count(*) from (
     select 1 from public.dictation_words
     group by family_id, subject, lower(btrim(answer)) having count(*) > 1) x) as word_dup_groups,
  (select count(*) from (
     select 1 from public.dictation_error_words
     group by member_id, subject, lower(btrim(answer)) having count(*) > 1) y) as error_dup_groups;
