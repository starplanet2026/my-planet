-- 0205: gacha_start 返回 drawn_item_trait_id
-- 抽卡成功后前端需要拿到所抽宠物的特质 ID，用于领养时绑定到 pets.trait_id
-- 返回表新增 drawn_item_trait_id uuid，SELECT 时带出 psi.trait_id

drop function if exists public.gacha_start(uuid);
create function public.gacha_start(p_member_id uuid)
returns table(
  success boolean,
  message text,
  drawn_item_id uuid,
  drawn_item_name text,
  drawn_item_emoji text,
  drawn_item_image text,
  drawn_item_rarity text,
  drawn_item_coin_per_day numeric,
  drawn_item_trait_id uuid,
  remaining_star int
)
language plpgsql security definer as $$
declare
  v_member record;
  v_cfg public.gacha_config%rowtype;
  v_picked record;
begin
  select * into v_member from public.members where id = p_member_id for update;
  if not found then
    return query select false, '用户不存在', null::uuid, null::text, null::text, null::text, null::text, null::numeric, null::uuid, 0;
    return;
  end if;

  select * into v_cfg from public.gacha_config where id = 1;

  if v_member.star_value < v_cfg.adopt_cost then
    return query select false, '星光值不足，需要'||v_cfg.adopt_cost||'星光值才能抽卡',
      null::uuid, null::text, null::text, null::text, null::text, null::numeric, null::uuid, v_member.star_value;
    return;
  end if;

  select psi.id, psi.name, psi.emoji, psi.image_url, psi.rarity, psi.base_coin_per_day, psi.trait_id into v_picked
  from public.pet_shop_items psi
  cross join lateral (
    select case psi.rarity
      when 'common' then v_cfg.rarity_common_prob
      when 'rare'   then v_cfg.rarity_rare_prob
      when 'epic'   then v_cfg.rarity_epic_prob
      else v_cfg.rarity_common_prob
    end as weight
  ) w
  where psi.type = 'pet'
    and psi.status = 'active'
    and psi.price_star > 0
    and w.weight > 0
    and psi.id not in (
      select coalesce(shop_item_id, '00000000-0000-0000-0000-000000000000'::uuid)
      from public.pets where member_id = p_member_id
    )
  order by -log(random()) / w.weight
  limit 1;

  if v_picked.id is null then
    return query select false, '暂无可抽的宠物（已全部拥有或概率为0）',
      null::uuid, null::text, null::text, null::text, null::text, null::numeric, null::uuid, v_member.star_value;
    return;
  end if;

  return query select true, '抽卡成功',
    v_picked.id, v_picked.name, v_picked.emoji, v_picked.image_url, v_picked.rarity,
    v_picked.base_coin_per_day, v_picked.trait_id, v_member.star_value;
end;
$$;
grant execute on function public.gacha_start(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
