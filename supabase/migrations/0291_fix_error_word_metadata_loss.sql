-- 0291: 修复进入错词库的词条丢失中文/拼音
-- 根因：
--   1. submit_dictation_result 只用 payload 的 word_id 去 dictation_words 取元数据，
--      自定义词条/整句没有 word_id 时中文与拼音全为 null；
--      且命中已有错词时用错词库自身的 null 值覆盖了 payload 中已带的中文/拼音。
--   2. save_quick_review_record 新建错词时把 chinese_meaning / part_of_speech / pinyin 写死为 null。
-- 修复：
--   1. 两个函数在 word_id 取不到元数据时，按 (task_id, answer) 回查 dictation_task_words 补全；
--   2. 已有错词命中时只补齐空字段，不用空值覆盖；
--   3. 命中错词库但字段为空时顺带回写补齐；
--   4. 一次性回填历史上缺中文的英文词条、缺拼音的中文词条。

create or replace function public.submit_dictation_result(p_task_id uuid, p_member_id uuid, p_results jsonb)
returns table(success boolean, message text, correct_count int, error_count int, total_star int, new_star int)
language plpgsql security definer as $$
declare
  v_item jsonb;
  v_answer text;
  v_is_correct boolean;
  v_subject text;
  v_word_id text;
  v_error_word_id text;
  v_textbook text;
  v_unit_no int;
  v_unit_name text;
  v_page_no int;
  v_chinese text;
  v_pos text;
  v_pinyin text;
  v_text text;
  -- 任务词条兜底值
  v_tb2 text;
  v_unit_no2 int;
  v_unit_name2 text;
  v_page_no2 int;
  v_chinese2 text;
  v_pos2 text;
  v_pinyin2 text;
  v_ew public.dictation_error_words%rowtype;
  v_next_node int;
  v_today date := current_date;
  v_correct_count int := 0;
  v_error_count int := 0;
  v_total_star int := 0;
  v_star_per_word int;
  v_task record;
