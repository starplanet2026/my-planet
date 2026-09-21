-- ============================================================
-- 0064: 默认成就清单任务
-- 1. tasks 表加 is_default 字段（标记默认任务，不可删除）
-- 2. 创建 seed_default_tasks RPC：批量导入成就清单
-- ============================================================

-- 1. tasks 表加 is_default + sort_order（如果 0022 未执行则补上）
alter table public.tasks add column if not exists sort_order int not null default 0;
alter table public.tasks add column if not exists is_default boolean not null default false;

-- 2. 默认任务模板（jsonb 数组）
-- category: daily=每日成就, stage=里程碑成就, super=高光时刻, black=成长挑战
-- repeat_days: 0=周日, 1=周一, 2=周二, 3=周三, 4=周四, 5=周五, 6=周六
-- reward_coins: 星光值（成长挑战为负数=扣星）

-- 3. seed_default_tasks RPC
create or replace function public.seed_default_tasks(
  p_family_id uuid,
  p_created_by uuid
)
returns table(success boolean, message text, inserted_count int)
language plpgsql security definer as $$
declare
  v_tasks jsonb := $js$
  [
    {"title":"晨光先锋","description":"早上6:50准时下楼出发！下楼前已经刷好牙、洗好脸、穿好衣服（上学日穿校服戴红领巾，周末穿自己搭配的帅气OOTD）","category":"daily","icon":"🌅","reward_coins":5,"repeat_days":[0,1,2,3,4,5]},
    {"title":"光盘行动家","description":"把盘子里的早餐全部消灭干净，一点不剩！","category":"daily","icon":"🍽️","reward_coins":8,"repeat_days":[0,1,2,3,4,5]},
    {"title":"能量蛋摄取","description":"早餐吃掉一颗鸡蛋，为一天的冒险补充蛋白质能量！","category":"daily","icon":"🥚","reward_coins":8,"repeat_days":[0,1,2,3,4,5]},
    {"title":"校园效率王","description":"放学前在学校搞定所有校内书面作业和小三项作业，回家就能尽情玩！","category":"daily","icon":"📝","reward_coins":5,"repeat_days":[1,2,3,4,5]},
    {"title":"默写大师","description":"校内英语或语文0号本默写全部正确，校内本子获得老师的🌟奖励！","category":"daily","icon":"✍️","reward_coins":5,"repeat_days":[1,2,3,4,5]},
    {"title":"饭前冲刺达人","description":"晚饭前完成校内作业和复习任务，晚上时间自己掌控！","category":"daily","icon":"⚡","reward_coins":5,"repeat_days":[0,1,2,3,4,5]},
    {"title":"英语默写挑战者","description":"完成家默本默写并认真订正错误","category":"daily","icon":"📖","reward_coins":5,"repeat_days":[1,2,3,4,5]},
    {"title":"小三项征服者","description":"完成当日小三项并订正错误，要求书写工整！书写或订正潦草会被扣3颗星哦","category":"daily","icon":"🎯","reward_coins":10,"repeat_days":[1,2,3,4,5]},
    {"title":"成就记录者","description":"写下今天最棒的一件事，记录自己的成长足迹","category":"daily","icon":"📓","reward_coins":8,"repeat_days":[0,1,2,3,4,5]},
    {"title":"阅读探险家","description":"每天阅读15分钟（老师指定书目），在书的世界里探险！","category":"daily","icon":"📚","reward_coins":5,"repeat_days":[0,1,2,3,4,5]},
    {"title":"装备整理师","description":"睡前整理好书包，明天的装备一应俱全！","category":"daily","icon":"🎒","reward_coins":2,"repeat_days":[0,1,2,3,4]},
    {"title":"外教课全勤王","description":"准时上课不迟到，和外教老师快乐学英语！","category":"daily","icon":"👨‍🏫","reward_coins":5,"repeat_days":[6]},
    {"title":"外教作业达人","description":"完成作业并书写工整，书写潦草会被扣3颗星","category":"daily","icon":"📋","reward_coins":5,"repeat_days":[5]},
    {"title":"数学课全勤王","description":"准时上课不迟到，在数学世界里闯关！","category":"daily","icon":"🧮","reward_coins":5,"repeat_days":[0]},
    {"title":"数学作业达人","description":"完成作业并书写工整，书写潦草会被扣3颗星","category":"daily","icon":"🔢","reward_coins":5,"repeat_days":[5]},
    {"title":"写字课全勤王","description":"准时上课不迟到，练出一手好字！","category":"daily","icon":"✏️","reward_coins":5,"repeat_days":[0]},
    {"title":"足球小将","description":"准时上课不迟到，在球场上奔跑挥洒汗水！","category":"daily","icon":"⚽","reward_coins":5,"repeat_days":[0]},
    {"title":"运动健将","description":"进行羽毛球/皮克球/网球/游泳等户外运动（居家运动不算哦）","category":"daily","icon":"🏃","reward_coins":2,"repeat_days":[0]},
    {"title":"阅读理解大师","description":"听完一节网课并完成学习册笔记填空","category":"daily","icon":"🧠","reward_coins":10,"repeat_days":[0,5]},
    {"title":"民间故事探索者","description":"完成《中国民间故事》整本书阅读（50星）+ 发表读后感（10星）","category":"stage","icon":"📖","reward_coins":60,"repeat_days":null},
    {"title":"冠军队长","description":"带领自己的球队在比赛中获奖！","category":"stage","icon":"🏆","reward_coins":100,"repeat_days":null},
    {"title":"作文小作家","description":"作文获得A+评级，文字功底超厉害！","category":"stage","icon":"✍️","reward_coins":50,"repeat_days":null},
    {"title":"小小厨师","description":"和家人一起做一道真正的菜（泡面可不算哦！）","category":"stage","icon":"👨‍🍳","reward_coins":20,"repeat_days":null},
    {"title":"试卷学霸","description":"小三项试卷及校内单元阶段测试成绩90分以上（只计算红版）","category":"super","icon":"📄","reward_coins":15,"repeat_days":null},
    {"title":"期末战神","description":"数学/英语期中期末成绩90分以上","category":"super","icon":"🎖️","reward_coins":50,"repeat_days":null},
    {"title":"语文达人","description":"语文期中期末成绩85分以上","category":"super","icon":"📜","reward_coins":50,"repeat_days":null},
    {"title":"物品失踪事件","description":"手表、书包等物品到家时未随身携带就算丢失。可以自己找到后拍照上传申诉，追回损失。别人帮忙找到的申诉不会通过哦。","category":"black","icon":"🔍","reward_coins":-50,"repeat_days":null},
    {"title":"约定破防","description":"与家人约定的到家时间、上课安排等未遵守。","category":"black","icon":"⚠️","reward_coins":-20,"repeat_days":null},
    {"title":"迟到警报","description":"上学超过7:40出门算迟到，课外班到教室门口时间算迟到。","category":"black","icon":"⏰","reward_coins":-20,"repeat_days":null},
    {"title":"学校缺席","description":"不去学校。可以在两节课内到达学校申诉，追回损失。","category":"black","icon":"🏫","reward_coins":-100,"repeat_days":null},
    {"title":"课外班缺席","description":"未上课外班。可以通过加课申诉，追回损失。","category":"black","icon":"📕","reward_coins":-30,"repeat_days":null}
  ]
  $js$;
  v_task jsonb;
  v_count int := 0;
  v_existing int;
begin
  -- 检查是否已经导入过
  select count(*) into v_existing from public.tasks
  where family_id = p_family_id and is_default = true;
  if v_existing > 0 then
    return query select false, '该家庭已导入过默认任务（' || v_existing || '条），不可重复导入', v_existing;
    return;
  end if;

  for v_task in select * from jsonb_array_elements(v_tasks) loop
    insert into public.tasks (
      family_id, member_id, title, description, category, icon,
      reward_coins, repeat_days, status, created_by, sort_order, is_default
    ) values (
      p_family_id,
      null,
      v_task->>'title',
      v_task->>'description',
      v_task->>'category',
      v_task->>'icon',
      (v_task->>'reward_coins')::int,
      nullif(v_task->'repeat_days', 'null'::jsonb),
      'draft',
      p_created_by,
      v_count + 1,
      true
    );
    v_count := v_count + 1;
  end loop;

  return query select true, '成功导入' || v_count || '条默认任务', v_count;
end;
$$;

grant execute on function public.seed_default_tasks(uuid, uuid) to anon, authenticated;
