-- 0067: 萌宠星球数据层重构
-- 1. pets / pet_shop_items 新增 trait（天生特质）字段
-- 2. 按 Excel 更新 36 只宠物的 price_star、trait
-- 3. 按稀有度对齐 base_coin_per_day / max_level / upgrade_percent
--    普通: 日产金1, 满级10, 每级+0.1; 稀有: 日产金2, 满级20, 每级+0.2; 史诗: 日产金5, 满级25, 每级+0.5
-- 4. 重写 exp_needed(level, rarity) 按升级经验值.xlsx 查表

-- ============================================================
-- 一、新增 trait 字段
-- ============================================================
alter table public.pet_shop_items add column if not exists trait text;
alter table public.pets add column if not exists trait text;

-- ============================================================
-- 二、按稀有度设置基础属性（pet_shop_items）
--    普通: max_level=10, base_coin_per_day=1, upgrade_percent=10
--    稀有: max_level=20, base_coin_per_day=2, upgrade_percent=10
--    史诗: max_level=25, base_coin_per_day=5, upgrade_percent=10
-- ============================================================
update public.pet_shop_items set
  max_level = 10, base_coin_per_day = 1, upgrade_percent = 10.0, upgrade_coin_reward = 0
  where type = 'pet' and rarity = 'common';

update public.pet_shop_items set
  max_level = 20, base_coin_per_day = 2, upgrade_percent = 10.0, upgrade_coin_reward = 0
  where type = 'pet' and rarity = 'rare';

update public.pet_shop_items set
  max_level = 25, base_coin_per_day = 5, upgrade_percent = 10.0, upgrade_coin_reward = 0
  where type = 'pet' and rarity = 'epic';

-- 已有宠物同步 max_level / base_coin_per_day / upgrade_percent
update public.pets set
  max_level = 10, base_coin_per_day = 1, upgrade_percent = 10.0, upgrade_coin_reward = 0
  where rarity = 'common';

update public.pets set
  max_level = 20, base_coin_per_day = 2, upgrade_percent = 10.0, upgrade_coin_reward = 0
  where rarity = 'rare';

update public.pets set
  max_level = 25, base_coin_per_day = 5, upgrade_percent = 10.0, upgrade_coin_reward = 0
  where rarity = 'epic';

