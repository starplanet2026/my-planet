import { useRealtimeTable } from './useRealtimeTable';
import { useFamilyStore } from '../store/familyStore';
import { fetchCoinRecords, adjustCoins, manualAdjustCoins, replyMessage } from '../api/coins';
import type { CoinRecord, CoinRecordCategory } from '../api/types';

export function useCoinRecords(category?: CoinRecordCategory) {
  const familyId = useFamilyStore(s => s.family?.id);

  const { rows: records, loading, refresh } = useRealtimeTable<CoinRecord>({
    table: 'coin_records',
    filter: familyId ? `family_id=eq.${familyId}` : undefined,
    fetchFn: () => familyId ? fetchCoinRecords(familyId, undefined, category) : Promise.resolve([]),
    enabled: !!familyId,
  });

  const filtered = category ? records.filter(r => r.category === category) : records;

  return {
    records: filtered,
    loading,
    refresh,
    adjustCoins,
    manualAdjustCoins: (familyId: string, memberId: string, amount: number, reason: string, createdBy: string, balanceType?: 'coin' | 'star') =>
      manualAdjustCoins(familyId, memberId, amount, reason, createdBy, balanceType),
    replyMessage,
  };
}
