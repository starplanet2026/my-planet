-- 0207: 更新40只狗的商店数据（品种名/性别/稀有度/价格/产金/特质）
-- 同步 pet_shop_items 和已领养 pets 表

-- ============================================================
-- 一、更新已存在的 pet_shop_items
-- ============================================================

with data(breed, name, description, rarity, gender, price_star, base_coin_per_day, trait, trait_id, max_level) as (
  select '金毛', '金毛', '犬界中央空调，对谁都温柔笑，捡球专业户，口水和温柔一样多。', 'common', 'male', 140, 1, '乐天派', '20eecf26-1916-400d-8976-aceb04073719'::uuid, 10
union all
  select '柯基', '柯基', '系着红色三角巾的小短腿柯基，圆滚滚的小屁股走起路来一扭一扭，吐舌傻笑治愈值满分。', 'common', 'female', 135, 1, '有活力', 'a8791b47-22e2-4a8d-b4c5-eeee21203092'::uuid, 10
union all
  select '拉布拉多', '拉布拉多', '天生社交达人，见人就摇尾招手，零食一掏立刻变你的头号粉丝。', 'common', 'male', 132, 1, '小财迷', 'c72c2097-c40f-4c2b-8816-61d87e372777'::uuid, 10
union all
  select '萨摩耶', '萨摩耶', '微笑天使本使，乐天派回望你，黄巾一戴谁都不爱，除了玩雪。', 'common', 'male', 130, 1, '乐天派', '20eecf26-1916-400d-8976-aceb04073719'::uuid, 10
union all
  select '哈士奇', '哈士奇', '二哈界高冷担当，侧脸杀绝美，你一拿零食，高冷人设秒崩。', 'common', 'male', 128, 1, '好体魄', '399ef5cb-1373-4080-843a-140c8cd91978'::uuid, 10
union all
  select '德国牧羊犬', '德国牧羊犬', '全能学霸，机警认真执行力强，当得了警犬也当得了你的贴身保镖。', 'common', 'male', 126, 1, '爱学习', '777fdbd6-93ca-460e-b74b-ccd4844cb896'::uuid, 10
union all
  select '法斗', '法斗', '打呼噜冠军，鼓腮呆萌，走路摇摇晃晃，丑萌界天花板。', 'common', 'male', 124, 1, '小财迷', 'c72c2097-c40f-4c2b-8816-61d87e372777'::uuid, 10
union all
  select '比熊', '比熊', '卷毛小团子，歪头杀专业户，你说啥它都装作听懂了，其实只惦记零食。', 'common', 'female', 122, 1, '爱干净', '569992f3-1fb8-4731-86ac-689046462c4b'::uuid, 10
union all
  select '约克夏', '约克夏', '丝毛小绅士，走路抬头挺胸，嘴上不理你，其实偷偷等你夸它好看。', 'common', 'female', 121, 1, '爱干净', '569992f3-1fb8-4731-86ac-689046462c4b'::uuid, 10
union all
  select '斑点狗', '斑点狗', '移动小马达，永远电量满格，遛弯两小时回家还能再拆一个枕头。', 'common', 'male', 120, 1, '有活力', 'a8791b47-22e2-4a8d-b4c5-eeee21203092'::uuid, 10
union all
  select '喜乐蒂', '喜乐蒂', '小型牧羊犬，兴奋到歪头吐舌，聪明又黏人，小短腿倒腾飞快。', 'common', 'female', 120, 1, '爱学习', '777fdbd6-93ca-460e-b74b-ccd4844cb896'::uuid, 10
union all
  select '金毛2', '金毛2', '暖男金毛幸福版，眯眼享受被撸，幸福感爆棚的治愈系大狗狗。', 'common', 'female', 120, 1, '好体魄', '399ef5cb-1373-4080-843a-140c8cd91978'::uuid, 10
union all
  select '马尔济斯', '马尔济斯', '白色小天使，温柔乖巧不吵不闹，抱在怀里像团暖暖的云。', 'common', 'female', 80, 1, '无特质', '6aef7875-c2ac-4e89-8924-100694901098'::uuid, 10
union all
  select '博美', '博美', '毛茸茸小太阳，笑起来眼睛弯弯，走到哪都带着快乐的氛围组组长。', 'common', 'female', 78, 1, '无特质', '6aef7875-c2ac-4e89-8924-100694901098'::uuid, 10
union all
  select '西施犬', '西施犬', '小公主脾气，被忽略就鼓腮生气，给块肉干立刻多云转晴。', 'common', 'female', 76, 1, '无特质', '6aef7875-c2ac-4e89-8924-100694901098'::uuid, 10
union all
  select '雪纳瑞', '雪纳瑞', '小老头外表佛系心，天塌下来先吃口饭，淡定得像看透了狗生。', 'common', 'male', 75, 1, '无特质', '6aef7875-c2ac-4e89-8924-100694901098'::uuid, 10
union all
  select '查理王', '查理王', '长耳朵憨憨，整天挂着傻笑，没心没肺快乐小狗本狗。', 'common', 'male', 74, 1, '无特质', '6aef7875-c2ac-4e89-8924-100694901098'::uuid, 10
union all
  select '比格犬', '比格犬', '同款大耳朵，这次满脸问号，你在说啥？本狗听不懂但大受震撼。', 'common', 'female', 73, 1, '无特质', '6aef7875-c2ac-4e89-8924-100694901098'::uuid, 10
union all
  select '史宾格', '史宾格', '运动小能手，听到出门就睁大眼惊喜，捡球巡回技能点满。', 'common', 'male', 72, 1, '无特质', '6aef7875-c2ac-4e89-8924-100694901098'::uuid, 10
union all
  select '银狐犬', '银狐犬', '微笑小狐狸，吃到好吃的就眯眼满足，像团会走路的棉花糖。', 'common', 'female', 70, 1, '无特质', '6aef7875-c2ac-4e89-8924-100694901098'::uuid, 10
union all
  select '巴吉度', '巴吉度', '大耳朵耷拉着，泪眼汪汪委屈巴巴，其实只是在想下一顿饭。', 'common', 'female', 68, 1, '无特质', '6aef7875-c2ac-4e89-8924-100694901098'::uuid, 10
union all
  select '西施犬2', '西施犬2', '软萌小害羞，被夸就脸红低头，其实心里超开心，就等你再夸一句。', 'common', 'female', 65, 1, '无特质', '6aef7875-c2ac-4e89-8924-100694901098'::uuid, 10
union all
  select '比格犬2', '比格犬2', '大耳朵雷达，闻到味道就竖耳兴奋，追着气味能把你遛到怀疑人生。', 'common', 'male', 63, 1, '无特质', '6aef7875-c2ac-4e89-8924-100694901098'::uuid, 10
union all
  select '哈士奇2', '哈士奇2', '披着围巾的优雅二哈，表面浅笑温柔，下一秒可能就开始拆家，反差萌拉满。', 'common', 'female', 60, 1, '无特质', '6aef7875-c2ac-4e89-8924-100694901098'::uuid, 10
union all
  select '黑豆柴', '黑豆柴', '黑得发亮的柴犬，脖子上系着蓝色领结，吐着舌头活泼又讨喜，活像一颗会蹦跶的黑豆。', 'rare', 'male', 300, 2, '小财迷', 'c72c2097-c40f-4c2b-8816-61d87e372777'::uuid, 20
union all
  select '土松', '土松', '黑色蓬松小土狗，明明是小可爱却总爱摆臭脸，傲娇得不行，其实心里早就乐开了花。', 'rare', 'male', 298, 2, '乐天派', '20eecf26-1916-400d-8976-aceb04073719'::uuid, 20
union all
  select '黑白边牧', '黑白边牧', '黑白配色的机灵边牧，眼神聪慧，是最会看眼色的高智商学霸型狗狗。', 'rare', 'male', 295, 2, '爱学习', '777fdbd6-93ca-460e-b74b-ccd4844cb896'::uuid, 20
union all
  select '阿拉斯加', '阿拉斯加', '大号暖宝宝，走路慢悠悠，笑起来能融化冰山，饭量也像冰山那么大。', 'rare', 'male', 290, 2, '好体魄', '399ef5cb-1373-4080-843a-140c8cd91978'::uuid, 20
union all
  select '陨石边牧', '陨石边牧', '头顶粉蝴蝶结、脖戴小花项圈的陨石边牧，漂亮又机灵，是爱美又聪明的优雅小淑女。', 'rare', 'female', 288, 2, '爱干净', '569992f3-1fb8-4731-86ac-689046462c4b'::uuid, 20
union all
  select '柴犬', '柴犬', '倔强小傲娇，走路神气十足，出门容易，回家得连哄带骗。', 'rare', 'male', 285, 2, '有活力', 'a8791b47-22e2-4a8d-b4c5-eeee21203092'::uuid, 20
union all
  select '柴犬2', '柴犬2', '困困柴，打哈欠都透着倔强，玩累了也要硬撑着不睡觉。', 'rare', 'female', 230, 2, '无特质', '6aef7875-c2ac-4e89-8924-100694901098'::uuid, 20
union all
  select '可卡布犬', '可卡布犬', '长耳朵小可爱，听到「出去玩」三个字，眼睛立刻冒星光。', 'rare', 'male', 228, 2, '无特质', '6aef7875-c2ac-4e89-8924-100694901098'::uuid, 20
union all
  select '西高地白梗', '西高地白梗', '白色小侦探，啥动静都要凑上去看，歪头瞪眼是标准疑惑脸。', 'rare', 'male', 225, 2, '无特质', '6aef7875-c2ac-4e89-8924-100694901098'::uuid, 20
union all
  select '杰克罗素梗', '杰克罗素梗', '小个子大能量，求抱抱时软萌到犯规，放下地立刻变身永动机。', 'rare', 'male', 222, 2, '无特质', '6aef7875-c2ac-4e89-8924-100694901098'::uuid, 20
union all
  select '刚毛猎狐梗', '刚毛猎狐梗', '本土小机灵，眨眨眼就有坏主意，看家护院一把好手，撒娇也不输谁。', 'rare', 'male', 220, 2, '无特质', '6aef7875-c2ac-4e89-8924-100694901098'::uuid, 20
union all
  select '大黄', '大黄', '中华田园犬最忠诚的代表，看家的一把好手，一脸严肃，内心十分从容。', 'epic', 'male', 600, 5, '乐天派', '20eecf26-1916-400d-8976-aceb04073719'::uuid, 25
union all
  select '罗威纳', '罗威纳', '铁汉柔情代表，一脸严肃像在巡逻，其实只是在认真思考晚饭吃什么。', 'epic', 'male', 580, 5, '好体魄', '399ef5cb-1373-4080-843a-140c8cd91978'::uuid, 25
union all
  select '伯恩山犬', '伯恩山犬', '大山之子得意版，自信满满，觉得自己是全场最靓的巨型崽。', 'epic', 'male', 560, 5, '有活力', 'a8791b47-22e2-4a8d-b4c5-eeee21203092'::uuid, 25
union all
  select '圣伯纳', '圣伯纳', '巨型慵懒担当，打个哈欠像地震，温柔大块头，趴着就能治愈全世界。', 'epic', 'male', 450, 5, '无特质', '6aef7875-c2ac-4e89-8924-100694901098'::uuid, 25
union all
  select '澳牧', '澳牧', '聪明工作狂，眼神专注锁定目标，学指令比你背单词还快。', 'epic', 'male', 440, 5, '无特质', '6aef7875-c2ac-4e89-8924-100694901098'::uuid, 25
union all
  select '伯恩山犬2', '伯恩山犬2', '大山一样稳重，走路带风威风凛凛，私底下是个爱撒娇的大宝宝。', 'epic', 'female', 430, 5, '无特质', '6aef7875-c2ac-4e89-8924-100694901098'::uuid, 25
)
update public.pet_shop_items p
set
  name = d.name,
  breed = d.breed,
  description = d.description,
  rarity = d.rarity,
  gender = d.gender,
  price_star = d.price_star,
  base_coin_per_day = d.base_coin_per_day,
  trait = d.trait,
  trait_id = d.trait_id,
  max_level = d.max_level