-- ============================================================
-- 三、按 Excel 更新 36 只宠物的 price_star 和 trait
-- ============================================================
update public.pet_shop_items set price_star = 120, trait = '大胃好养'  where type = 'pet' and breed = '拉布拉多';
update public.pet_shop_items set price_star = 87,  trait = '胃口消耗快' where type = 'pet' and breed = '哈士奇';
update public.pet_shop_items set price_star = 81,  trait = '娇弱易感'   where type = 'pet' and breed = '泰迪';
update public.pet_shop_items set price_star = 195, trait = '平平无奇'   where type = 'pet' and breed = '阿拉斯加';
update public.pet_shop_items set price_star = 191, trait = '平平无奇'   where type = 'pet' and breed = '西施犬';
update public.pet_shop_items set price_star = 188, trait = '平平无奇'   where type = 'pet' and breed = '斑点狗';
update public.pet_shop_items set price_star = 88,  trait = '容易脏'     where type = 'pet' and breed = '约克夏';
update public.pet_shop_items set price_star = 86,  trait = '容易脏'     where type = 'pet' and breed = '西高地白梗';
update public.pet_shop_items set price_star = 114, trait = '体质强健'   where type = 'pet' and breed = '中华田园犬';
update public.pet_shop_items set price_star = 171, trait = '容易脏'     where type = 'pet' and breed = '杰克罗素梗';
update public.pet_shop_items set price_star = 117, trait = '体质强健'   where type = 'pet' and breed = '博美';
update public.pet_shop_items set price_star = 508, trait = '平平无奇'   where type = 'pet' and breed = '罗威纳';
update public.pet_shop_items set price_star = 408, trait = '平平无奇'   where type = 'pet' and breed = '圣伯纳';
update public.pet_shop_items set price_star = 81,  trait = '胃口消耗快' where type = 'pet' and breed = '哈士奇2';
update public.pet_shop_items set price_star = 171, trait = '胃口消耗快' where type = 'pet' and breed = '银狐犬';
update public.pet_shop_items set price_star = 93,  trait = '平平无奇'   where type = 'pet' and breed = '比格犬';
update public.pet_shop_items set price_star = 94,  trait = '平平无奇'   where type = 'pet' and breed = '金毛';
update public.pet_shop_items set price_star = 529, trait = '平平无奇'   where type = 'pet' and breed = '澳牧';
update public.pet_shop_items set price_star = 237, trait = '体质强健'   where type = 'pet' and breed = '西施犬2';
update public.pet_shop_items set price_star = 406, trait = '胃口消耗快' where type = 'pet' and breed = '伯恩山犬';
update public.pet_shop_items set price_star = 231, trait = '体质强健'   where type = 'pet' and breed = '喜乐蒂';
update public.pet_shop_items set price_star = 92,  trait = '平平无奇'   where type = 'pet' and breed = '可卡布犬';
update public.pet_shop_items set price_star = 114, trait = '乐天派'     where type = 'pet' and breed = '比格犬2';
update public.pet_shop_items set price_star = 106, trait = '平平无奇'   where type = 'pet' and breed = '柴犬';
update public.pet_shop_items set price_star = 188, trait = '平平无奇'   where type = 'pet' and breed = '马尔济斯';
update public.pet_shop_items set price_star = 108, trait = '体质强健'   where type = 'pet' and breed = '法斗';
update public.pet_shop_items set price_star = 235, trait = '乐天派'     where type = 'pet' and breed = '德国牧羊犬';
update public.pet_shop_items set price_star = 97,  trait = '平平无奇'   where type = 'pet' and breed = '可卡布犬2';
update public.pet_shop_items set price_star = 80,  trait = '容易脏'     where type = 'pet' and breed = '雪纳瑞';
update public.pet_shop_items set price_star = 594, trait = '大胃好养'   where type = 'pet' and breed = '伯恩山犬2';
update public.pet_shop_items set price_star = 90,  trait = '平平无奇'   where type = 'pet' and breed = '萨摩耶';
update public.pet_shop_items set price_star = 107, trait = '大胃好养'   where type = 'pet' and breed = '柴犬2';
update public.pet_shop_items set price_star = 203, trait = '平平无奇'   where type = 'pet' and breed = '巴吉度';
update public.pet_shop_items set price_star = 97,  trait = '平平无奇'   where type = 'pet' and breed = '哈士奇3';
update public.pet_shop_items set price_star = 179, trait = '胃口消耗快' where type = 'pet' and breed = '史宾格';
update public.pet_shop_items set price_star = 93,  trait = '平平无奇'   where type = 'pet' and breed = '金毛2';

-- 已有宠物同步 trait（从 shop_item 继承）
update public.pets p set trait = i.trait
  from public.pet_shop_items i
  where p.shop_item_id = i.id and p.trait is null;

-- ============================================================
-- 四、重写 exp_needed(level, rarity)：按升级经验值.xlsx 查表
-- ============================================================
drop function if exists public.exp_needed(int);
drop function if exists public.exp_needed(int, text);

create function public.exp_needed(p_level int, p_rarity text)
returns int
language sql immutable
as $$
  select case
    -- 普通（满级10）
    when p_rarity = 'common' then case p_level
      when 1 then 20
      when 2 then 40
      when 3 then 60
      when 4 then 80
      when 5 then 100
      when 6 then 140
      when 7 then 170
      when 8 then 190
      when 9 then 220
      else 999999
    end
    -- 稀有（满级20）
    when p_rarity = 'rare' then case p_level
      when 1 then 20
      when 2 then 40
      when 3 then 60
      when 4 then 80
      when 5 then 100
      when 6 then 120
      when 7 then 140
      when 8 then 160
      when 9 then 180
      when 10 then 200
      when 11 then 310
      when 12 then 340
      when 13 then 360
      when 14 then 390
      when 15 then 420
      when 16 then 450
      when 17 then 480
      when 18 then 500
      when 19 then 530
      else 999999
    end
    -- 史诗（满级25）
    when p_rarity = 'epic' then case p_level
      when 1 then 20
      when 2 then 40
      when 3 then 60
      when 4 then 80
      when 5 then 100
      when 6 then 120
      when 7 then 140
      when 8 then 160
      when 9 then 180
      when 10 then 200
      when 11 then 310
      when 12 then 340
      when 13 then 360
      when 14 then 390
      when 15 then 420
      when 16 then 450
      when 17 then 480
      when 18 then 500
      when 19 then 530
      when 20 then 560
      when 21 then 590
      when 22 then 620
      when 23 then 640
      when 24 then 670
      else 999999
    end
    else 999999
  end;
$$;

grant execute on function public.exp_needed(int, text) to anon, authenticated;
