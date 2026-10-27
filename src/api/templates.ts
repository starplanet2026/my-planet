import { supabase } from './client';

// ==================== 公共模板库：成就模板 ====================

export interface AchievementTemplate {
  id: string;
  title: string;
  description: string | null;
  category: string;
  reward_coins: number;
  icon: string | null;
  repeat_days: number[] | null;
  priority: number;
  is_active: boolean;
  sort_order: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AchievementTemplateInput {
  title: string;
  description?: string | null;
  category: string;
  reward_coins: number;
  icon?: string | null;
  repeat_days?: number[] | null;
  priority?: number;
}

export async function listAchievementTemplates(): Promise<AchievementTemplate[]> {
  const { data, error } = await supabase
    .from('achievement_templates')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as AchievementTemplate[];
}

export async function createAchievementTemplate(
  input: AchievementTemplateInput,
): Promise<AchievementTemplate> {
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('achievement_templates')
    .insert({ ...input, created_by: user?.id ?? null })
    .select('*')
    .single();
  if (error) throw error;
  return data as AchievementTemplate;
}

export async function updateAchievementTemplate(
  id: string,
  patch: Partial<AchievementTemplateInput> & { is_active?: boolean },
): Promise<void> {
  const { error } = await supabase
    .from('achievement_templates')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteAchievementTemplate(id: string): Promise<void> {
  const { error } = await supabase.from('achievement_templates').delete().eq('id', id);
  if (error) throw error;
}

// ==================== 公共模板库：特权模板 ====================

export interface PrivilegeTemplate {
  id: string;
  name: string;
  description: string | null;
  price: number;
  image_url: string | null;
  category: string | null;
  weekly_limit: number | null;
  stock: number | null;
  is_active: boolean;
  sort_order: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PrivilegeTemplateInput {
  name: string;
  description?: string | null;
  price: number;
  image_url?: string | null;
  category?: string | null;
  weekly_limit?: number | null;
  stock?: number | null;
}

export async function listPrivilegeTemplates(): Promise<PrivilegeTemplate[]> {
  const { data, error } = await supabase
    .from('privilege_templates')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as PrivilegeTemplate[];
}

export async function createPrivilegeTemplate(
  input: PrivilegeTemplateInput,
): Promise<PrivilegeTemplate> {
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('privilege_templates')
    .insert({ ...input, created_by: user?.id ?? null })
    .select('*')
    .single();
  if (error) throw error;
  return data as PrivilegeTemplate;
}

export async function updatePrivilegeTemplate(
  id: string,
  patch: Partial<PrivilegeTemplateInput> & { is_active?: boolean },
): Promise<void> {
  const { error } = await supabase
    .from('privilege_templates')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function deletePrivilegeTemplate(id: string): Promise<void> {
  const { error } = await supabase.from('privilege_templates').delete().eq('id', id);
  if (error) throw error;
}
