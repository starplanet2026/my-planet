-- 0104_pet_word_books.sql
-- 萌宠星球词书管理系统

-- 1. 词书表
CREATE TABLE IF NOT EXISTS pet_word_books (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  display_order INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. pet_words 增加 book_id
ALTER TABLE pet_words ADD COLUMN IF NOT EXISTS book_id UUID;
ALTER TABLE pet_words DROP CONSTRAINT IF EXISTS pet_words_book_fk;
ALTER TABLE pet_words ADD CONSTRAINT pet_words_book_fk
  FOREIGN KEY (book_id) REFERENCES pet_word_books(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_pet_words_book_id ON pet_words(book_id);

-- 3. 创建默认词书"五年级上册书后词表"
INSERT INTO pet_word_books (title, display_order)
VALUES ('五年级上册书后词表', 1)
ON CONFLICT DO NOTHING;

-- 4. 将所有存量无归属单词迁移到默认词书
UPDATE pet_words
SET book_id = (SELECT id FROM pet_word_books ORDER BY created_at LIMIT 1)
WHERE book_id IS NULL;

-- 5. 迁移后设置 NOT NULL 约束
ALTER TABLE pet_words ALTER COLUMN book_id SET NOT NULL;

-- 6. pet_word_progress 增加 current_book_id（跟踪用户当前游玩的词书）
ALTER TABLE pet_word_progress ADD COLUMN IF NOT EXISTS current_book_id UUID;
