-- 0071: 系统默认数据全局化
-- 将商品、物品、任务模板、宠物词库、背景图库、挑战集改为全局数据
-- 删除 family_id 字段，这些数据不再随用户删除而删除
-- 只有用户数据（金币、星光、背包、宠物、答题记录等）保留 family_id/member_id

-- ====== pet_shop_items ======
ALTER TABLE public.pet_shop_items DROP CONSTRAINT IF EXISTS pet_shop_items_family_id_fkey;
ALTER TABLE public.pet_shop_items DROP COLUMN IF EXISTS family_id CASCADE;

-- ====== items ======
ALTER TABLE public.items DROP CONSTRAINT IF EXISTS items_family_id_fkey;
ALTER TABLE public.items DROP COLUMN IF EXISTS family_id CASCADE;

-- ====== task_templates ======
ALTER TABLE public.task_templates DROP CONSTRAINT IF EXISTS task_templates_family_id_fkey;
ALTER TABLE public.task_templates DROP COLUMN IF EXISTS family_id CASCADE;

-- ====== pet_words ======
ALTER TABLE public.pet_words DROP CONSTRAINT IF EXISTS pet_words_family_id_fkey;
ALTER TABLE public.pet_words DROP COLUMN IF EXISTS family_id CASCADE;

-- ====== pet_backgrounds ======
ALTER TABLE public.pet_backgrounds DROP CONSTRAINT IF EXISTS pet_backgrounds_family_id_fkey;
ALTER TABLE public.pet_backgrounds DROP COLUMN IF EXISTS family_id CASCADE;

-- ====== challenge_sets ======
ALTER TABLE public.challenge_sets DROP CONSTRAINT IF EXISTS challenge_sets_family_id_fkey;
ALTER TABLE public.challenge_sets DROP COLUMN IF EXISTS family_id CASCADE;

-- ====== 更新 RLS 策略 ======
-- 全局数据表：所有认证用户可读，后台管理可写

-- pet_shop_items
DROP POLICY IF EXISTS pet_shop_select ON public.pet_shop_items;
DROP POLICY IF EXISTS pet_shop_insert ON public.pet_shop_items;
DROP POLICY IF EXISTS pet_shop_update ON public.pet_shop_items;
DROP POLICY IF EXISTS pet_shop_delete ON public.pet_shop_items;
CREATE POLICY "global read pet_shop_items" ON public.pet_shop_items FOR SELECT USING (true);
CREATE POLICY "global write pet_shop_items" ON public.pet_shop_items FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- items
DROP POLICY IF EXISTS "owner can read items" ON public.items;
DROP POLICY IF EXISTS "owner can write items" ON public.items;
CREATE POLICY "global read items" ON public.items FOR SELECT USING (true);
CREATE POLICY "global write items" ON public.items FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- task_templates
DROP POLICY IF EXISTS "owner can read templates" ON public.task_templates;
DROP POLICY IF EXISTS "owner can write templates" ON public.task_templates;
CREATE POLICY "global read task_templates" ON public.task_templates FOR SELECT USING (true);
CREATE POLICY "global write task_templates" ON public.task_templates FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- pet_words
DROP POLICY IF EXISTS pet_words_select ON public.pet_words;
DROP POLICY IF EXISTS pet_words_insert ON public.pet_words;
DROP POLICY IF EXISTS pet_words_update ON public.pet_words;
DROP POLICY IF EXISTS pet_words_delete ON public.pet_words;
CREATE POLICY "global read pet_words" ON public.pet_words FOR SELECT USING (true);
CREATE POLICY "global write pet_words" ON public.pet_words FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- pet_backgrounds
DROP POLICY IF EXISTS pet_backgrounds_all ON public.pet_backgrounds;
CREATE POLICY "global read pet_backgrounds" ON public.pet_backgrounds FOR SELECT USING (true);
CREATE POLICY "global write pet_backgrounds" ON public.pet_backgrounds FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- challenge_sets
DROP POLICY IF EXISTS challenge_sets_select ON public.challenge_sets;
DROP POLICY IF EXISTS challenge_sets_insert ON public.challenge_sets;
DROP POLICY IF EXISTS challenge_sets_update ON public.challenge_sets;
DROP POLICY IF EXISTS challenge_sets_delete ON public.challenge_sets;
CREATE POLICY "global read challenge_sets" ON public.challenge_sets FOR SELECT USING (true);
CREATE POLICY "global write challenge_sets" ON public.challenge_sets FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
