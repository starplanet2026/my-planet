import { supabase } from './client';
import type { CoinRecord, CoinRecordCategory, AdjustCoinsResult } from './types';

export type BalanceType = 'coin' | 'star';

// 查询金币流水
export async function fetchCoinRecords(
  familyId: string,
  memberId?: string,
  category?: CoinRecordCategory
): Promise<CoinRecord[]> {
  let q = supabase
    .from('coin_records')
    .select('*')
    .eq('family_id', familyId)
    .order('created_at', { ascending: false });
  if (memberId) q = q.eq('member_id', memberId);
  if (category) q = q.eq('category', category);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as CoinRecord[];
}

// 家长手动调整金币（RPC 原子操作）
export async function adjustCoins(
  memberId: string,
  amount: number,
  reason: string,
  parentId: string
): Promise<AdjustCoinsResult> {
  const { data, error } = await supabase.rpc('adjust_coins', {
    p_member_id: memberId,
    p_amount: amount,
    p_reason: reason,
    p_parent_id: parentId,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row as AdjustCoinsResult;
}

// 手动加减分（新版，需要 family_id，支持双货币）
export async function manualAdjustCoins(
  familyId: string,
  memberId: string,
  amount: number,
  reason: string,
  createdBy: string,
  balanceType: 'coin' | 'star' = 'coin'
): Promise<AdjustCoinsResult> {
  const { data, error } = await supabase.rpc('manual_adjust_coins', {
    p_family_id: familyId,
    p_member_id: memberId,
    p_amount: amount,
    p_reason: reason,
    p_created_by: createdBy,
    p_balance_type: balanceType,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row as AdjustCoinsResult;
}

// 孩子回复退回消息
export async function replyMessage(recordId: string, reply: string): Promise<void> {
  const { error } = await supabase.rpc('reply_message', {
    p_record_id: recordId,
    p_reply: reply,
  });
  if (error) throw error;
}

// ====== 资产明细日志（星光值 / 金币，分页 + 近 30 天） ======
export async function fetchAssetLogs(
  memberId: string,
  balanceType: BalanceType,
  limit = 20,
  offset = 0,
): Promise<CoinRecord[]> {
  const { data, error } = await supabase.rpc('get_asset_logs', {
    p_member_id: memberId,
    p_balance_type: balanceType,
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw error;
  return (data ?? []) as CoinRecord[];
}

// 清空资产日志
export async function clearAssetLogs(memberId: string, balanceType: BalanceType): Promise<void> {
  const { error } = await supabase.rpc('clear_asset_logs', {
    p_member_id: memberId,
    p_balance_type: balanceType,
  });
  if (error) throw error;
}