from data d
where p.type = 'pet' and (p.breed = d.breed or p.breed = '德牧' and d.breed = '德国牧羊犬');

-- ============================================================
-- 二、插入不存在的新品种（柯基、德国牧羊犬、黑豆柴、土松、黑白边牧、陨石边牧、大黄）
-- ============================================================

insert into public.pet_shop_items (type, subcategory, name, breed, description, rarity, gender, price_star, base_coin_per_day, trait, trait_id, max_level, emoji, status)
select 'pet', 'dog', '柯基', '柯基', '系着红色三角巾的小短腿柯基，圆滚滚的小屁股走起路来一扭一扭，吐舌傻笑治愈值满分。', 'common', 'female', 135, 1, '有活力', 'a8791b47-22e2-4a8d-b4c5-eeee21203092'::uuid, 10, '🐶', 'active'
where not exists (select 1 from public.pet_shop_items where breed = '柯基' and type = 'pet');

insert into public.pet_shop_items (type, subcategory, name, breed, description, rarity, gender, price_star, base_coin_per_day, trait, trait_id, max_level, emoji, status)
select 'pet', 'dog', '德国牧羊犬', '德国牧羊犬', '全能学霸，机警认真执行力强，当得了警犬也当得了你的贴身保镖。', 'common', 'male', 126, 1, '爱学习', '777fdbd6-93ca-460e-b74b-ccd4844cb896'::uuid, 10, '🐶', 'active'
where not exists (select 1 from public.pet_shop_items where breed = '德国牧羊犬' and type = 'pet');

