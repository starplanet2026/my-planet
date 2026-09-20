-- 0017: 批量上架36只宠物
do $$
declare
  v_family_id uuid;
  v_parent_id uuid;
begin
  select id into v_family_id from public.families order by created_at limit 1;
  if v_family_id is null then return; end if;

  select id into v_parent_id from public.members
    where family_id = v_family_id and role = 'parent' order by created_at limit 1;
  if v_parent_id is null then return; end if;

  -- 普通宠物 (星光值10, 升级奖励10金, 产金2/天)
  -- 稀有宠物 (星光值30, 升级奖励30金, 产金5/天)
  -- 史诗宠物 (星光值80, 升级奖励80金, 产金10/天)

  -- 1. 拉布拉多 (普通, 公)
  insert into public.pet_shop_items (family_id, type, name, emoji, description, price_star, price_coin, breed, base_coin_per_day, rarity, gender, status)
  select v_family_id, 'pet', '拉布拉多', '🐶', '天生社交达人，见人就摇尾招手，零食一掏立刻变你的头号粉丝。', 10, 10, '拉布拉多', 2, 'common', 'male', 'active'
  where not exists (select 1 from public.pet_shop_items where family_id = v_family_id and breed = '拉布拉多');

  -- 2. 哈士奇 (普通, 公)
  insert into public.pet_shop_items (family_id, type, name, emoji, description, price_star, price_coin, breed, base_coin_per_day, rarity, gender, status)
  select v_family_id, 'pet', '哈士奇', '🐺', '披着围巾的优雅二哈，表面浅笑温柔，下一秒可能就开始拆家，反差萌拉满。', 10, 10, '哈士奇', 2, 'common', 'male', 'active'
  where not exists (select 1 from public.pet_shop_items where family_id = v_family_id and breed = '哈士奇');

  -- 3. 泰迪 (普通, 母)
  insert into public.pet_shop_items (family_id, type, name, emoji, description, price_star, price_coin, breed, base_coin_per_day, rarity, gender, status)
  select v_family_id, 'pet', '泰迪', '🐩', '卷毛小团子，歪头杀专业户，你说啥它都装作听懂了，其实只惦记零食。', 10, 10, '泰迪', 2, 'common', 'female', 'active'
  where not exists (select 1 from public.pet_shop_items where family_id = v_family_id and breed = '泰迪');

  -- 4. 阿拉斯加 (稀有, 公)
  insert into public.pet_shop_items (family_id, type, name, emoji, description, price_star, price_coin, breed, base_coin_per_day, rarity, gender, status)
  select v_family_id, 'pet', '阿拉斯加', '🐻', '大号暖宝宝，走路慢悠悠，笑起来能融化冰山，饭量也像冰山那么大。', 30, 30, '阿拉斯加', 5, 'rare', 'male', 'active'
  where not exists (select 1 from public.pet_shop_items where family_id = v_family_id and breed = '阿拉斯加');

  -- 5. 西施犬 (稀有, 母)
  insert into public.pet_shop_items (family_id, type, name, emoji, description, price_star, price_coin, breed, base_coin_per_day, rarity, gender, status)
  select v_family_id, 'pet', '西施犬', '🦁', '小公主脾气，被忽略就鼓腮生气，给块肉干立刻多云转晴。', 30, 30, '西施犬', 5, 'rare', 'female', 'active'
  where not exists (select 1 from public.pet_shop_items where family_id = v_family_id and breed = '西施犬');

  -- 6. 斑点狗 (稀有, 公)
  insert into public.pet_shop_items (family_id, type, name, emoji, description, price_star, price_coin, breed, base_coin_per_day, rarity, gender, status)
  select v_family_id, 'pet', '斑点狗', '🐕', '移动小马达，永远电量满格，遛弯两小时回家还能再拆一个枕头。', 30, 30, '斑点狗', 5, 'rare', 'male', 'active'
  where not exists (select 1 from public.pet_shop_items where family_id = v_family_id and breed = '斑点狗');

  -- 7. 约克夏 (普通, 母)
  insert into public.pet_shop_items (family_id, type, name, emoji, description, price_star, price_coin, breed, base_coin_per_day, rarity, gender, status)
  select v_family_id, 'pet', '约克夏', '🐾', '丝毛小绅士，走路抬头挺胸，嘴上不理你，其实偷偷等你夸它好看。', 10, 10, '约克夏', 2, 'common', 'female', 'active'
  where not exists (select 1 from public.pet_shop_items where family_id = v_family_id and breed = '约克夏');

  -- 8. 西高地白梗 (普通, 公)
  insert into public.pet_shop_items (family_id, type, name, emoji, description, price_star, price_coin, breed, base_coin_per_day, rarity, gender, status)
  select v_family_id, 'pet', '西高地白梗', '🦴', '白色小侦探，啥动静都要凑上去看，歪头瞪眼是标准疑惑脸。', 10, 10, '西高地白梗', 2, 'common', 'male', 'active'
  where not exists (select 1 from public.pet_shop_items where family_id = v_family_id and breed = '西高地白梗');

  -- 9. 中华田园犬 (普通, 公)
  insert into public.pet_shop_items (family_id, type, name, emoji, description, price_star, price_coin, breed, base_coin_per_day, rarity, gender, status)
  select v_family_id, 'pet', '中华田园犬', '🐕', '本土小机灵，眨眨眼就有坏主意，看家护院一把好手，撒娇也不输谁。', 10, 10, '中华田园犬', 2, 'common', 'male', 'active'
  where not exists (select 1 from public.pet_shop_items where family_id = v_family_id and breed = '中华田园犬');

  -- 10. 杰克罗素梗 (稀有, 公)
  insert into public.pet_shop_items (family_id, type, name, emoji, description, price_star, price_coin, breed, base_coin_per_day, rarity, gender, status)
  select v_family_id, 'pet', '杰克罗素梗', '🐶', '小个子大能量，求抱抱时软萌到犯规，放下地立刻变身永动机。', 30, 30, '杰克罗素梗', 5, 'rare', 'male', 'active'
  where not exists (select 1 from public.pet_shop_items where family_id = v_family_id and breed = '杰克罗素梗');

  -- 11. 博美 (普通, 母)
  insert into public.pet_shop_items (family_id, type, name, emoji, description, price_star, price_coin, breed, base_coin_per_day, rarity, gender, status)
  select v_family_id, 'pet', '博美', '🦊', '毛茸茸小太阳，笑起来眼睛弯弯，走到哪都带着快乐的氛围组组长。', 10, 10, '博美', 2, 'common', 'female', 'active'
  where not exists (select 1 from public.pet_shop_items where family_id = v_family_id and breed = '博美');

  -- 12. 罗威纳 (史诗, 公)
  insert into public.pet_shop_items (family_id, type, name, emoji, description, price_star, price_coin, breed, base_coin_per_day, rarity, gender, status)
  select v_family_id, 'pet', '罗威纳', '🐕', '铁汉柔情代表，一脸严肃像在巡逻，其实只是在认真思考晚饭吃什么。', 80, 80, '罗威纳', 10, 'epic', 'male', 'active'
  where not exists (select 1 from public.pet_shop_items where family_id = v_family_id and breed = '罗威纳');

  -- 13. 圣伯纳 (史诗, 公)
  insert into public.pet_shop_items (family_id, type, name, emoji, description, price_star, price_coin, breed, base_coin_per_day, rarity, gender, status)
  select v_family_id, 'pet', '圣伯纳', '🐻', '巨型慵懒担当，打个哈欠像地震，温柔大块头，趴着就能治愈全世界。', 80, 80, '圣伯纳', 10, 'epic', 'male', 'active'
  where not exists (select 1 from public.pet_shop_items where family_id = v_family_id and breed = '圣伯纳');

  -- 14. 哈士奇2 (普通, 公)
  insert into public.pet_shop_items (family_id, type, name, emoji, description, price_star, price_coin, breed, base_coin_per_day, rarity, gender, status)
  select v_family_id, 'pet', '哈士奇2', '🐺', '二哈界高冷担当，侧脸杀绝美，你一拿零食，高冷人设秒崩。', 10, 10, '哈士奇2', 2, 'common', 'male', 'active'
  where not exists (select 1 from public.pet_shop_items where family_id = v_family_id and breed = '哈士奇2');

  -- 15. 银狐犬 (稀有, 母)
  insert into public.pet_shop_items (family_id, type, name, emoji, description, price_star, price_coin, breed, base_coin_per_day, rarity, gender, status)
  select v_family_id, 'pet', '银狐犬', '🦊', '微笑小狐狸，吃到好吃的就眯眼满足，像团会走路的棉花糖。', 30, 30, '银狐犬', 5, 'rare', 'female', 'active'
  where not exists (select 1 from public.pet_shop_items where family_id = v_family_id and breed = '银狐犬');

  -- 16. 比格犬 (普通, 公)
  insert into public.pet_shop_items (family_id, type, name, emoji, description, price_star, price_coin, breed, base_coin_per_day, rarity, gender, status)
  select v_family_id, 'pet', '比格犬', '🐕', '大耳朵雷达，闻到味道就竖耳兴奋，追着气味能把你遛到怀疑人生。', 10, 10, '比格犬', 2, 'common', 'male', 'active'
  where not exists (select 1 from public.pet_shop_items where family_id = v_family_id and breed = '比格犬');

  -- 17. 金毛 (普通, 公)
  insert into public.pet_shop_items (family_id, type, name, emoji, description, price_star, price_coin, breed, base_coin_per_day, rarity, gender, status)
  select v_family_id, 'pet', '金毛', '🐕', '犬界中央空调，对谁都温柔笑，捡球专业户，口水和温柔一样多。', 10, 10, '金毛', 2, 'common', 'male', 'active'
  where not exists (select 1 from public.pet_shop_items where family_id = v_family_id and breed = '金毛');

  -- 18. 澳牧 (史诗, 公)
  insert into public.pet_shop_items (family_id, type, name, emoji, description, price_star, price_coin, breed, base_coin_per_day, rarity, gender, status)
  select v_family_id, 'pet', '澳牧', '🐕', '聪明工作狂，眼神专注锁定目标，学指令比你背单词还快。', 80, 80, '澳牧', 10, 'epic', 'male', 'active'
  where not exists (select 1 from public.pet_shop_items where family_id = v_family_id and breed = '澳牧');

  -- 19. 西施犬2 (稀有, 母)
  insert into public.pet_shop_items (family_id, type, name, emoji, description, price_star, price_coin, breed, base_coin_per_day, rarity, gender, status)
  select v_family_id, 'pet', '西施犬2', '🦁', '软萌小害羞，被夸就脸红低头，其实心里超开心，就等你再夸一句。', 30, 30, '西施犬2', 5, 'rare', 'female', 'active'
  where not exists (select 1 from public.pet_shop_items where family_id = v_family_id and breed = '西施犬2');

  -- 20. 伯恩山犬 (史诗, 公)
  insert into public.pet_shop_items (family_id, type, name, emoji, description, price_star, price_coin, breed, base_coin_per_day, rarity, gender, status)
  select v_family_id, 'pet', '伯恩山犬', '🐻', '大山一样稳重，走路带风威风凛凛，私底下是个爱撒娇的大宝宝。', 80, 80, '伯恩山犬', 10, 'epic', 'male', 'active'
  where not exists (select 1 from public.pet_shop_items where family_id = v_family_id and breed = '伯恩山犬');

  -- 21. 喜乐蒂 (稀有, 母)
  insert into public.pet_shop_items (family_id, type, name, emoji, description, price_star, price_coin, breed, base_coin_per_day, rarity, gender, status)
  select v_family_id, 'pet', '喜乐蒂', '🐕', '小型牧羊犬，兴奋到歪头吐舌，聪明又黏人，小短腿倒腾飞快。', 30, 30, '喜乐蒂', 5, 'rare', 'female', 'active'
  where not exists (select 1 from public.pet_shop_items where family_id = v_family_id and breed = '喜乐蒂');

  -- 22. 可卡布犬 (普通, 公)
  insert into public.pet_shop_items (family_id, type, name, emoji, description, price_star, price_coin, breed, base_coin_per_day, rarity, gender, status)
  select v_family_id, 'pet', '可卡布犬', '🐕', '长耳朵小可爱，听到「出去玩」三个字，眼睛立刻冒星光。', 10, 10, '可卡布犬', 2, 'common', 'male', 'active'
  where not exists (select 1 from public.pet_shop_items where family_id = v_family_id and breed = '可卡布犬');

  -- 23. 比格犬2 (普通, 公)
  insert into public.pet_shop_items (family_id, type, name, emoji, description, price_star, price_coin, breed, base_coin_per_day, rarity, gender, status)
  select v_family_id, 'pet', '比格犬2', '🐕', '同款大耳朵，这次满脸问号，你在说啥？本狗听不懂但大受震撼。', 10, 10, '比格犬2', 2, 'common', 'male', 'active'
  where not exists (select 1 from public.pet_shop_items where family_id = v_family_id and breed = '比格犬2');

  -- 24. 柴犬 (普通, 公)
  insert into public.pet_shop_items (family_id, type, name, emoji, description, price_star, price_coin, breed, base_coin_per_day, rarity, gender, status)
  select v_family_id, 'pet', '柴犬', '🐕', '倔强小傲娇，走路神气十足，出门容易，回家得连哄带骗。', 10, 10, '柴犬', 2, 'common', 'male', 'active'
  where not exists (select 1 from public.pet_shop_items where family_id = v_family_id and breed = '柴犬');

  -- 25. 马尔济斯 (稀有, 母)
  insert into public.pet_shop_items (family_id, type, name, emoji, description, price_star, price_coin, breed, base_coin_per_day, rarity, gender, status)
  select v_family_id, 'pet', '马尔济斯', '🐕', '白色小天使，温柔乖巧不吵不闹，抱在怀里像团暖暖的云。', 30, 30, '马尔济斯', 5, 'rare', 'female', 'active'
  where not exists (select 1 from public.pet_shop_items where family_id = v_family_id and breed = '马尔济斯');

  -- 26. 法斗 (普通, 公)
  insert into public.pet_shop_items (family_id, type, name, emoji, description, price_star, price_coin, breed, base_coin_per_day, rarity, gender, status)
  select v_family_id, 'pet', '法斗', '🐶', '打呼噜冠军，鼓腮呆萌，走路摇摇晃晃，丑萌界天花板。', 10, 10, '法斗', 2, 'common', 'male', 'active'
  where not exists (select 1 from public.pet_shop_items where family_id = v_family_id and breed = '法斗');

  -- 27. 德国牧羊犬 (稀有, 公)
  insert into public.pet_shop_items (family_id, type, name, emoji, description, price_star, price_coin, breed, base_coin_per_day, rarity, gender, status)
  select v_family_id, 'pet', '德国牧羊犬', '🐕', '全能学霸，机警认真执行力强，当得了警犬也当得了你的贴身保镖。', 30, 30, '德国牧羊犬', 5, 'rare', 'male', 'active'
  where not exists (select 1 from public.pet_shop_items where family_id = v_family_id and breed = '德国牧羊犬');

  -- 28. 可卡布犬2 (普通, 公)
  insert into public.pet_shop_items (family_id, type, name, emoji, description, price_star, price_coin, breed, base_coin_per_day, rarity, gender, status)
  select v_family_id, 'pet', '可卡布犬2', '🐕', '长耳朵憨憨，整天挂着傻笑，没心没肺快乐小狗本狗。', 10, 10, '可卡布犬2', 2, 'common', 'male', 'active'
  where not exists (select 1 from public.pet_shop_items where family_id = v_family_id and breed = '可卡布犬2');

  -- 29. 雪纳瑞 (普通, 公)
  insert into public.pet_shop_items (family_id, type, name, emoji, description, price_star, price_coin, breed, base_coin_per_day, rarity, gender, status)
  select v_family_id, 'pet', '雪纳瑞', '🐕', '小老头外表佛系心，天塌下来先吃口饭，淡定得像看透了狗生。', 10, 10, '雪纳瑞', 2, 'common', 'male', 'active'
  where not exists (select 1 from public.pet_shop_items where family_id = v_family_id and breed = '雪纳瑞');

  -- 30. 伯恩山犬2 (史诗, 公)
  insert into public.pet_shop_items (family_id, type, name, emoji, description, price_star, price_coin, breed, base_coin_per_day, rarity, gender, status)
  select v_family_id, 'pet', '伯恩山犬2', '🐻', '大山之子得意版，自信满满，觉得自己是全场最靓的巨型崽。', 80, 80, '伯恩山犬2', 10, 'epic', 'male', 'active'
  where not exists (select 1 from public.pet_shop_items where family_id = v_family_id and breed = '伯恩山犬2');

  -- 31. 萨摩耶 (普通, 公)
  insert into public.pet_shop_items (family_id, type, name, emoji, description, price_star, price_coin, breed, base_coin_per_day, rarity, gender, status)
  select v_family_id, 'pet', '萨摩耶', '🐕', '微笑天使本使，乐天派回望你，黄巾一戴谁都不爱，除了玩雪。', 10, 10, '萨摩耶', 2, 'common', 'male', 'active'
  where not exists (select 1 from public.pet_shop_items where family_id = v_family_id and breed = '萨摩耶');

  -- 32. 柴犬2 (普通, 公)
  insert into public.pet_shop_items (family_id, type, name, emoji, description, price_star, price_coin, breed, base_coin_per_day, rarity, gender, status)
  select v_family_id, 'pet', '柴犬2', '🐕', '困困柴，打哈欠都透着倔强，玩累了也要硬撑着不睡觉。', 10, 10, '柴犬2', 2, 'common', 'male', 'active'
  where not exists (select 1 from public.pet_shop_items where family_id = v_family_id and breed = '柴犬2');

  -- 33. 巴吉度 (稀有, 母)
  insert into public.pet_shop_items (family_id, type, name, emoji, description, price_star, price_coin, breed, base_coin_per_day, rarity, gender, status)
  select v_family_id, 'pet', '巴吉度', '🐕', '大耳朵耷拉着，泪眼汪汪委屈巴巴，其实只是在想下一顿饭。', 30, 30, '巴吉度', 5, 'rare', 'female', 'active'
  where not exists (select 1 from public.pet_shop_items where family_id = v_family_id and breed = '巴吉度');

  -- 34. 哈士奇3 (普通, 公)
  insert into public.pet_shop_items (family_id, type, name, emoji, description, price_star, price_coin, breed, base_coin_per_day, rarity, gender, status)
  select v_family_id, 'pet', '哈士奇3', '🐺', '二哈终极形态，元气呐喊到破音，有它在家里永远不会安静。', 10, 10, '哈士奇3', 2, 'common', 'male', 'active'
  where not exists (select 1 from public.pet_shop_items where family_id = v_family_id and breed = '哈士奇3');

  -- 35. 史宾格 (稀有, 公)
  insert into public.pet_shop_items (family_id, type, name, emoji, description, price_star, price_coin, breed, base_coin_per_day, rarity, gender, status)
  select v_family_id, 'pet', '史宾格', '🐕', '运动小能手，听到出门就睁大眼惊喜，捡球巡回技能点满。', 30, 30, '史宾格', 5, 'rare', 'male', 'active'
  where not exists (select 1 from public.pet_shop_items where family_id = v_family_id and breed = '史宾格');

  -- 36. 金毛2 (普通, 公)
  insert into public.pet_shop_items (family_id, type, name, emoji, description, price_star, price_coin, breed, base_coin_per_day, rarity, gender, status)
  select v_family_id, 'pet', '金毛2', '🐕', '暖男金毛幸福版，眯眼享受被撸，幸福感爆棚的治愈系大狗狗。', 10, 10, '金毛2', 2, 'common', 'male', 'active'
  where not exists (select 1 from public.pet_shop_items where family_id = v_family_id and breed = '金毛2');

  raise notice '36只宠物已上架';
end;
$$;
