-- 0287: 恢复被 cleanup_old_records 误删的成就库卡片
-- 来源：内置默认成就清单（完整字段）+ coin_records 完成台账（标题/奖励）

insert into public.tasks (family_id, member_id, title, description, category, icon, reward_coins, repeat_days, status, created_by, is_default)
select 'cca31751-9ecf-4923-a519-169f8740773e', null, '上课准时挑战', '', 'black', '⚠️', -20, null, 'draft', '63cdc08f-cdf9-4a3f-971c-0284b66cb5e8', false
where not exists (select 1 from public.tasks where family_id='cca31751-9ecf-4923-a519-169f8740773e' and title='上课准时挑战');
insert into public.tasks (family_id, member_id, title, description, category, icon, reward_coins, repeat_days, status, created_by, is_default)
select 'cca31751-9ecf-4923-a519-169f8740773e', null, '光盘行动家', '把盘子里的早餐全部消灭干净，一点不剩！', 'daily', '🍽️', 8, array[0,1,2,3,4,5], 'active', '63cdc08f-cdf9-4a3f-971c-0284b66cb5e8', true
where not exists (select 1 from public.tasks where family_id='cca31751-9ecf-4923-a519-169f8740773e' and title='光盘行动家');
insert into public.tasks (family_id, member_id, title, description, category, icon, reward_coins, repeat_days, status, created_by, is_default)
select 'cca31751-9ecf-4923-a519-169f8740773e', null, '写字课全勤王', '准时上课不迟到，练出一手好字！', 'daily', '✏️', 5, array[0], 'active', '63cdc08f-cdf9-4a3f-971c-0284b66cb5e8', true
where not exists (select 1 from public.tasks where family_id='cca31751-9ecf-4923-a519-169f8740773e' and title='写字课全勤王');
insert into public.tasks (family_id, member_id, title, description, category, icon, reward_coins, repeat_days, status, created_by, is_default)
select 'cca31751-9ecf-4923-a519-169f8740773e', null, '博览群书侠', '', 'super', '🎯', 60, null, 'draft', '63cdc08f-cdf9-4a3f-971c-0284b66cb5e8', false
where not exists (select 1 from public.tasks where family_id='cca31751-9ecf-4923-a519-169f8740773e' and title='博览群书侠');
insert into public.tasks (family_id, member_id, title, description, category, icon, reward_coins, repeat_days, status, created_by, is_default)
select 'cca31751-9ecf-4923-a519-169f8740773e', null, '厨师美食家', '', 'stage', '🎯', 20, null, 'draft', '63cdc08f-cdf9-4a3f-971c-0284b66cb5e8', false
where not exists (select 1 from public.tasks where family_id='cca31751-9ecf-4923-a519-169f8740773e' and title='厨师美食家');
insert into public.tasks (family_id, member_id, title, description, category, icon, reward_coins, repeat_days, status, created_by, is_default)
select 'cca31751-9ecf-4923-a519-169f8740773e', null, '外教作业达人', '完成作业并书写工整，书写潦草会被扣3颗星', 'daily', '📋', 5, array[5], 'active', '63cdc08f-cdf9-4a3f-971c-0284b66cb5e8', true
where not exists (select 1 from public.tasks where family_id='cca31751-9ecf-4923-a519-169f8740773e' and title='外教作业达人');
insert into public.tasks (family_id, member_id, title, description, category, icon, reward_coins, repeat_days, status, created_by, is_default)
select 'cca31751-9ecf-4923-a519-169f8740773e', null, '外教课全勤王', '准时上课不迟到，和外教老师快乐学英语！', 'daily', '👨‍🏫', 5, array[6], 'active', '63cdc08f-cdf9-4a3f-971c-0284b66cb5e8', true
where not exists (select 1 from public.tasks where family_id='cca31751-9ecf-4923-a519-169f8740773e' and title='外教课全勤王');
insert into public.tasks (family_id, member_id, title, description, category, icon, reward_coins, repeat_days, status, created_by, is_default)
select 'cca31751-9ecf-4923-a519-169f8740773e', null, '大考A+战神', '', 'super', '🎯', 500, null, 'draft', '63cdc08f-cdf9-4a3f-971c-0284b66cb5e8', false
where not exists (select 1 from public.tasks where family_id='cca31751-9ecf-4923-a519-169f8740773e' and title='大考A+战神');
insert into public.tasks (family_id, member_id, title, description, category, icon, reward_coins, repeat_days, status, created_by, is_default)
select 'cca31751-9ecf-4923-a519-169f8740773e', null, '大考战神A', '', 'super', '🎯', 200, null, 'draft', '63cdc08f-cdf9-4a3f-971c-0284b66cb5e8', false
where not exists (select 1 from public.tasks where family_id='cca31751-9ecf-4923-a519-169f8740773e' and title='大考战神A');
insert into public.tasks (family_id, member_id, title, description, category, icon, reward_coins, repeat_days, status, created_by, is_default)
select 'cca31751-9ecf-4923-a519-169f8740773e', null, '小三项征服者', '完成当日小三项并订正错误，要求书写工整！书写或订正潦草会被扣3颗星哦', 'daily', '🎯', 10, array[1,2,3,4,5], 'active', '63cdc08f-cdf9-4a3f-971c-0284b66cb5e8', true
where not exists (select 1 from public.tasks where family_id='cca31751-9ecf-4923-a519-169f8740773e' and title='小三项征服者');
insert into public.tasks (family_id, member_id, title, description, category, icon, reward_coins, repeat_days, status, created_by, is_default)
select 'cca31751-9ecf-4923-a519-169f8740773e', null, '小书虫', '', 'super', '🎯', 60, null, 'draft', '63cdc08f-cdf9-4a3f-971c-0284b66cb5e8', false
where not exists (select 1 from public.tasks where family_id='cca31751-9ecf-4923-a519-169f8740773e' and title='小书虫');
insert into public.tasks (family_id, member_id, title, description, category, icon, reward_coins, repeat_days, status, created_by, is_default)
select 'cca31751-9ecf-4923-a519-169f8740773e', null, '小作家汗水奖', '', 'stage', '🎯', 15, null, 'draft', '63cdc08f-cdf9-4a3f-971c-0284b66cb5e8', false
where not exists (select 1 from public.tasks where family_id='cca31751-9ecf-4923-a519-169f8740773e' and title='小作家汗水奖');
insert into public.tasks (family_id, member_id, title, description, category, icon, reward_coins, repeat_days, status, created_by, is_default)
select 'cca31751-9ecf-4923-a519-169f8740773e', null, '弹跳达人', '', 'daily', '🎯', 5, array[0,1,2,3,4,5,6], 'active', '63cdc08f-cdf9-4a3f-971c-0284b66cb5e8', false
where not exists (select 1 from public.tasks where family_id='cca31751-9ecf-4923-a519-169f8740773e' and title='弹跳达人');
insert into public.tasks (family_id, member_id, title, description, category, icon, reward_coins, repeat_days, status, created_by, is_default)
select 'cca31751-9ecf-4923-a519-169f8740773e', null, '数学作业达人', '完成作业并书写工整，书写潦草会被扣3颗星', 'daily', '🔢', 20, array[5], 'active', '63cdc08f-cdf9-4a3f-971c-0284b66cb5e8', true
where not exists (select 1 from public.tasks where family_id='cca31751-9ecf-4923-a519-169f8740773e' and title='数学作业达人');
insert into public.tasks (family_id, member_id, title, description, category, icon, reward_coins, repeat_days, status, created_by, is_default)
select 'cca31751-9ecf-4923-a519-169f8740773e', null, '数学课全勤王', '准时上课不迟到，在数学世界里闯关！', 'daily', '🧮', 20, array[0], 'active', '63cdc08f-cdf9-4a3f-971c-0284b66cb5e8', true
where not exists (select 1 from public.tasks where family_id='cca31751-9ecf-4923-a519-169f8740773e' and title='数学课全勤王');
insert into public.tasks (family_id, member_id, title, description, category, icon, reward_coins, repeat_days, status, created_by, is_default)
select 'cca31751-9ecf-4923-a519-169f8740773e', null, '日常A级学霸', '', 'super', '🎯', 50, null, 'draft', '63cdc08f-cdf9-4a3f-971c-0284b66cb5e8', false
where not exists (select 1 from public.tasks where family_id='cca31751-9ecf-4923-a519-169f8740773e' and title='日常A级学霸');
insert into public.tasks (family_id, member_id, title, description, category, icon, reward_coins, repeat_days, status, created_by, is_default)
select 'cca31751-9ecf-4923-a519-169f8740773e', null, '晨光先锋', '早上6:50准时下楼出发！下楼前已经刷好牙、洗好脸、穿好衣服（上学日穿校服戴红领巾，周末穿自己搭配的帅气OOTD）', 'daily', '🌅', 5, array[0,1,2,3,4,5], 'active', '63cdc08f-cdf9-4a3f-971c-0284b66cb5e8', true
where not exists (select 1 from public.tasks where family_id='cca31751-9ecf-4923-a519-169f8740773e' and title='晨光先锋');
insert into public.tasks (family_id, member_id, title, description, category, icon, reward_coins, repeat_days, status, created_by, is_default)
select 'cca31751-9ecf-4923-a519-169f8740773e', null, '每日小书虫', '', 'daily', '🎯', 8, array[0,1,2,3,4,5,6], 'active', '63cdc08f-cdf9-4a3f-971c-0284b66cb5e8', false
where not exists (select 1 from public.tasks where family_id='cca31751-9ecf-4923-a519-169f8740773e' and title='每日小书虫');
insert into public.tasks (family_id, member_id, title, description, category, icon, reward_coins, repeat_days, status, created_by, is_default)
select 'cca31751-9ecf-4923-a519-169f8740773e', null, '约定超时挑战', '', 'black', '⚠️', -20, null, 'draft', '63cdc08f-cdf9-4a3f-971c-0284b66cb5e8', false
where not exists (select 1 from public.tasks where family_id='cca31751-9ecf-4923-a519-169f8740773e' and title='约定超时挑战');
insert into public.tasks (family_id, member_id, title, description, category, icon, reward_coins, repeat_days, status, created_by, is_default)
select 'cca31751-9ecf-4923-a519-169f8740773e', null, '能量蛋摄取', '早餐吃掉一颗鸡蛋，为一天的冒险补充蛋白质能量！', 'daily', '🥚', 8, array[0,1,2,3,4,5], 'active', '63cdc08f-cdf9-4a3f-971c-0284b66cb5e8', true
where not exists (select 1 from public.tasks where family_id='cca31751-9ecf-4923-a519-169f8740773e' and title='能量蛋摄取');
insert into public.tasks (family_id, member_id, title, description, category, icon, reward_coins, repeat_days, status, created_by, is_default)
select 'cca31751-9ecf-4923-a519-169f8740773e', null, '英语默写挑战者', '完成家默本默写并认真订正错误', 'daily', '📖', 5, array[1,2,3,4,5], 'active', '63cdc08f-cdf9-4a3f-971c-0284b66cb5e8', true
where not exists (select 1 from public.tasks where family_id='cca31751-9ecf-4923-a519-169f8740773e' and title='英语默写挑战者');
insert into public.tasks (family_id, member_id, title, description, category, icon, reward_coins, repeat_days, status, created_by, is_default)
select 'cca31751-9ecf-4923-a519-169f8740773e', null, '装备整理师', '睡前整理好书包，明天的装备一应俱全！', 'daily', '🎒', 2, array[0,1,2,3,4], 'active', '63cdc08f-cdf9-4a3f-971c-0284b66cb5e8', true
where not exists (select 1 from public.tasks where family_id='cca31751-9ecf-4923-a519-169f8740773e' and title='装备整理师');
insert into public.tasks (family_id, member_id, title, description, category, icon, reward_coins, repeat_days, status, created_by, is_default)
select 'cca31751-9ecf-4923-a519-169f8740773e', null, '试卷学霸', '小三项试卷及校内单元阶段测试成绩90分以上（只计算红版）', 'super', '📄', 15, null, 'draft', '63cdc08f-cdf9-4a3f-971c-0284b66cb5e8', true
where not exists (select 1 from public.tasks where family_id='cca31751-9ecf-4923-a519-169f8740773e' and title='试卷学霸');
insert into public.tasks (family_id, member_id, title, description, category, icon, reward_coins, repeat_days, status, created_by, is_default)
select 'cca31751-9ecf-4923-a519-169f8740773e', null, '足球小将', '准时上课不迟到，在球场上奔跑挥洒汗水！', 'daily', '⚽', 5, array[0], 'active', '63cdc08f-cdf9-4a3f-971c-0284b66cb5e8', true
where not exists (select 1 from public.tasks where family_id='cca31751-9ecf-4923-a519-169f8740773e' and title='足球小将');
insert into public.tasks (family_id, member_id, title, description, category, icon, reward_coins, repeat_days, status, created_by, is_default)
select 'cca31751-9ecf-4923-a519-169f8740773e', null, '足球训练狂魔', '', 'daily', '🎯', 5, array[0,1,2,3,4,5,6], 'active', '63cdc08f-cdf9-4a3f-971c-0284b66cb5e8', false
where not exists (select 1 from public.tasks where family_id='cca31751-9ecf-4923-a519-169f8740773e' and title='足球训练狂魔');
insert into public.tasks (family_id, member_id, title, description, category, icon, reward_coins, repeat_days, status, created_by, is_default)
select 'cca31751-9ecf-4923-a519-169f8740773e', null, '运动健将', '进行羽毛球/皮克球/网球/游泳等户外运动（居家运动不算哦）', 'daily', '🏃', 2, array[0], 'active', '63cdc08f-cdf9-4a3f-971c-0284b66cb5e8', true
where not exists (select 1 from public.tasks where family_id='cca31751-9ecf-4923-a519-169f8740773e' and title='运动健将');
insert into public.tasks (family_id, member_id, title, description, category, icon, reward_coins, repeat_days, status, created_by, is_default)
select 'cca31751-9ecf-4923-a519-169f8740773e', null, '长高高', '', 'daily', '🎯', 2, array[0,1,2,3,4,5,6], 'active', '63cdc08f-cdf9-4a3f-971c-0284b66cb5e8', false
where not exists (select 1 from public.tasks where family_id='cca31751-9ecf-4923-a519-169f8740773e' and title='长高高');
insert into public.tasks (family_id, member_id, title, description, category, icon, reward_coins, repeat_days, status, created_by, is_default)
select 'cca31751-9ecf-4923-a519-169f8740773e', null, '长高高组合', '', 'daily', '🎯', 2, array[0,1,2,3,4,5,6], 'active', '63cdc08f-cdf9-4a3f-971c-0284b66cb5e8', false
where not exists (select 1 from public.tasks where family_id='cca31751-9ecf-4923-a519-169f8740773e' and title='长高高组合');
insert into public.tasks (family_id, member_id, title, description, category, icon, reward_coins, repeat_days, status, created_by, is_default)
select 'cca31751-9ecf-4923-a519-169f8740773e', null, '长高高营养', '', 'daily', '🎯', 2, array[0,1,2,3,4,5,6], 'active', '63cdc08f-cdf9-4a3f-971c-0284b66cb5e8', false
where not exists (select 1 from public.tasks where family_id='cca31751-9ecf-4923-a519-169f8740773e' and title='长高高营养');
insert into public.tasks (family_id, member_id, title, description, category, icon, reward_coins, repeat_days, status, created_by, is_default)
select 'cca31751-9ecf-4923-a519-169f8740773e', null, '阅读探险家', '每天阅读15分钟（老师指定书目），在书的世界里探险！', 'daily', '📚', 8, array[0,1,2,3,4,5], 'active', '63cdc08f-cdf9-4a3f-971c-0284b66cb5e8', true
where not exists (select 1 from public.tasks where family_id='cca31751-9ecf-4923-a519-169f8740773e' and title='阅读探险家');
insert into public.tasks (family_id, member_id, title, description, category, icon, reward_coins, repeat_days, status, created_by, is_default)
select 'cca31751-9ecf-4923-a519-169f8740773e', null, '阅读理解大师', '听完一节网课并完成学习册笔记填空', 'daily', '🧠', 10, array[0,5], 'active', '63cdc08f-cdf9-4a3f-971c-0284b66cb5e8', true
where not exists (select 1 from public.tasks where family_id='cca31751-9ecf-4923-a519-169f8740773e' and title='阅读理解大师');
insert into public.tasks (family_id, member_id, title, description, category, icon, reward_coins, repeat_days, status, created_by, is_default)
select 'cca31751-9ecf-4923-a519-169f8740773e', null, '饭前冲刺达人', '晚饭前完成校内作业和复习任务，晚上时间自己掌控！', 'daily', '⚡', 5, array[0,1,2,3,4,5], 'active', '63cdc08f-cdf9-4a3f-971c-0284b66cb5e8', true
where not exists (select 1 from public.tasks where family_id='cca31751-9ecf-4923-a519-169f8740773e' and title='饭前冲刺达人');
insert into public.tasks (family_id, member_id, title, description, category, icon, reward_coins, repeat_days, status, created_by, is_default)
select 'cca31751-9ecf-4923-a519-169f8740773e', null, '默写大师', '校内英语或语文0号本默写全部正确，校内本子获得老师的🌟奖励！', 'daily', '✍️', 5, array[1,2,3,4,5], 'active', '63cdc08f-cdf9-4a3f-971c-0284b66cb5e8', true
where not exists (select 1 from public.tasks where family_id='cca31751-9ecf-4923-a519-169f8740773e' and title='默写大师');
