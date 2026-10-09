import { useMemo } from 'react';
import { useRealtimeTable } from './useRealtimeTable';
import { useFamilyStore } from '../store/familyStore';
import { fetchPurchases, purchaseItem, redeemPurchase, sellPurchase } from '../api/purchases';
import type { Purchase, PurchaseStatus } from '../api/types';

export function usePurchases(status?: PurchaseStatus, memberId?: string) {
  const familyId = useFamilyStore(s => s.family?.id);

  const filterParts = familyId ? [`family_id=eq.${familyId}`] : [];
  if (memberId) filterParts.push(`member_id=eq.${memberId}`);

  const { rows: purchases, loading } = useRealtimeTable<Purchase>({
    table: 'purchases',
    filter: filterParts.length ? filterParts.join('&') : undefined,
    fetchFn: () => familyId ? fetchPurchases(familyId, memberId, status) : Promise.resolve([]),
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
