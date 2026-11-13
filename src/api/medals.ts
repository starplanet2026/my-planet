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

// 补打卡申请：提交后需家长在「成就达成」页审核，通过后补发星光
export interface MakeupRequest {
  id: string;
  family_id: string;
  member_id: string;
  task_id: string;
  checkin_date: string;
  status: 'pending' | 'approved' | 'rejected';
  reject_reason: string | null;
  created_at: string;
  tasks?: { title: string; reward_coins: number; icon: string | null } | null;
  members?: { name: string; avatar_emoji: string | null } | null;
}

export async function requestMakeupCheckin(taskId: string, memberId: string, date: string): Promise<void> {
  const { error } = await supabase.rpc('request_makeup_checkin', {
    p_task_id: taskId,
    p_member_id: memberId,
    p_date: date,
  });
  if (error) throw error;
}

// 孩子端：某任务待审核的补打卡日期（用于日历上显示「审核中」）
export async function listPendingMakeupDates(taskId: string, memberId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('makeup_requests')
    .select('checkin_date')
    .eq('task_id', taskId)
    .eq('member_id', memberId)
    .eq('status', 'pending');
  if (error) throw error;
  return (data ?? []).map((r: any) => r.checkin_date as string);
}

// 家长端：待审核的补打卡申请列表
export async function listPendingMakeupRequests(familyId: string): Promise<MakeupRequest[]> {
  const { data, error } = await supabase
    .from('makeup_requests')
    .select('*, tasks(title, reward_coins, icon), members(name, avatar_emoji)')
    .eq('family_id', familyId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as MakeupRequest[];
}

// 家长端：审核补打卡申请
export async function reviewMakeupRequest(id: string, approve: boolean, reason?: string): Promise<void> {
  const { error } = await supabase.rpc('review_makeup_request', {
    p_request_id: id,
    p_approve: approve,
    p_reason: reason ?? null,
  });
  if (error) throw error;
}

// 勋章进度（陈列馆展示用）
export interface MedalProgressTask {
  task_id: string;
  title: string;
  current_days: number;
  best_days: number;
  gap_days: number;
}

export interface MedalProgress {
  medal_id: string;
  series: MedalSeries;
  current_value: number;
  target_value: number;
  detail: { tasks?: MedalProgressTask[] } | MedalProgressTask[] | null;
}

export async function listMedalProgress(memberId: string): Promise<Record<string, MedalProgress>> {
  const { data, error } = await supabase.rpc('get_medal_progress', { p_member_id: memberId });
  if (error) throw error;
  const map: Record<string, MedalProgress> = {};
  for (const row of (data ?? []) as MedalProgress[]) {
    map[row.medal_id] = row;
  }
  return map;
}

// 解析 streak 进度里的任务明细（jsonb 数组）
export function progressTasks(p: MedalProgress | undefined): MedalProgressTask[] {
  if (!p?.detail) return [];
  if (Array.isArray(p.detail)) return p.detail;
  return p.detail.tasks ?? [];
}
