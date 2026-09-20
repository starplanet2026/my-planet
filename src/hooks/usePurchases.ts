import { useMemo } from 'react';
import { useRealtimeTable } from './useRealtimeTable';
import { useFamilyStore } from '../store/familyStore';
import { fetchPurchases, purchaseItem, redeemPurchase, sellPurchase } from '../api/purchases';
import type { Purchase, PurchaseStatus } from '../api/types';

export function usePurchases(status?: PurchaseStatus) {
  const familyId = useFamilyStore(s => s.family?.id);

  const { rows: purchases, loading } = useRealtimeTable<Purchase>({
    table: 'purchases',
    filter: familyId ? `family_id=eq.${familyId}` : undefined,
    fetchFn: () => familyId ? fetchPurchases(familyId, undefined, status) : Promise.resolve([]),
    enabled: !!familyId,
  });

  const filtered = useMemo(() => {
    if (status) return purchases.filter(p => p.status === status);
    return purchases;
  }, [purchases, status]);

  return {
    purchases: filtered,
    allPurchases: purchases,
    loading,
    purchaseItem,
    redeemPurchase,
    sellPurchase,
  };
}
