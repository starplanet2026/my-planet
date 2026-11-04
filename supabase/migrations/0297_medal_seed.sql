-- 0297: 预置 16 枚正式勋章模板，并复制到所有现有家庭的个人勋章库
-- 说明：清单中「好表现」按产品确认统一为「好努力」；拓展勋章 17-19 不上线。
-- 奖励字段 V1.0 仅记录文案（特权卡名称/数量、星光值），实际发卡逻辑后续细化。

insert into public.medal_templates
  (code, name, series, threshold, subcategory, tier, condition_text, description,
   reward_stars, reward_card_name, reward_card_count, is_active, priority)
values
  ('01', '七日坚持之星', 'streak', 7, null, '一周（7天）',
   '任意一条单项成就连续每日达成7天', '连续7天完成同一项任务，初步养成好习惯，你已经坚持得很棒！',
   0, '【五百星光值】特权卡', 1, true, 1),
  ('02', '双周自律先锋', 'streak', 14, null, '两周（14天）',
   '任意一条单项成就连续每日达成14天', '坚持半个月不间断，自律能力稳步提升，这份坚持超难得！',
   0, '【五百星光值】特权卡', 2, true, 2),
  ('03', '三周习惯大师', 'streak', 21, null, '三周（21天）',
   '任意一条单项成就连续每日达成21天', '坚持21天，把一件事变成长期习惯，你就是习惯养成小大师！',
   0, '【五百星光值】特权卡', 3, true, 3),

  ('04', '习惯收集小将', 'collect', 20, '好习惯', '20枚',
   '好习惯分类下累计解锁成就20项', '好习惯攒了满满20个，生活习惯越来越棒，继续加油！',
   0, '【免扣积分券】特权卡', 1, true, 4),
  ('05', '习惯收集达人', 'collect', 50, '好习惯', '50枚',
   '好习惯分类下累计解锁成就50项', '50个好习惯在手，你已经是养成好习惯的小达人啦！',
   0, '【积分膨胀券】特权卡', 1, true, 5),
  ('06', '习惯收集宗师', 'collect', 100, '好习惯', '100枚',
   '好习惯分类下累计解锁成就100项', '100个好习惯全部集齐，堪称习惯宗师，为你骄傲！',
   0, '随机两张稀有特权卡', 2, true, 6),

  ('07', '健康守护小将', 'collect', 20, '好健康', '20枚',
   '好健康分类下累计解锁成就20项', '好好吃饭、好好运动，健康习惯攒了20个，身体棒棒！',
   0, '【免扣积分券】特权卡', 1, true, 7),
  ('08', '健康守护达人', 'collect', 50, '好健康', '50枚',
   '好健康分类下累计解锁成就50项', '50项健康成就达成，你就是守护自己身体的小达人！',
   0, '【积分膨胀券】特权卡', 1, true, 8),
  ('09', '健康守护宗师', 'collect', 100, '好健康', '100枚',
   '好健康分类下累计解锁成就100项', '100项健康成就集齐，健康生活小宗师就是你！',
   0, '随机两张稀有特权卡', 2, true, 9),

  ('10', '努力之星小将', 'collect', 20, '好努力', '20枚',
   '好努力分类下累计解锁成就20项', '待人处事大方得体，优秀表现攒了20个，光芒闪闪！',
   0, '【免扣积分券】特权卡', 1, true, 10),
  ('11', '努力之星达人', 'collect', 50, '好努力', '50枚',
   '好努力分类下累计解锁成就50项', '50个优秀表现在手，你就是人见人爱的努力之星！',
   0, '【积分膨胀券】特权卡', 1, true, 11),
  ('12', '努力之星宗师', 'collect', 100, '好努力', '100枚',
   '好努力分类下累计解锁成就100项', '100项优秀表现集齐，品格与表现双双满分！',
   0, '随机两张稀有特权卡', 2, true, 12),

  ('13', '学业进阶小将', 'collect', 20, '好成绩', '20枚',
   '好成绩分类下累计解锁成就20项', '学习上收获满满20项成就，步步进阶，前途可期！',
   0, '【免扣积分券】特权卡', 1, true, 13),
  ('14', '学业进阶达人', 'collect', 50, '好成绩', '50枚',
   '好成绩分类下累计解锁成就50项', '50项学习成就达成，学业路上的进阶小达人！',
   0, '【积分膨胀券】特权卡', 1, true, 14),
  ('15', '学业进阶宗师', 'collect', 100, '好成绩', '100枚',
   '好成绩分类下累计解锁成就100项', '100项学业成就集齐，学习宗师实至名归！',
   0, '随机两张稀有特权卡', 2, true, 15),

  ('16', '当日全能小达人', 'daily', 10, null, '单日≥10条',
   '单日领取并达成成就≥10条', '当天全力以赴，高效率完成超多任务，你真是太优秀啦！',
   0, '【幸运大转盘】特权卡', 1, true, 16)
on conflict (code) where code is not null do nothing;

-- 复制到每个已存在家庭的个人勋章库（后续模板更新不会同步已复制副本）
insert into public.medals
  (family_id, template_id, code, name, series, threshold, subcategory, tier,
   condition_text, description, icon, reward_stars, reward_card_name,
   reward_card_count, is_active, priority)
select f.id, t.id, t.code, t.name, t.series, t.threshold, t.subcategory, t.tier,
       t.condition_text, t.description, t.icon, t.reward_stars, t.reward_card_name,
       t.reward_card_count, true, t.priority
from public.medal_templates t
cross join public.families f
on conflict (family_id, code) where code is not null do nothing;

-- 回溯补发：对已有完成记录的孩子按规则重算一次
do $$
declare r record;
begin
  for r in
    select distinct m.id
    from public.members m
    join public.families f on f.id = m.family_id
    where m.role = 'child'
  loop
    perform public.sync_member_medals(r.id);
  end loop;
end $$;
