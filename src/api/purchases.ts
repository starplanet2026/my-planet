import { supabase } from './client';
import type { Purchase, PurchaseItemResult, SellPurchaseResult, PurchaseStatus } from './types';

// 查询购买记录（关联商品获取图片、周限）
export async function fetchPurchases(
  familyId: string,
  memberId?: string,
  status?: PurchaseStatus
): Promise<Purchase[]> {
  let q = supabase
    .from('purchases')
    .select('*, items(image_url, weekly_limit, description, category)')
    .eq('family_id', familyId)
    .order('created_at', { ascending: false });
  if (memberId) q = q.eq('member_id', memberId);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Purchase[];
}

// 查询本周特权卡使用次数（按member_id分组）
export async function fetchWeeklyUsage(memberId: string): Promise<Record<string, number>> {
  const weekStart = new Date();
  const day = weekStart.getDay();
  const diff = day === 0 ? -6 : 1 - day; // 周一为起点
  weekStart.setDate(weekStart.getDate() + diff);
  weekStart.setHours(0, 0, 0, 0);

  const { data, error } = await supabase
    .from('purchase_usage_records')
    .select('item_id')
    .eq('member_id', memberId)
    .gte('used_at', weekStart.toISOString());

  if (error) throw error;
  const map: Record<string, number> = {};
  for (const row of data ?? []) {
    map[row.item_id] = (map[row.item_id] ?? 0) + 1;
  }
  return map;
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

// 出售特权卡（返还 90% 金币，支持选择数量）
export async function sellPurchase(purchaseId: string, memberId: string, quantity: number = 1): Promise<SellPurchaseResult> {
  const { data, error } = await supabase.rpc('sell_purchase', {
    p_purchase_id: purchaseId,
    p_member_id: memberId,
    p_quantity: quantity,
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

// 后台直接给用户发放特权卡（不扣金币）
export async function grantPurchase(
  familyId: string,
  memberId: string,
  itemId: string,
  itemName: string,
  quantity: number = 1
): Promise<void> {
  const code = Math.random().toString(36).substring(2, 10).toUpperCase();
  const { error } = await supabase.from('purchases').insert({
    family_id: familyId,
    member_id: memberId,
    item_id: itemId,
    item_name_snapshot: itemName,
    price_paid: 0,
    quantity,
    code,
    status: 'pending',
  });
  if (error) throw error;
}
