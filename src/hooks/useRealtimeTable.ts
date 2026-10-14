import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '../api/client';

interface RealtimeOptions<T> {
  table: string;
  filter?: string;
  fetchFn: () => Promise<T[]>;
  enabled?: boolean;
}

export function useRealtimeTable<T extends { id: string }>(
  opts: RealtimeOptions<T>
): { rows: T[]; loading: boolean; refresh: () => Promise<void> } {
  const { table, filter, fetchFn, enabled = true } = opts;
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const fetchRef = useRef(fetchFn);
  fetchRef.current = fetchFn;
  // 频道名唯一化：supabase-js 对同 topic 的 channel 会复用已 subscribe 的实例，
  // 多个页面（如仪表盘+成就库同时挂载）用同名 topic 时，第二次 .on() 会抛
  // "cannot add postgres_changes callbacks ... after subscribe()" 并导致整页白屏。
  // instanceId 区分不同 hook 实例；seq 区分同实例的多次订阅（StrictMode 双跑/重订阅）。
  const instanceIdRef = useRef(Math.random().toString(36).slice(2, 8));
  const seqRef = useRef(0);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchRef.current();
      setRows(data);
    } catch (e) {
      console.error(`${table} fetch error:`, e);
    } finally {
      setLoading(false);
    }
  }, [table]);

  // 初始拉取
  useEffect(() => {
    if (!enabled) return;
    refresh();
  }, [enabled, refresh]);

  // 实时订阅
  useEffect(() => {
    if (!enabled) return;

    const channelName = `rt:${table}:${filter ?? 'all'}:${instanceIdRef.current}-${++seqRef.current}`;
    const channel = supabase
      .channel(channelName)
      .on('postgres_changes',
        {
          event: '*',
          schema: 'public',
          table,
          ...(filter ? { filter } : {}),
        },
        (payload) => {
          setRows((prev) => {
            const eventType = payload.eventType;
            if (eventType === 'DELETE') {
              return prev.filter(r => r.id !== payload.old?.id);
            }
            if (eventType === 'INSERT') {
              return payload.new ? [...prev, payload.new as T] : prev;
            }
            // UPDATE
            return payload.new
              ? prev.map(r => r.id === (payload.new as T).id ? payload.new as T : r)
              : prev;
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [table, filter, enabled]);

  return { rows, loading, refresh };
}
