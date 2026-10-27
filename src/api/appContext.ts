import { supabase } from './client';

// 应用级权限上下文：当前账号是否超级管理员 + 各新功能是否已「应用全局」
export interface AppContext {
  isSuperAdmin: boolean;
  features: Record<string, boolean>;
}

export interface FeatureFlag {
  key: string;
  name: string;
  description: string | null;
  is_global: boolean;
  sort_order: number;
}

export async function fetchAppContext(): Promise<AppContext> {
  const { data, error } = await supabase.rpc('get_my_app_context');
  if (error) throw error;
  const ctx = (data ?? {}) as { is_super_admin?: boolean; features?: Record<string, boolean> };
  return { isSuperAdmin: !!ctx.is_super_admin, features: ctx.features ?? {} };
}

// 仅超级管理员可操作（数据库策略已限制）
export async function listFeatureFlags(): Promise<FeatureFlag[]> {
  const { data, error } = await supabase
    .from('app_feature_flags')
    .select('*')
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return (data ?? []) as FeatureFlag[];
}

export async function setFeatureGlobal(key: string, enabled: boolean): Promise<void> {
  const { error } = await supabase
    .from('app_feature_flags')
    .update({ is_global: enabled, updated_at: new Date().toISOString() })
    .eq('key', key);
  if (error) throw error;
}