begin
  select * into v_task from public.dictation_tasks where id = p_task_id;
  if not found then
    return query select false, '任务不存在', 0, 0, 0, 0;
    return;
  end if;
  v_subject := v_task.subject;
  v_star_per_word := coalesce(v_task.star_per_word, 1);

  for v_item in select * from jsonb_array_elements(p_results)
  loop
    v_answer := btrim(coalesce(v_item->>'answer', ''));
    v_is_correct := (v_item->>'is_correct')::boolean;
    v_text := coalesce(v_item->>'word_text', '');
    v_word_id := nullif(v_item->>'word_id', '');
    v_error_word_id := nullif(v_item->>'error_word_id', '');
    v_textbook := null; v_unit_no := null; v_unit_name := null;
    v_page_no := null; v_chinese := null; v_pos := null; v_pinyin := null;

    -- 写入永久答题日志
    insert into public.dictation_records (task_id, member_id, subject, word_text, answer, is_correct)
    values (p_task_id, p_member_id, v_subject, v_text, coalesce(v_answer, ''), v_is_correct);

    if v_is_correct then
      v_correct_count := v_correct_count + 1;
    else
      v_error_count := v_error_count + 1;
    end if;

    -- 词条元数据（优先词库 word_id）
    if v_word_id is not null then
      select dw.textbook_name, dw.unit_no, dw.unit_name, dw.page_no,
             nullif(btrim(dw.chinese_meaning), ''), nullif(btrim(dw.part_of_speech), ''), nullif(btrim(dw.pinyin), '')
        into v_textbook, v_unit_no, v_unit_name, v_page_no, v_chinese, v_pos, v_pinyin
      from public.dictation_words dw where dw.id = v_word_id::uuid;
      if not found then
        v_answer := btrim(coalesce(v_item->>'answer', ''));
        v_textbook := null; v_unit_no := null; v_unit_name := null;
        v_page_no := null; v_chinese := null; v_pos := null; v_pinyin := null;
      end if;
    end if;

    -- 兜底：按任务词条回查中文/拼音（自定义词条、整句常无 word_id）
    if v_chinese is null or v_pinyin is null then
      select nullif(btrim(tw.chinese_meaning), ''), nullif(btrim(tw.part_of_speech), ''),
             nullif(btrim(tw.pinyin), ''), tw.textbook_name, tw.unit_no, tw.unit_name, tw.page_no
        into v_chinese2, v_pos2, v_pinyin2, v_tb2, v_unit_no2, v_unit_name2, v_page_no2
      from public.dictation_task_words tw
      where tw.task_id = p_task_id
        and lower(btrim(tw.answer)) = lower(btrim(coalesce(v_answer, '')))
      order by (tw.chinese_meaning is not null) desc, (tw.pinyin is not null) desc, tw.created_at desc
      limit 1;
      v_textbook := coalesce(v_textbook, v_tb2);
      v_unit_no := coalesce(v_unit_no, v_unit_no2);
      v_unit_name := coalesce(v_unit_name, v_unit_name2);
      v_page_no := coalesce(v_page_no, v_page_no2);
      v_chinese := coalesce(v_chinese, v_chinese2);
      v_pos := coalesce(v_pos, v_pos2);
      v_pinyin := coalesce(v_pinyin, v_pinyin2);
    end if;

    -- 已有错词：只补齐空字段，不用空值覆盖
    if v_error_word_id is not null then
      select * into v_ew from public.dictation_error_words where id = v_error_word_id::uuid;
      if found then
        v_answer := v_ew.answer;
        v_textbook := coalesce(nullif(btrim(v_ew.textbook_name), ''), v_textbook);
        v_unit_no := coalesce(v_ew.unit_no, v_unit_no);
        v_unit_name := coalesce(nullif(btrim(v_ew.unit_name), ''), v_unit_name);
        v_page_no := coalesce(v_ew.page_no, v_page_no);
        v_chinese := coalesce(nullif(btrim(v_ew.chinese_meaning), ''), v_chinese);
        v_pos := coalesce(nullif(btrim(v_ew.part_of_speech), ''), v_pos);
        v_pinyin := coalesce(nullif(btrim(v_ew.pinyin), ''), v_pinyin);
      end if;
    end if;

    select * into v_ew from public.dictation_error_words
    where member_id = p_member_id and lower(btrim(answer)) = lower(btrim(v_answer)) and subject = v_subject
    limit 1;

    -- 命中错词库但元数据缺失：回写补齐
    if v_ew.id is not null then
      if v_subject = 'english'
         and (v_ew.chinese_meaning is null or btrim(v_ew.chinese_meaning) = '')
         and v_chinese is not null then
        update public.dictation_error_words set chinese_meaning = v_chinese where id = v_ew.id;
      end if;
      if (v_ew.pinyin is null or btrim(v_ew.pinyin) = '') and v_pinyin is not null then
        update public.dictation_error_words set pinyin = v_pinyin where id = v_ew.id;
      end if;
    end if;

    if not v_is_correct then
      if v_ew.id is not null then
        update public.dictation_error_words set
          cycle_start_date = v_today,
          current_node = 1,
          next_review_date = v_today + 1,
          status = 'in_progress',
          last_review_date = v_today,
          review_count = review_count + 1,
          error_count = public.dictation_error_words.error_count + 1,
          review_history = review_history || jsonb_build_object('date', v_today::text, 'correct', false, 'action', 'reset')
        where id = v_ew.id;
      else
        insert into public.dictation_error_words
          (member_id, subject, word_id, textbook_name, unit_no, unit_name, page_no, chinese_meaning, part_of_speech, pinyin, answer,
           cycle_start_date, current_node, next_review_date, status, last_review_date, review_history, review_count, error_count)
        values
          (p_member_id, v_subject, v_word_id::uuid, coalesce(v_textbook, ''), coalesce(v_unit_no, 0), coalesce(v_unit_name, ''), v_page_no,
           v_chinese, v_pos, v_pinyin, coalesce(v_answer, ''),
           v_today, 1, v_today + 1, 'in_progress', v_today,
           jsonb_build_array(jsonb_build_object('date', v_today::text, 'correct', false, 'action', 'new')),
           1, 1);
      end if;
    else
      if v_ew.id is not null and v_ew.status = 'in_progress' then
        if v_ew.current_node >= 15 then
          update public.dictation_error_words set
            status = 'completed',
            next_review_date = null,
            last_review_date = v_today,
            review_count = review_count + 1,
            review_history = review_history || jsonb_build_object('date', v_today::text, 'correct', true, 'action', 'completed')
          where id = v_ew.id;
        else
          v_next_node := case v_ew.current_node
            when 1 then 2 when 2 then 4 when 4 then 7 else 15
          end;
          update public.dictation_error_words set
            current_node = v_next_node,
            next_review_date = v_today + v_next_node,
            last_review_date = v_today,
            review_count = review_count + 1,
            review_history = review_history || jsonb_build_object('date', v_today::text, 'correct', true, 'action', 'advance')
          where id = v_ew.id;
        end if;
      end if;
    end if;
  end loop;

  v_total_star := v_correct_count * v_star_per_word;
  update public.dictation_tasks set status = 'completed', updated_at = now() where id = p_task_id;
  return query select true, 'ok', v_correct_count, v_error_count, v_total_star, v_total_star;
