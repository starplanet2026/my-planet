-- 0186: 回溯第一本词书的单词顺序与复习状态
-- 目的：让第一本词书用最新逻辑重新排列单词，用户不再反复刷之前错过的词
-- 操作：
--   1. 找到 display_order 最小的词书（第一本）
--   2. 重置该书 pet_words：display_order 按 created_at 重新编号 1..N，needs_review=false，original_display_order=null
--   3. 重置该书所有成员的 game_word_stats：review_wrong_count=0，challenge_count=0
--      （保留 wrong_count 历史错误次数，供后台展示）
-- 注意：不修改 game_level_results（已获星光值保留）、不修改 pet_word_progress.unlocked_level

-- ① 重置第一本词书的 pet_words
with first_book as (
  select id from public.pet_word_books
  order by display_order asc
  limit 1
),
reordered as (
  select
    pw.id,
    row_number() over (order by pw.created_at asc, pw.id asc) as new_order
  from public.pet_words pw
  join first_book fb on pw.book_id = fb.id
)
update public.pet_words pw
set display_order = r.new_order,
    needs_review = false,
    original_display_order = null
from reordered r
where pw.id = r.id;

-- ② 重置第一本词书所有成员的统计：review_wrong_count=0, challenge_count=0（保留 wrong_count）
with first_book as (
  select id from public.pet_word_books
  order by display_order asc
  limit 1
)
update public.game_word_stats gs
set review_wrong_count = 0,
    challenge_count = 0
from public.pet_words pw
join first_book fb on pw.book_id = fb.id
where gs.word_id = pw.id;
