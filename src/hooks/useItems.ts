import { useRealtimeTable } from './useRealtimeTable';
import { useFamilyStore } from '../store/familyStore';
import { fetchItems, createItem, updateItem, deleteItem } from '../api/items';
import type { Item } from '../api/types';

export function useItems(activeOnly = false) {
  const familyId = useFamilyStore(s => s.family?.id);

  const { rows: items, loading } = useRealtimeTable<Item>({
    table: 'items',
    filter: familyId ? `family_id=eq.${familyId}` : undefined,
    fetchFn: () => familyId ? fetchItems(familyId, activeOnly) : Promise.resolve([]),
    enabled: !!familyId,
  });

  return {
    items,
    loading,
    createItem,
    updateItem,
    deleteItem,
  };
}
