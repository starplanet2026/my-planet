-- 0105_pet_word_part_of_speech_2.sql
-- 萌宠星球：单词新增「词性2」字段
-- 规则：单词仅有1个词性 → part_of_speech 填写，part_of_speech_2 留空；
--       单词存在2个词性 → 两列均填写；
--       无词性（词组/句子）→ 两列均留空。
-- pet_words 表已有全局读 + 认证用户写 RLS（见 0071_global_system_data.sql），新增列无需额外策略。

ALTER TABLE public.pet_words
  ADD COLUMN IF NOT EXISTS part_of_speech_2 TEXT;
