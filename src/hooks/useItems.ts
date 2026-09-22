import { useRealtimeTable } from './useRealtimeTable';
import { fetchItems, createItem, updateItem, deleteItem } from '../api/items';
import type { Item } from '../api/types';

export function useItems(activeOnly = false) {
  const { rows: items, loading } = useRealtimeTable<Item>({
    table: 'items',
    fetchFn: () => fetchItems(activeOnly),
  });

  return {
    items,
    loading,
    createItem,
    updateItem,
    deleteItem,
  };
}
