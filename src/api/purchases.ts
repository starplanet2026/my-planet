import { supabase } from './client';
import type { Purchase, PurchaseItemResult, SellPurchaseResult, PurchaseStatus } from './types';

// 查询购买记录
export async function fetchPurchases(
  familyId: string,
  memberId?: string,
  status?: PurchaseStatus
): Promise<Purchase[]> {
  let q = supabase
    .from('purchases')
    .select('*')
    .eq('family_id', familyId)
    .order('created_at', { ascending: false });
  if (memberId) q = q.eq('member_id', memberId);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Purchase[];
}

// 购买商品（RPC 原子操作，支持数量）
export async function purchaseItem(itemId: string, memberId: string, quantity: number = 1): Promise<PurchaseItemResult> {
  const { data, error } = await supabase.rpc('purchase_item', {
    p_item_id: itemId,
    p_member_id: memberId,
    p_quantity: quantity,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row as PurchaseItemResult;
}

// 兑换特权（孩子直接使用）
export async function redeemPurchase(purchaseId: string, memberId: string): Promise<void> {
  const { error } = await supabase.rpc('redeem_purchase', {
    p_purchase_id: purchaseId,
    p_member_id: memberId,
  });
  if (error) throw error;
}

// 出售特权卡（返还 90% 金币）
export async function sellPurchase(purchaseId: string, memberId: string): Promise<SellPurchaseResult> {
  const { data, error } = await supabase.rpc('sell_purchase', {
    p_purchase_id: purchaseId,
    p_member_id: memberId,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row as SellPurchaseResult;
}

// 删除购买记录（后台管理）
export async function deletePurchase(purchaseId: string): Promise<void> {
  const { error } = await supabase.from('purchases').delete().eq('id', purchaseId);
  if (error) throw error;
}