end;
$$;

create or replace function public.save_quick_review_record(
  p_task_id uuid, p_member_id uuid, p_task_word_id uuid, p_word_text text,
  p_answer text, p_is_correct boolean, p_subject text,
  p_star_per_word int default 1, p_round_no int default 1
) returns table(success boolean, message text, star_gained int)
language plpgsql security definer as $$
declare
  v_ew public.dictation_error_words%rowtype;
  v_next_node int;
  v_today date := current_date;
  v_task record;
  v_word record;
  v_chinese text;
  v_pinyin text;
  v_pos text;
  v_textbook text;
  v_unit_no int;
  v_unit_name text;
  v_page_no int;
begin
  p_answer := btrim(p_answer);
  select * into v_task from public.dictation_tasks where id = p_task_id;
  if not found then
    return query select false, '任务不存在', 0;
    return;
  end if;

  select * into v_word from public.dictation_quick_review_records
  where task_id = p_task_id and task_word_id = p_task_word_id and round_no = p_round_no
  limit 1;
  if found then
    return query select true, '已记录', 0;
    return;
  end if;

  insert into public.dictation_quick_review_records
    (task_id, member_id, task_word_id, word_text, answer, is_correct, subject, round_no)
  values
    (p_task_id, p_member_id, p_task_word_id, p_word_text, p_answer, p_is_correct, p_subject, p_round_no);

  -- 词条元数据：按任务词条取中文/拼音（快速复习 payload 不带这些字段）
  select nullif(btrim(tw.chinese_meaning), ''), nullif(btrim(tw.pinyin), ''),
         nullif(btrim(tw.part_of_speech), ''), tw.textbook_name, tw.unit_no, tw.unit_name, tw.page_no
    into v_chinese, v_pinyin, v_pos, v_textbook, v_unit_no, v_unit_name, v_page_no
  from public.dictation_task_words tw
  where tw.task_id = p_task_id
    and (tw.id = p_task_word_id
         or lower(btrim(tw.answer)) = lower(btrim(p_answer)))
  order by (tw.id = p_task_word_id) desc, (tw.chinese_meaning is not null) desc
  limit 1;

  select * into v_ew from public.dictation_error_words
  where member_id = p_member_id and lower(btrim(answer)) = lower(btrim(p_answer)) and subject = p_subject
  limit 1;

  -- 命中错词库但元数据缺失：回写补齐
  if v_ew.id is not null then
    if p_subject = 'english'
       and (v_ew.chinese_meaning is null or btrim(v_ew.chinese_meaning) = '')
       and v_chinese is not null then
      update public.dictation_error_words set chinese_meaning = v_chinese where id = v_ew.id;
    end if;
    if (v_ew.pinyin is null or btrim(v_ew.pinyin) = '') and v_pinyin is not null then
      update public.dictation_error_words set pinyin = v_pinyin where id = v_ew.id;
    end if;
  end if;

  if not p_is_correct then
    if v_ew.id is not null then
      update public.dictation_error_words set
        cycle_start_date = v_today,
        current_node = 1,
        next_review_date = v_today + 1,
        status = 'in_progress',
        last_review_date = v_today,
        review_count = review_count + 1,
        error_count = error_count + 1,
        review_history = review_history || jsonb_build_object('date', v_today::text, 'correct', false, 'action', 'reset')
      where id = v_ew.id;
    else
      insert into public.dictation_error_words
        (member_id, subject, textbook_name, unit_no, unit_name, page_no, chinese_meaning, part_of_speech, pinyin, answer,
         cycle_start_date, current_node, next_review_date, status, last_review_date, review_history, review_count, error_count)
      values
        (p_member_id, p_subject, coalesce(v_textbook, ''), coalesce(v_unit_no, 0), coalesce(v_unit_name, ''), v_page_no,
         v_chinese, v_pos, v_pinyin, p_answer,
         v_today, 1, v_today + 1, 'in_progress', v_today,
         jsonb_build_array(jsonb_build_object('date', v_today::text, 'correct', false, 'action', 'new')),
         1, 1);
    end if;
  else
    if v_ew.id is not null and v_ew.status = 'in_progress' then
      if v_ew.current_node >= 15 then
        update public.dictation_error_words set
          status = 'completed',
          next_review_date = null,
          last_review_date = v_today,
          review_count = review_count + 1,
          review_history = review_history || jsonb_build_object('date', v_today::text, 'correct', true, 'action', 'completed')
        where id = v_ew.id;
      else
        v_next_node := case v_ew.current_node
          when 1 then 2 when 2 then 4 when 4 then 7 else 15
        end;
        update public.dictation_error_words set
          current_node = v_next_node,
          next_review_date = v_today + v_next_node,
          last_review_date = v_today,
          review_count = review_count + 1,
          review_history = review_history || jsonb_build_object('date', v_today::text, 'correct', true, 'action', 'advance')
        where id = v_ew.id;
      end if;
    end if;
  end if;

  return query select true, 'ok', 0;
