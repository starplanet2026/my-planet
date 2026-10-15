-- 0262: 全量回溯家默错词库统计与复习节点
-- ------------------------------------------------------------------
-- 背景：0261 已修复写入链路（家长审核批改 approve_dictation_submission）的节点逻辑漏洞，
--       但历史数据中 review_count / error_count / current_node / status / next_review_date
--       / review_history 已被污染，需按统一口径全量重算。
--
-- 台账口径：
--   主台账 = review_history（每个条目视为一次复习事件，不去重）
--   补台账 = 三张永久答题日志，互为补充、互不重叠
--       1) dictation_records               —— 直连批改路径，覆盖自 2026-09-28
--       2) dictation_quick_review_records  —— 快速复习路径，覆盖自 2026-10-11
--       3) dictation_submissions           —— 家长审核批改路径
--            (type='grading_result' and status='approved' 的 results 明细)，覆盖自 2026-10-13
--       · 日志仅用于“补齐历史缺失的事件”：某 (日期, 对错) 的日志条数多于历史条目数时，
--         才补入差额事件；否则历史视为已记录，不重复计入。
--         （0261 之前 approve 链路答对时不写历史、答错仅 insert 新行，故历史缺失的
--           10-13 起答对事件必须由日志补入；而 quick_review 路径同时写历史与日志，
--           若按“求和”会重复计数。）
--
-- 计入规则：
--   · 只统计“错词入库之后”发生的答题：日志事件时间 >= 该行 created_at；
--     历史条目日期 >= 该行 created_at 的 UTC 日期（与 current_date 写入口径一致）
--
-- 节点重放规则（方案 B）：
--   · 答错 → 回到第 1 节点（首条即答错记为 new，否则 reset）
--   · 答对 → 按 1→2→4→7→15 序列推进；到达第 15 节点后再答对 1 次才视为掌握
--   · 末次事件为答对且已标记完成 → status='completed', next_review_date=null
--   · 末次事件为答对且未完成 → status='in_progress', next_review_date = 末次事件日期 + 当前节点
--   · 末次事件为答错 → current_node=1, status='in_progress', next_review_date = 末次事件日期 + 1
--   · 同日期内按“答错在前、答对在后”重放
--   · 严格按台账重推：不保留原有节点/完成状态（无任何答题证据的行除外）
-- ------------------------------------------------------------------

create temp table tmp_hist (
  ew_id uuid, ts timestamptz, d date, correct boolean, action text
) on commit drop;

create temp table tmp_log (
  ew_id uuid, ts timestamptz, d date, correct boolean
) on commit drop;

create temp table tmp_ev (
  ew_id uuid, ts timestamptz, d date, correct boolean, seq bigint
) on commit drop;

-- 一、主台账：review_history（每个条目视为一次事件）
insert into tmp_hist (ew_id, ts, d, correct, action)
select ew.id,
       ((h->>'date')::date::timestamp + interval '12 hours') at time zone 'UTC',
       (h->>'date')::date,
       coalesce((h->>'correct')::boolean, false),
       coalesce(h->>'action', '')
from public.dictation_error_words ew
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(ew.review_history) = 'array' then ew.review_history else '[]'::jsonb end
) h
where jsonb_typeof(h) = 'object'
  and (h->>'date') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  and (h->>'date')::date >= (ew.created_at at time zone 'UTC')::date;

-- 二、补台账：永久答题日志（权威时间戳）
insert into tmp_log (ew_id, ts, d, correct)
select distinct ew.id, l.ts, (l.ts at time zone 'UTC')::date, l.is_correct
from public.dictation_error_words ew
join (
  select member_id, subject, answer, created_at as ts, is_correct from public.dictation_records
  union
  select member_id, subject, answer, created_at, is_correct from public.dictation_quick_review_records
  union
  select s.member_id, t.subject, x->>'answer', s.reviewed_at, (x->>'is_correct')::boolean
    from public.dictation_submissions s
    join public.dictation_tasks t on t.id = s.task_id
    cross join lateral jsonb_array_elements(s.results) x
   where s.type = 'grading_result' and s.status = 'approved' and s.reviewed_at is not null
) l
  on l.member_id = ew.member_id
 and l.answer = ew.answer
 and (l.subject is null or l.subject = ew.subject)
 and l.ts >= ew.created_at;

