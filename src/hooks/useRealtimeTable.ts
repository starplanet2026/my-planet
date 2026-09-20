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

    const channelName = `rt:${table}:${filter ?? 'all'}`;
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
