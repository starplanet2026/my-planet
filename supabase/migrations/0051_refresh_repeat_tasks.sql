-- 0051_refresh_repeat_tasks.sql
-- 实现：每日任务按周几循环，对应日期12点自动上线/下线
-- repeat_days: 数组，0=周日, 1=周一, ..., 6=周六（与 JS Date.getDay() 一致）
-- 逻辑：当天周几在 repeat_days 中且当前时间 ≥ 12:00 → status='active'
--      否则 → status='draft'
-- 前端在每次加载任务列表前通过 refreshAndExpireTasks(familyId) 触发本 RPC

-- 1) 确保字段存在（兼容历史数据）
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS repeat_days integer[];

-- 2) 自动刷新重复任务（按周几 + 12点上线）
CREATE OR REPLACE FUNCTION public.refresh_repeat_tasks(p_family_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_today_dow integer;        -- 今天周几（0=周日）
  v_now_time time;            -- 当前时间
  v_noon_const time := '12:00:00'::time;
BEGIN
  -- 0=Sunday in both PostgreSQL EXTRACT(DOW) and JS Date.getDay()
  v_today_dow := EXTRACT(DOW FROM CURRENT_DATE)::int;
  v_now_time := CURRENT_TIME;

  -- 仅处理该家庭下的重复任务（repeat_days 非空数组）
  -- 当天匹配且已过12点 → 上线；否则 → 下线（回到 draft）
  UPDATE public.tasks
  SET status = CASE
    WHEN repeat_days IS NOT NULL
         AND array_length(repeat_days, 1) > 0
         AND v_today_dow = ANY(repeat_days)
         AND v_now_time >= v_noon_const
    THEN 'active'::text
    ELSE 'draft'::text
  END,
  updated_at = now()
  WHERE family_id = p_family_id
    AND repeat_days IS NOT NULL
    AND array_length(repeat_days, 1) > 0
    -- 只刷新当前不是 pending_approval / deleted 的任务
    AND status NOT IN ('pending_approval', 'deleted');
END;
$$;

-- 3) 简单权限：登录用户可调用（RLS 会在 tasks 表层面限制可见行）
REVOKE ALL ON FUNCTION public.refresh_repeat_tasks(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_repeat_tasks(uuid) TO authenticated;

-- 4) 同时确保 expire_tasks 也存在（前端会先调用它再调用 refresh_repeat_tasks）
-- 如果之前没创建过 expire_tasks，这里创建一个空的兜底版本
CREATE OR REPLACE FUNCTION public.expire_tasks(p_family_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- 当前只处理 deadline 过期的 active/draft 任务标记为 expired
  -- 不影响有 repeat_days 的任务（refresh_repeat_tasks 会再处理它们）
  UPDATE public.tasks
  SET status = 'expired'::text,
      updated_at = now()
  WHERE family_id = p_family_id
    AND deadline IS NOT NULL
    AND deadline < now()
    AND status IN ('active', 'draft')
    AND (repeat_days IS NULL OR array_length(repeat_days, 1) IS NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.expire_tasks(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expire_tasks(uuid) TO authenticated;
