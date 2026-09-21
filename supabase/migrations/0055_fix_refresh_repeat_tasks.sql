-- 0055: 修复每日任务自动上线逻辑
-- 问题：原逻辑要求当前时间 >= 12:00 才上线，导致上午任务不显示
-- 修复：去掉 12:00 限制，当天周几匹配即上线
-- 同时确保 repeat_days 列存在（兜底迁移 0051 未执行的情况）

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS repeat_days integer[];

CREATE OR REPLACE FUNCTION public.refresh_repeat_tasks(p_family_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_today_dow integer;
BEGIN
  v_today_dow := EXTRACT(DOW FROM CURRENT_DATE)::int;

  UPDATE public.tasks
  SET status = CASE
    WHEN repeat_days IS NOT NULL
         AND array_length(repeat_days, 1) > 0
         AND v_today_dow = ANY(repeat_days)
    THEN 'active'::text
    ELSE 'draft'::text
  END,
  updated_at = now()
  WHERE family_id = p_family_id
    AND repeat_days IS NOT NULL
    AND array_length(repeat_days, 1) > 0
    AND status NOT IN ('pending_approval', 'deleted');
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_repeat_tasks(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_repeat_tasks(uuid) TO authenticated;

-- 确保 expire_tasks 也存在
CREATE OR REPLACE FUNCTION public.expire_tasks(p_family_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
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