end;
$$;

-- 历史回填：英文词条补中文
with src as (
  select distinct on (lower(btrim(answer)))
         lower(btrim(answer)) as k, nullif(btrim(chinese_meaning), '') as cn
  from public.dictation_task_words
  where nullif(btrim(chinese_meaning), '') is not null
  order by lower(btrim(answer)), created_at desc
)
update public.dictation_error_words e
set chinese_meaning = s.cn
from src s
where e.subject = 'english'
  and (e.chinese_meaning is null or btrim(e.chinese_meaning) = '')
  and lower(btrim(e.answer)) = s.k;

-- 历史回填：中文词条补拼音
with src as (
  select distinct on (lower(btrim(answer)))
         lower(btrim(answer)) as k, nullif(btrim(pinyin), '') as py
  from public.dictation_task_words
  where nullif(btrim(pinyin), '') is not null
  order by lower(btrim(answer)), created_at desc
)
update public.dictation_error_words e
set pinyin = s.py
from src s
where e.subject = 'chinese'
  and (e.pinyin is null or btrim(e.pinyin) = '')
  and lower(btrim(e.answer)) = s.k;

-- 验证：仍缺中文的英文词条 / 仍缺拼音的中文词条
select
  (select count(*) from public.dictation_error_words
    where subject = 'english' and (chinese_meaning is null or btrim(chinese_meaning) = '')) as english_missing_cn,
  (select count(*) from public.dictation_error_words
    where subject = 'chinese' and (pinyin is null or btrim(pinyin) = '')) as chinese_missing_pinyin;
