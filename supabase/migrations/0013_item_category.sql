-- ============================================================
-- 0013: 特权卡分类 + 新增3张卡
-- ============================================================

-- 1. items 表加 category 列
alter table public.items add column if not exists category text;

-- 2. 更新已有卡的分类
update public.items set category = '美食' where name in ('快餐自由卡', '快乐水兑换券', '深夜食堂通行证');
update public.items set category = '放松' where name in ('任务跳过卡', '默写豁免金牌', '摸鱼卡', '裸眼体验卡', '社交放松券', '我的半天我做主', '不该学习日');
update public.items set category = '玩乐' where name in ('商场放风卡', '游乐场狂欢卡', '游戏续命卡', '电视续命卡', '学习机加时卡');

-- 3. 新增3张卡（如果不存在）
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

  -- 14. 社交放松券
  insert into public.items (family_id, name, description, price, weekly_limit, status, created_by, category)
  select v_family_id, '社交放松券', '学习时间好友来邀约？实在扛不住就用券吧。可以叠加使用。', 20, null, 'active', v_parent_id, '放松'
  where not exists (select 1 from public.items where family_id = v_family_id and name = '社交放松券');

  -- 15. 我的半天我做主
  insert into public.items (family_id, name, description, price, weekly_limit, status, created_by, category)
  select v_family_id, '我的半天我做主', '这半天，我做主！但前提是要和某人老师报备哦！', 25, 1, 'active', v_parent_id, '放松'
  where not exists (select 1 from public.items where family_id = v_family_id and name = '我的半天我做主');

  -- 16. 不该学习日
  insert into public.items (family_id, name, description, price, weekly_limit, status, created_by, category)
  select v_family_id, '不该学习日', '今天动力严重不足？凭此券可以免学习一天，但是必要的学习内容还是要在未来补齐哦！', 50, 1, 'active', v_parent_id, '放松'
  where not exists (select 1 from public.items where family_id = v_family_id and name = '不该学习日');

  raise notice '分类已更新，新增3张卡';
end;
$$;
