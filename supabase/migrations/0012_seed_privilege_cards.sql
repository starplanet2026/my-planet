-- ============================================================
-- 批量上架特权卡（13张）
-- 执行前无需修改，会自动找到你的 family_id
-- ============================================================

-- 找到第一个家庭和该家庭的家长
do $$
declare
  v_family_id uuid;
  v_parent_id uuid;
begin
  select id into v_family_id from public.families order by created_at limit 1;
  if v_family_id is null then raise exception '未找到家庭，请先注册'; end if;

  select id into v_parent_id from public.members
    where family_id = v_family_id and role = 'parent' order by created_at limit 1;
  if v_parent_id is null then raise exception '未找到家长成员'; end if;

  -- 1. 零花钱提现
  insert into public.items (family_id, name, description, price, weekly_limit, status, created_by)
  values (v_family_id, '零花钱提现', '1金币兑换1元现金，直接变成你的零花钱！每月最多兑换200元。', 1, 200, 'active', v_parent_id);

  -- 2. 快餐自由卡
  insert into public.items (family_id, name, description, price, weekly_limit, status, created_by)
  values (v_family_id, '快餐自由卡',
    '小提示：快餐虽然香，但吃多了会长胖不长高，一周最多吃一次就好啦～
凭此卡可在肯德基/麦当劳/汉堡王/必胜客等快餐店享用一次（堂食或外卖都行）。
卡内含70元额度，超出部分自己买单。
一周限用一张。',
    50, 1, 'active', v_parent_id);

  -- 3. 快乐水兑换券
  insert into public.items (family_id, name, description, price, weekly_limit, status, created_by)
  values (v_family_id, '快乐水兑换券',
    '小提示：饮料甜甜的但糖很多，喝多了会长胖不长高，一周最多喝2次哦～
凭此卡可换一杯奶茶（喜茶/CoCo等）或一瓶果味饮料（果茶、冰红茶等）。
卡内含20元额度，超出部分自己买单。
一周限用2张。',
    15, 2, 'active', v_parent_id);

  -- 4. 深夜食堂通行证
  insert into public.items (family_id, name, description, price, weekly_limit, status, created_by)
  values (v_family_id, '深夜食堂通行证',
    '小提示：晚上吃夜宵胃同学会加班，睡不好还影响第二天吃早饭哦～
凭此卡可以在正当情境吃一次夜宵！',
    10, 1, 'active', v_parent_id);

  -- 5. 任务跳过卡
  insert into public.items (family_id, name, description, price, weekly_limit, status, created_by)
  values (v_family_id, '任务跳过卡', '凭此卡可免除当天一项学习任务！仅限小三项和家务哦。', 5, null, 'active', v_parent_id);

  -- 6. 默写豁免金牌
  insert into public.items (family_id, name, description, price, weekly_limit, status, created_by)
  values (v_family_id, '默写豁免金牌', '凭此卡当天不用做默写！语文、英语都可以用。', 5, null, 'active', v_parent_id);

  -- 7. 摸鱼卡
  insert into public.items (family_id, name, description, price, weekly_limit, status, created_by)
  values (v_family_id, '摸鱼卡', '学习时间偷偷休息10分钟！可以叠加使用。', 5, null, 'active', v_parent_id);

  -- 8. 商场放风卡
  insert into public.items (family_id, name, description, price, weekly_limit, status, created_by)
  values (v_family_id, '商场放风卡',
    '学习时段也能去逛逛街啦！比如周中放学后、周日约定的学习时间。
卡里含50元购物额度，超出部分自己买单。
周六周日和爸妈一起吃饭逛街的时间无需用这张卡哦。
一周限用1次。',
    50, 1, 'active', v_parent_id);

  -- 9. 游乐场狂欢卡
  insert into public.items (family_id, name, description, price, weekly_limit, status, created_by)
  values (v_family_id, '游乐场狂欢卡',
    '学习时段也能去游乐场撒欢！比如周中放学后、周日约定的学习时间。
卡里含100元额度，超出部分自己买单。',
    100, 1, 'active', v_parent_id);

  -- 10. 游戏续命卡
  insert into public.items (family_id, name, description, price, weekly_limit, status, created_by)
  values (v_family_id, '游戏续命卡',
    '每周电子游戏时间上限90分钟。
凭此卡可额外增加30分钟游戏时间！
一周限用一张。',
    20, 1, 'active', v_parent_id);

  -- 11. 电视续命卡
  insert into public.items (family_id, name, description, price, weekly_limit, status, created_by)
  values (v_family_id, '电视续命卡',
    '每周电视时间上限90分钟。
凭此卡可额外增加30分钟看电视时间！
一周限用一张。',
    20, 1, 'active', v_parent_id);

  -- 12. 学习机加时卡
  insert into public.items (family_id, name, description, price, weekly_limit, status, created_by)
  values (v_family_id, '学习机加时卡',
    '平时学习机单次限用15分钟。
凭此卡当天单次使用时间可延长到25分钟！',
    10, null, 'active', v_parent_id);

  -- 13. 裸眼体验卡
  insert into public.items (family_id, name, description, price, weekly_limit, status, created_by)
  values (v_family_id, '裸眼体验卡',
    '小提示：用电子产品对眼睛不太好，平时还是要戴好眼镜哦～
凭此卡可以体验5分钟不戴眼镜玩电子游戏！
可以多张叠加使用。',
    5, null, 'active', v_parent_id);

  raise notice '13 张特权卡已全部上架到家庭 %', v_family_id;
end;
$$;