insert into public.pet_shop_items (type, subcategory, name, breed, description, rarity, gender, price_star, base_coin_per_day, trait, trait_id, max_level, emoji, status)
select 'pet', 'dog', '黑豆柴', '黑豆柴', '黑得发亮的柴犬，脖子上系着蓝色领结，吐着舌头活泼又讨喜，活像一颗会蹦跶的黑豆。', 'rare', 'male', 300, 2, '小财迷', 'c72c2097-c40f-4c2b-8816-61d87e372777'::uuid, 20, '🐶', 'active'
where not exists (select 1 from public.pet_shop_items where breed = '黑豆柴' and type = 'pet');

insert into public.pet_shop_items (type, subcategory, name, breed, description, rarity, gender, price_star, base_coin_per_day, trait, trait_id, max_level, emoji, status)
select 'pet', 'dog', '土松', '土松', '黑色蓬松小土狗，明明是小可爱却总爱摆臭脸，傲娇得不行，其实心里早就乐开了花。', 'rare', 'male', 298, 2, '乐天派', '20eecf26-1916-400d-8976-aceb04073719'::uuid, 20, '🐶', 'active'
where not exists (select 1 from public.pet_shop_items where breed = '土松' and type = 'pet');

insert into public.pet_shop_items (type, subcategory, name, breed, description, rarity, gender, price_star, base_coin_per_day, trait, trait_id, max_level, emoji, status)
select 'pet', 'dog', '黑白边牧', '黑白边牧', '黑白配色的机灵边牧，眼神聪慧，是最会看眼色的高智商学霸型狗狗。', 'rare', 'male', 295, 2, '爱学习', '777fdbd6-93ca-460e-b74b-ccd4844cb896'::uuid, 20, '🐶', 'active'
where not exists (select 1 from public.pet_shop_items where breed = '黑白边牧' and type = 'pet');