-- 三、事件合并：历史事件 + 日志中超出历史条数的差额事件
insert into tmp_ev (ew_id, ts, d, correct, seq)
select ew_id, ts, d, correct, 0 from tmp_hist;

insert into tmp_ev (ew_id, ts, d, correct, seq)
select z.ew_id, z.ts, z.d, z.correct, z.rn
from (
  select l.ew_id, l.ts, l.d, l.correct,
         row_number() over (partition by l.ew_id, l.d, l.correct order by l.ts) as rn
  from tmp_log l
) z
left join (
  select ew_id, d, correct, count(*) as hc from tmp_hist group by 1, 2, 3
) h on h.ew_id = z.ew_id and h.d = z.d and h.correct = z.correct
where z.rn > coalesce(h.hc, 0);

-- 四、逐行重放（方案 B），写回节点/状态/次数/历史
do $$
declare
  r record;
  e record;
  v_node int;
  v_next int;
  v_rc int;
  v_ec int;
  v_action text;
  v_last_d date;
  v_done boolean;
  v_hist jsonb;
  v_cycle date;
  v_has boolean;
begin
  for r in select id from public.dictation_error_words loop
    v_has := false;
    v_node := 1;
    v_rc := 0;
    v_ec := 0;
    v_last_d := null;
    v_done := false;
    v_hist := '[]'::jsonb;
    v_cycle := null;

    for e in select * from tmp_ev where ew_id = r.id order by d, correct, ts, seq loop
      v_has := true;
      v_rc := v_rc + 1;

      if e.correct then
        if v_done then
          -- 已完成后再答对：保持完成
          v_action := 'completed';
        elsif v_node >= 15 then
          -- 第15节点答对 → 完成
          v_done := true;
          v_action := 'completed';
        else
          -- 推进一级（含推进到第15节点，仍为进行中）
          v_next := case v_node when 1 then 2 when 2 then 4 when 4 then 7 else 15 end;
          v_action := 'advance';
          v_node := v_next;
        end if;
      else
        v_ec := v_ec + 1;
        v_node := 1;
        v_done := false;
        v_cycle := e.d;
        v_action := case when v_rc = 1 then 'new' else 'reset' end;
      end if;

      v_hist := v_hist || jsonb_build_object('date', e.d::text, 'correct', e.correct, 'action', v_action);
      v_last_d := e.d;
    end loop;

    if v_has then
      if v_done then
        update public.dictation_error_words set
          current_node = 15,
          status = 'completed',
          next_review_date = null,
          last_review_date = v_last_d,
          review_count = v_rc,
          error_count = v_ec,
          review_history = v_hist,
          cycle_start_date = coalesce(v_cycle, v_last_d),
          updated_at = now()
        where id = r.id;
      else
        -- 未完成（含末次事件为答错时 v_node=1）：保持进行中
        update public.dictation_error_words set
          current_node = v_node,
          status = 'in_progress',
          next_review_date = v_last_d + v_node,
          last_review_date = v_last_d,
          review_count = v_rc,
          error_count = v_ec,
          review_history = v_hist,
          cycle_start_date = coalesce(v_cycle, v_last_d),
          updated_at = now()
        where id = r.id;
      end if;
    else
      -- 无任何答题证据：仅归零计数，保留既有节点/状态/下次复习日（保护家长手工设置的节点）
      update public.dictation_error_words set
        review_count = 0,
        error_count = 0,
        updated_at = now()
      where id = r.id;
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
