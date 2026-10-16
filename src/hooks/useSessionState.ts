import { useState, useCallback } from 'react';

/**
 * 会话级持久化状态。
 *
 * 值以 JSON 形式保存在 sessionStorage：
 * - SPA 内切换页面：状态由 KeepAlive 保留，本 hook 不影响
 * - 浏览器刷新 / 标签被丢弃（内存节省、手机切后台回收）后重新打开：
 *   同一标签页 sessionStorage 仍在，状态自动还原，用户回到原来的 Tab 与筛选条件
 *
 * 仅用于可 JSON 序列化的简单状态（字符串、数字、字符串数组），
 * 不要传入 Set / Map / 函数（无法序列化）。
 */
export function useSessionState<T>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = sessionStorage.getItem(key);
      if (raw === null) return initial;
      return JSON.parse(raw) as T;
    } catch {
      return initial;
    }
  });

  const set = useCallback(
    (next: T) => {
      setValue(next);
      try {
        sessionStorage.setItem(key, JSON.stringify(next));
      } catch {
        // 隐私模式或超出配额时忽略，不影响页面功能
      }
    },
    [key]
  );

  return [value, set];
}
