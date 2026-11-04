import { supabase } from './client';

export type MedalSeries = 'streak' | 'collect' | 'daily';

export interface MedalTemplate {
  id: string;
  code: string | null;
  name: string;
  series: MedalSeries;
  threshold: number;
  subcategory: string | null;
  tier: string | null;
  condition_text: string | null;
  description: string | null;
  icon: string | null;
  reward_stars: number;
  reward_card_name: string | null;
  reward_card_count: number;
  is_active: boolean;
  priority: number;
  created_by?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface Medal {
  id: string;
  family_id: string;
  template_id: string | null;
  code: string | null;
  name: string;
  series: MedalSeries;
  threshold: number;
  subcategory: string | null;
  tier: string | null;
  condition_text: string | null;
  description: string | null;
  icon: string | null;
  reward_stars: number;
  reward_card_name: string | null;
  reward_card_count: number;
  reward_item_id: string | null;
  is_active: boolean;
  priority: number;
  created_at?: string;
  updated_at?: string;
}

export interface MemberMedal {
  id: string;
  family_id: string;
  member_id: string;
  medal_id: string;
  count: number;
  first_earned_at: string;
  last_earned_at: string;
}

export interface MedalInput {
  code?: string | null;
  name: string;
  series: MedalSeries;
  threshold: number;
  subcategory?: string | null;
  tier?: string | null;
  condition_text?: string | null;
  description?: string | null;
  icon?: string | null;
  reward_stars?: number;
  reward_card_name?: string | null;
  reward_card_count?: number;
  reward_item_id?: string | null;
  is_active?: boolean;
  priority?: number;
}

export const MEDAL_SERIES_LABELS: Record<MedalSeries, string> = {
  streak: '连续打卡',
  collect: '分类集齐',
  daily: '当日活跃',
};

// ==================== 公共勋章模板库 ====================

export async function listMedalTemplates(): Promise<MedalTemplate[]> {
  const { data, error } = await supabase
    .from('medal_templates')
    .select('*')
    .order('priority', { ascending: true });
  if (error) throw error;
  return (data ?? []) as MedalTemplate[];
}

export async function createMedalTemplate(input: MedalInput): Promise<MedalTemplate> {
  const { data, error } = await supabase
    .from('medal_templates')
    .insert({ ...input })
    .select('*')
    .single();
  if (error) throw error;
  return data as MedalTemplate;
}

export async function updateMedalTemplate(id: string, input: Partial<MedalInput>): Promise<void> {
  const { error } = await supabase.from('medal_templates').update(input).eq('id', id);
  if (error) throw error;
}

export async function deleteMedalTemplate(id: string): Promise<void> {
  const { error } = await supabase.from('medal_templates').delete().eq('id', id);
  if (error) throw error;
}

// ==================== 个人（家庭）勋章库 ====================

export async function listFamilyMedals(familyId: string): Promise<Medal[]> {
  const { data, error } = await supabase
    .from('medals')
    .select('*')
    .eq('family_id', familyId)
    .order('priority', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Medal[];
}

export async function createMedal(familyId: string, createdBy: string, input: MedalInput): Promise<Medal> {
  const { data, error } = await supabase
    .from('medals')
    .insert({ family_id: familyId, created_by: createdBy, ...input })
    .select('*')
    .single();
  if (error) throw error;
  return data as Medal;
}

export async function updateMedal(id: string, input: Partial<MedalInput>): Promise<void> {
  const { error } = await supabase.from('medals').update(input).eq('id', id);
  if (error) throw error;
}

export async function deleteMedal(id: string): Promise<void> {
  const { error } = await supabase.from('medals').delete().eq('id', id);
  if (error) throw error;
}

// 引用公共模板 = 复制一份独立副本到本家庭勋章库（保留来源模板 id，便于追溯）
export async function copyTemplateToFamily(
  familyId: string, createdBy: string, t: MedalTemplate,
): Promise<Medal> {
  return createMedal(familyId, createdBy, {
    code: t.code,
    name: t.name,
    series: t.series,
    threshold: t.threshold,
    subcategory: t.subcategory,
    tier: t.tier,
    condition_text: t.condition_text,
    description: t.description,
    icon: t.icon,
    reward_stars: t.reward_stars,
    reward_card_name: t.reward_card_name,
    reward_card_count: t.reward_card_count,
    is_active: true,
    priority: t.priority,
  });
}

// ==================== 孩子持有情况 ====================

export async function listMemberMedals(memberId: string): Promise<MemberMedal[]> {
  const { data, error } = await supabase
    .from('member_medals')
    .select('*')
    .eq('member_id', memberId);
  if (error) throw error;
  return (data ?? []) as MemberMedal[];
}

// 成就卡打卡统计（近 N 天打卡日期 + 当前连续 + 历史最佳连续）
export interface TaskCheckinStats {
  dates: string[];
  current_streak: number;
  best_streak: number;
}

export async function fetchTaskCheckinStats(
  taskId: string, memberId: string, days = 21,
): Promise<TaskCheckinStats> {
  const { data, error } = await supabase.rpc('get_task_checkin_stats', {
    p_task_id: taskId,
    p_member_id: memberId,
    p_days: days,
  });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as TaskCheckinStats | null;
  return {
    dates: row?.dates ?? [],
    current_streak: row?.current_streak ?? 0,
    best_streak: row?.best_streak ?? 0,
  };
}
