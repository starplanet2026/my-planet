-- 0240: 修复快速复习二轮错题判题唯一约束冲突
-- 报错：duplicate key value violates unique constraint
--       "dictation_quick_review_record_task_id_member_id_task_word_i_key"
-- 原因：建表时唯一约束为 (task_id, member_id, task_word_id)，
--       后来新增多轮错题复习（round_no），同一词条在第2轮及以后再次判题时
--       需要按不同 round_no 插入新行，与旧约束冲突。
--       RPC 内去重检查本就按 (task_id, task_word_id, round_no)，约束未同步。
-- 修复：删除列恰好为 (task_id, member_id, task_word_id) 的唯一约束/唯一索引
--       （不依赖具体约束名，兼容开发期间的历史命名），
--       重建为含 round_no 的唯一约束。

do $$
declare
  v_oid oid := 'public.dictation_quick_review_records'::regclass;
  r record;
begin
  -- 1) 删除表级唯一/主键约束（列精确匹配三列，不含 round_no）
  for r in
    select con.conname, con.conrelid::regclass as tbl
    from pg_constraint con
    where con.conrelid = v_oid
      and con.contype in ('u', 'p')
      and (
        select string_agg(a.attname, ',' order by u.ordinality)
        from unnest(con.conkey) with ordinality as u(attnum, ordinality)
        join pg_attribute a
          on a.attrelid = con.conrelid and a.attnum = u.attnum
      ) = 'task_id,member_id,task_word_id'
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;

  -- 2) 删除以独立 unique index 形式存在的同列唯一索引（未挂在约束上的）
  for r in
    select ic.relname as idxname
    from pg_index i
    join pg_class ic on ic.oid = i.indexrelid
    where i.indrelid = v_oid
      and i.indisunique
      and not exists (select 1 from pg_constraint c where c.conindid = i.indexrelid)
      and (
        select string_agg(a.attname, ',' order by u.ordinality)
        from unnest(i.indkey) with ordinality as u(attnum, ordinality)
        join pg_attribute a
          on a.attrelid = i.indrelid and a.attnum = u.attnum
      ) = 'task_id,member_id,task_word_id'
  loop
    execute format('drop index public.%I', r.idxname);
  end loop;
end $$;

-- 3) 重建唯一约束：同一任务同一成员，同一词条在同一轮次只允许一条记录
alter table public.dictation_quick_review_records
  add constraint dictation_quick_review_record_task_member_word_round_key
  unique (task_id, member_id, task_word_id, round_no);

notify pgrst, 'reload schema';