insert into public.pet_shop_items (type, subcategory, name, breed, description, rarity, gender, price_star, base_coin_per_day, trait, trait_id, max_level, emoji, status)
select 'pet', 'dog', '陨石边牧', '陨石边牧', '头顶粉蝴蝶结、脖戴小花项圈的陨石边牧，漂亮又机灵，是爱美又聪明的优雅小淑女。', 'rare', 'female', 288, 2, '爱干净', '569992f3-1fb8-4731-86ac-689046462c4b'::uuid, 20, '🐶', 'active'
where not exists (select 1 from public.pet_shop_items where breed = '陨石边牧' and type = 'pet');

insert into public.pet_shop_items (type, subcategory, name, breed, description, rarity, gender, price_star, base_coin_per_day, trait, trait_id, max_level, emoji, status)
select 'pet', 'dog', '大黄', '大黄', '中华田园犬最忠诚的代表，看家的一把好手，一脸严肃，内心十分从容。', 'epic', 'male', 600, 5, '乐天派', '20eecf26-1916-400d-8976-aceb04073719'::uuid, 25, '🐶', 'active'
where not exists (select 1 from public.pet_shop_items where breed = '大黄' and type = 'pet');

-- ============================================================
-- 三、同步已领养宠物（pets表）
-- ============================================================

