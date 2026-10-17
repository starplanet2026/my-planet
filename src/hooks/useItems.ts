import { useRealtimeTable } from './useRealtimeTable';
import { fetchItems, createItem, updateItem, deleteItem } from '../api/items';
import type { Item } from '../api/types';

export function useItems(familyId?: string, activeOnly = false) {
  const { rows: items, loading } = useRealtimeTable<Item>({
    table: 'items',
    // Realtime 也按家庭过滤，避免收到其他家庭特权卡的变更事件
    filter: familyId ? `family_id=eq.${familyId}` : undefined,
    enabled: !!familyId,
    fetchFn: () => fetchItems(familyId as string, activeOnly),
  });

  return {
    items,
    loading,
    createItem,
    updateItem,
    deleteItem,
  };
}
