-- ============================================================
-- 0060: 修复 pet_words.display_order 全为 0 的问题
-- 把所有 display_order=0（或重复值）的词按 created_at 升序
-- 重新分配 display_order（从 1 开始递增），保留非零且唯一的值
-- ============================================================

-- 1. 先把 display_order=0 的词按 created_at 升序重新分配
--    使用 CTE + row_number() 生成新顺序
with ranked as (
  select id,
         row_number() over (
           partition by (display_order = 0)
           order by created_at asc, id asc
         ) as rn,
         display_order as old_order
  from public.pet_words
)
update public.pet_words pw
set display_order = r.rn
from ranked r
where pw.id = r.id
  and r.old_order = 0;

-- 2. 对于 display_order>0 但可能重复的词，重新分配唯一值
--    （在所有 display_order=0 的词之后继续递增）
with all_ranked as (
  select id,
         row_number() over (order by
           case when display_order = 0 then 1 else 0 end,  -- 非零的排前面
           display_order asc,
           created_at asc
         ) as rn
  from public.pet_words
)
update public.pet_words pw
set display_order = r.rn
from all_ranked r
where pw.id = r.id;

-- 3. 验证：所有 display_order 应该是 1..N 唯一递增
-- （可选：查询确认）
-- select count(*) as total,
--        count(distinct display_order) as distinct_count,
--        min(display_order) as min_order,
--        max(display_order) as max_order
-- from public.pet_words;