with data(breed, name, description, rarity, gender, price_star, base_coin_per_day, trait, trait_id, max_level) as (
  select '金毛', '金毛', '犬界中央空调，对谁都温柔笑，捡球专业户，口水和温柔一样多。', 'common', 'male', 140, 1, '乐天派', '20eecf26-1916-400d-8976-aceb04073719'::uuid, 10
union all
  select '柯基', '柯基', '系着红色三角巾的小短腿柯基，圆滚滚的小屁股走起路来一扭一扭，吐舌傻笑治愈值满分。', 'common', 'female', 135, 1, '有活力', 'a8791b47-22e2-4a8d-b4c5-eeee21203092'::uuid, 10
union all
  select '拉布拉多', '拉布拉多', '天生社交达人，见人就摇尾招手，零食一掏立刻变你的头号粉丝。', 'common', 'male', 132, 1, '小财迷', 'c72c2097-c40f-4c2b-8816-61d87e372777'::uuid, 10
union all
  select '萨摩耶', '萨摩耶', '微笑天使本使，乐天派回望你，黄巾一戴谁都不爱，除了玩雪。', 'common', 'male', 130, 1, '乐天派', '20eecf26-1916-400d-8976-aceb04073719'::uuid, 10
union all
  select '哈士奇', '哈士奇', '二哈界高冷担当，侧脸杀绝美，你一拿零食，高冷人设秒崩。', 'common', 'male', 128, 1, '好体魄', '399ef5cb-1373-4080-843a-140c8cd91978'::uuid, 10
union all
  select '德国牧羊犬', '德国牧羊犬', '全能学霸，机警认真执行力强，当得了警犬也当得了你的贴身保镖。', 'common', 'male', 126, 1, '爱学习', '777fdbd6-93ca-460e-b74b-ccd4844cb896'::uuid, 10
union all
  select '法斗', '法斗', '打呼噜冠军，鼓腮呆萌，走路摇摇晃晃，丑萌界天花板。', 'common', 'male', 124, 1, '小财迷', 'c72c2097-c40f-4c2b-8816-61d87e372777'::uuid, 10
union all
  select '比熊', '比熊', '卷毛小团子，歪头杀专业户，你说啥它都装作听懂了，其实只惦记零食。', 'common', 'female', 122, 1, '爱干净', '569992f3-1fb8-4731-86ac-689046462c4b'::uuid, 10
union all
  select '约克夏', '约克夏', '丝毛小绅士，走路抬头挺胸，嘴上不理你，其实偷偷等你夸它好看。', 'common', 'female', 121, 1, '爱干净', '569992f3-1fb8-4731-86ac-689046462c4b'::uuid, 10
union all
  select '斑点狗', '斑点狗', '移动小马达，永远电量满格，遛弯两小时回家还能再拆一个枕头。', 'common', 'male', 120, 1, '有活力', 'a8791b47-22e2-4a8d-b4c5-eeee21203092'::uuid, 10
union all
  select '喜乐蒂', '喜乐蒂', '小型牧羊犬，兴奋到歪头吐舌，聪明又黏人，小短腿倒腾飞快。', 'common', 'female', 120, 1, '爱学习', '777fdbd6-93ca-460e-b74b-ccd4844cb896'::uuid, 10
union all
  select '金毛2', '金毛2', '暖男金毛幸福版，眯眼享受被撸，幸福感爆棚的治愈系大狗狗。', 'common', 'female', 120, 1, '好体魄', '399ef5cb-1373-4080-843a-140c8cd91978'::uuid, 10
union all
  select '马尔济斯', '马尔济斯', '白色小天使，温柔乖巧不吵不闹，抱在怀里像团暖暖的云。', 'common', 'female', 80, 1, '无特质', '6aef7875-c2ac-4e89-8924-100694901098'::uuid, 10
union all
  select '博美', '博美', '毛茸茸小太阳，笑起来眼睛弯弯，走到哪都带着快乐的氛围组组长。', 'common', 'female', 78, 1, '无特质', '6aef7875-c2ac-4e89-8924-100694901098'::uuid, 10
union all
  select '西施犬', '西施犬', '小公主脾气，被忽略就鼓腮生气，给块肉干立刻多云转晴。', 'common', 'female', 76, 1, '无特质', '6aef7875-c2ac-4e89-8924-100694901098'::uuid, 10
union all
  select '雪纳瑞', '雪纳瑞', '小老头外表佛系心，天塌下来先吃口饭，淡定得像看透了狗生。', 'common', 'male', 75, 1, '无特质', '6aef7875-c2ac-4e89-8924-100694901098'::uuid, 10
union all
  select '查理王', '查理王', '长耳朵憨憨，整天挂着傻笑，没心没肺快乐小狗本狗。', 'common', 'male', 74, 1, '无特质', '6aef7875-c2ac-4e89-8924-100694901098'::uuid, 10
union all
  select '比格犬', '比格犬', '同款大耳朵，这次满脸问号，你在说啥？本狗听不懂但大受震撼。', 'common', 'female', 73, 1, '无特质', '6aef7875-c2ac-4e89-8924-100694901098'::uuid, 10
union all
  select '史宾格', '史宾格', '运动小能手，听到出门就睁大眼惊喜，捡球巡回技能点满。', 'common', 'male', 72, 1, '无特质', '6aef7875-c2ac-4e89-8924-100694901098'::uuid, 10
union all
  select '银狐犬', '银狐犬', '微笑小狐狸，吃到好吃的就眯眼满足，像团会走路的棉花糖。', 'common', 'female', 70, 1, '无特质', '6aef7875-c2ac-4e89-8924-100694901098'::uuid, 10
union all
  select '巴吉度', '巴吉度', '大耳朵耷拉着，泪眼汪汪委屈巴巴，其实只是在想下一顿饭。', 'common', 'female', 68, 1, '无特质', '6aef7875-c2ac-4e89-8924-100694901098'::uuid, 10
union all
  select '西施犬2', '西施犬2', '软萌小害羞，被夸就脸红低头，其实心里超开心，就等你再夸一句。', 'common', 'female', 65, 1, '无特质', '6aef7875-c2ac-4e89-8924-100694901098'::uuid, 10
union all
  select '比格犬2', '比格犬2', '大耳朵雷达，闻到味道就竖耳兴奋，追着气味能把你遛到怀疑人生。', 'common', 'male', 63, 1, '无特质', '6aef7875-c2ac-4e89-8924-100694901098'::uuid, 10
union all
  select '哈士奇2', '哈士奇2', '披着围巾的优雅二哈，表面浅笑温柔，下一秒可能就开始拆家，反差萌拉满。', 'common', 'female', 60, 1, '无特质', '6aef7875-c2ac-4e89-8924-100694901098'::uuid, 10
union all
  select '黑豆柴', '黑豆柴', '黑得发亮的柴犬，脖子上系着蓝色领结，吐着舌头活泼又讨喜，活像一颗会蹦跶的黑豆。', 'rare', 'male', 300, 2, '小财迷', 'c72c2097-c40f-4c2b-8816-61d87e372777'::uuid, 20
union all
  select '土松', '土松', '黑色蓬松小土狗，明明是小可爱却总爱摆臭脸，傲娇得不行，其实心里早就乐开了花。', 'rare', 'male', 298, 2, '乐天派', '20eecf26-1916-400d-8976-aceb04073719'::uuid, 20
union all
  select '黑白边牧', '黑白边牧', '黑白配色的机灵边牧，眼神聪慧，是最会看眼色的高智商学霸型狗狗。', 'rare', 'male', 295, 2, '爱学习', '777fdbd6-93ca-460e-b74b-ccd4844cb896'::uuid, 20
union all
  select '阿拉斯加', '阿拉斯加', '大号暖宝宝，走路慢悠悠，笑起来能融化冰山，饭量也像冰山那么大。', 'rare', 'male', 290, 2, '好体魄', '399ef5cb-1373-4080-843a-140c8cd91978'::uuid, 20
union all
  select '陨石边牧', '陨石边牧', '头顶粉蝴蝶结、脖戴小花项圈的陨石边牧，漂亮又机灵，是爱美又聪明的优雅小淑女。', 'rare', 'female', 288, 2, '爱干净', '569992f3-1fb8-4731-86ac-689046462c4b'::uuid, 20
union all
  select '柴犬', '柴犬', '倔强小傲娇，走路神气十足，出门容易，回家得连哄带骗。', 'rare', 'male', 285, 2, '有活力', 'a8791b47-22e2-4a8d-b4c5-eeee21203092'::uuid, 20
union all
  select '柴犬2', '柴犬2', '困困柴，打哈欠都透着倔强，玩累了也要硬撑着不睡觉。', 'rare', 'female', 230, 2, '无特质', '6aef7875-c2ac-4e89-8924-100694901098'::uuid, 20
union all
  select '可卡布犬', '可卡布犬', '长耳朵小可爱，听到「出去玩」三个字，眼睛立刻冒星光。', 'rare', 'male', 228, 2, '无特质', '6aef7875-c2ac-4e89-8924-100694901098'::uuid, 20
union all
  select '西高地白梗', '西高地白梗', '白色小侦探，啥动静都要凑上去看，歪头瞪眼是标准疑惑脸。', 'rare', 'male', 225, 2, '无特质', '6aef7875-c2ac-4e89-8924-100694901098'::uuid, 20
union all
  select '杰克罗素梗', '杰克罗素梗', '小个子大能量，求抱抱时软萌到犯规，放下地立刻变身永动机。', 'rare', 'male', 222, 2, '无特质', '6aef7875-c2ac-4e89-8924-100694901098'::uuid, 20
union all
  select '刚毛猎狐梗', '刚毛猎狐梗', '本土小机灵，眨眨眼就有坏主意，看家护院一把好手，撒娇也不输谁。', 'rare', 'male', 220, 2, '无特质', '6aef7875-c2ac-4e89-8924-100694901098'::uuid, 20
union all
  select '大黄', '大黄', '中华田园犬最忠诚的代表，看家的一把好手，一脸严肃，内心十分从容。', 'epic', 'male', 600, 5, '乐天派', '20eecf26-1916-400d-8976-aceb04073719'::uuid, 25
union all
  select '罗威纳', '罗威纳', '铁汉柔情代表，一脸严肃像在巡逻，其实只是在认真思考晚饭吃什么。', 'epic', 'male', 580, 5, '好体魄', '399ef5cb-1373-4080-843a-140c8cd91978'::uuid, 25
union all
  select '伯恩山犬', '伯恩山犬', '大山之子得意版，自信满满，觉得自己是全场最靓的巨型崽。', 'epic', 'male', 560, 5, '有活力', 'a8791b47-22e2-4a8d-b4c5-eeee21203092'::uuid, 25
union all
  select '圣伯纳', '圣伯纳', '巨型慵懒担当，打个哈欠像地震，温柔大块头，趴着就能治愈全世界。', 'epic', 'male', 450, 5, '无特质', '6aef7875-c2ac-4e89-8924-100694901098'::uuid, 25
union all
  select '澳牧', '澳牧', '聪明工作狂，眼神专注锁定目标，学指令比你背单词还快。', 'epic', 'male', 440, 5, '无特质', '6aef7875-c2ac-4e89-8924-100694901098'::uuid, 25
union all
  select '伯恩山犬2', '伯恩山犬2', '大山一样稳重，走路带风威风凛凛，私底下是个爱撒娇的大宝宝。', 'epic', 'female', 430, 5, '无特质', '6aef7875-c2ac-4e89-8924-100694901098'::uuid, 25
)
update public.pets p
set
  name = d.name,
  breed = d.breed,
  rarity = d.rarity,
  gender = d.gender,
  base_coin_per_day = d.base_coin_per_day,
  trait_id = d.trait_id,
  max_level = d.max_level
from data d
join public.pet_shop_items psi on psi.id = p.shop_item_id
where psi.breed = d.breed;

notify pgrst, 'reload schema';