-- 0235: 回溯修正错词库 last_review_date / review_count / error_count
-- 从 dictation_quick_review_records 和 dictation_records 重新统计，补全 10-11 等遗漏的复习记录

-- ============================================================
-- 一、从 dictation_records（默写记录）回溯
-- ============================================================
do $$
begin
  if exists (select 1 from information_schema.tables where table_name = 'dictation_records') then
    -- 更新 last_review_date：取该错词最新一次默写记录的日期
    update public.dictation_error_words ew
      set last_review_date = sub.latest_date
      from (
        select member_id, answer, max(date_trunc('day', created_at)::date) as latest_date
        from public.dictation_records
        group by member_id, answer
      ) sub
      where ew.member_id = sub.member_id
        and ew.answer = sub.answer
        and (ew.last_review_date is null or sub.latest_date > ew.last_review_date);

    -- 补充 review_history：将默写记录追加到 review_history（去重）
    -- 只追加不在 history 中的记录（按 date+correct 去重）
    update public.dictation_error_words ew
      set review_history = case
        when ew.review_history is null or jsonb_array_length(ew.review_history) = 0 then
          sub.history
        else
          ew.review_history || sub.history
      end
      from (
        select member_id, answer,
          jsonb_agg(
        distinct
        jsonb_build_object(
          'date', date_trunc('day', created_at)::date::text,
          'correct', is_correct,
          'action', case when is_correct then 'advance' else 'reset' end
        )
        order by date_trunc('day', created_at)::date::text
      ) as history
        from public.dictation_records
        group by member_id, answer
      ) sub
      where ew.member_id = sub.member_id and ew.answer = sub.answer;
  end if;
end $$;

-- ============================================================
-- 二、从 dictation_quick_review_records（快速复习记录）回溯
-- ============================================================
do $$
begin
  if exists (select 1 from information_schema.tables where table_name = 'dictation_quick_review_records') then
    -- 更新 last_review_date
    update public.dictation_error_words ew
      set last_review_date = sub.latest_date
      from (
        select member_id, answer, max(date_trunc('day', created_at)::date) as latest_date
        from public.dictation_quick_review_records
        group by member_id, answer
      ) sub
      where ew.member_id = sub.member_id
        and ew.answer = sub.answer
        and (ew.last_review_date is null or sub.latest_date > ew.last_review_date);

    -- 补充 review_history
    update public.dictation_error_words ew
      set review_history = case
        when ew.review_history is null or jsonb_array_length(ew.review_history) = 0 then
          sub.history
        else
          ew.review_history || sub.history
      end
      from (
        select member_id, answer,
          jsonb_agg(
        distinct
        jsonb_build_object(
          'date', date_trunc('day', created_at)::date::text,
          'correct', is_correct,
          'action', case when is_correct then 'advance' else 'reset' end
        )
        order by date_trunc('day', created_at)::date::text
      ) as history
        from public.dictation_quick_review_records
        group by member_id, answer
      ) sub
      where ew.member_id = sub.member_id and ew.answer = sub.answer;
  end if;
end $$;

-- ============================================================
-- 三、重新统计 review_count / error_count
--    统计来源：review_history（已包含默写+快速复习的全部记录）
-- ============================================================
update public.dictation_error_words ew
  set review_count = coalesce(
    (select count(*) from jsonb_array_elements(ew.review_history) where true),
    0
  ),
  error_count = coalesce(
    (select count(*) from jsonb_array_elements(ew.review_history) elem
     where (elem->>'correct')::boolean = false),
    0
  )
  where jsonb_typeof(ew.review_history) = 'array' and jsonb_array_length(ew.review_history) > 0;

-- ============================================================
-- 四、重算 current_node 和 next_review_date（基于补全后的 review_history）
--    新规则：答错→1，答对→下一节点(1→2→4→7→15→completed)
--    next_review_date = last_review_date + current_node
-- ============================================================
do $$
declare
  v_rec record;
  v_item jsonb;
  v_node int;
  v_next_node int;
  v_last_correct boolean := false;
  v_last_date text;
  v_today date := current_date;
  v_next_date date;
  v_status text;
begin
  for v_rec in select id, review_history, last_review_date from public.dictation_error_words where status = 'in_progress'
  loop
    v_node := 1;
    v_last_correct := false;
    v_last_date := null;

    for v_item in select * from jsonb_array_elements(v_rec.review_history)
    loop
      if (v_item->>'correct')::boolean then
        v_next_node := case v_node
          when 1 then 2 when 2 then 4 when 4 then 7 when 7 then 15
          else 15
        end;
        v_node := v_next_node;
        v_last_correct := true;
      else
        v_node := 1;
        v_last_correct := false;
      end if;
      v_last_date := v_item->>'date';
    end loop;

    if v_node = 15 and v_last_correct then
      v_status := 'completed';
      v_next_date := v_today;
    else
      v_status := 'in_progress';
      if v_rec.last_review_date is not null then
        v_next_date := v_rec.last_review_date + v_node;
      else
        v_next_date := v_today + v_node;
      end if;
    end if;

    update public.dictation_error_words
      set current_node = v_node,
          next_review_date = v_next_date,
          status = v_status
      where id = v_rec.id;
  end loop;
end $$;

notify pgrst, 'reload schema';
