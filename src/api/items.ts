import { supabase } from './client';
import type { Item } from './types';

// 查询商品
export async function fetchItems(activeOnly = false): Promise<Item[]> {
  let q = supabase
    .from('items')
    .select('*')
    .order('created_at', { ascending: false });
  if (activeOnly) q = q.eq('status', 'active');
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Item[];
}

// 创建商品
export async function createItem(item: {
  name: string;
  description: string | null;
  price: number;
  image_url: string | null;
  expires_at: string | null;
  voucher_validity_days: number | null;
  weekly_limit: number | null;
  stock: number | null;
  created_by: string;
}): Promise<Item> {
  const { data, error } = await supabase
    .from('items').insert(item).select().single();
  if (error) throw error;
  return data as Item;
}

// 更新商品
export async function updateItem(id: string, patch: Partial<Item>): Promise<Item> {
  const { data, error } = await supabase
    .from('items').update(patch).eq('id', id).select().single();
  if (error) throw error;
  return data as Item;
}

// 删除商品（软删除）
export async function deleteItem(id: string): Promise<void> {
  const { error } = await supabase
    .from('items').update({ status: 'deleted' }).eq('id', id);
  if (error) throw error;
}
