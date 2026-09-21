import { supabase } from './client';
import type { Member } from './types';

// 添加孩子
export async function addChild(familyId: string, name: string, emoji: string): Promise<Member> {
  const { data, error } = await supabase.rpc('add_child', {
    p_family_id: familyId,
    p_name: name,
    p_emoji: emoji,
  });
  if (error) throw error;

  // add_child 返回 id，需要再查一次
  const newId = (Array.isArray(data) ? data[0] : data) as string;
  const { data: member } = await supabase
    .from('members').select('*').eq('id', newId).single();
  return member as Member;
}

// 更新成员
export async function updateMember(id: string, patch: Partial<Member>): Promise<Member> {
  const { data, error } = await supabase
    .from('members').update(patch).eq('id', id).select().single();
  if (error) throw error;
  return data as Member;
}

// 删除成员（走 RPC 级联清理 tasks.completed_by/coin_records.created_by/items.created_by/purchases.redeemed_by 等无 cascade 的外键）
export async function deleteMember(id: string): Promise<void> {
  const { error } = await supabase.rpc('delete_member', { p_member_id: id });
  if (error) throw error;
}

// 重置金币
export async function resetCoins(memberId: string, parentId: string): Promise<void> {
  const member = await supabase.from('members').select('coin_balance,family_id').eq('id', memberId).single();
  if (member.error) throw member.error;
  const balance = member.data.coin_balance;
  if (balance === 0) return;
  await adjustCoinsInternal(memberId, -balance, '重置金币', parentId);
}

import { adjustCoins as adjustCoinsInternal } from './coins';
