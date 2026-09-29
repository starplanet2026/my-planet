import { supabase } from './client';
import type {
  RecitationTask, RecitationInstance, RecitationTaskInput,
  RecitationTaskStatus, RecitationInstanceStatus,
  PublishRecitationResult, SubmitRecitationResult, RecitationSubject,
} from './types';

// ==================== 模板 CRUD ====================

export async function listRecitationTasks(
  familyId: string,
  opts?: { status?: RecitationTaskStatus; subject?: RecitationSubject },
): Promise<RecitationTask[]> {
  let q = supabase
    .from('recitation_tasks')
    .select('*')
    .eq('family_id', familyId)
    .order('created_at', { ascending: false });
  if (opts?.status) q = q.eq('status', opts.status);
  if (opts?.subject) q = q.eq('subject', opts.subject);
  const { data, error } = await q;
  if (error) throw error;
  return data as RecitationTask[];
}

// 从模板档位配置计算最高星光奖励（服务端计算，前端直接渲染）
export function getTaskMaxStars(task: RecitationTask | null | undefined): number {
  if (!task) return 0;
  const stars = [task.reward_tier1_stars, task.reward_tier2_stars, task.reward_tier3_stars]
    .filter((s): s is number => s !== null && s !== undefined);
  return stars.length > 0 ? Math.max(...stars) : 0;
}

export async function getRecitationTask(id: string): Promise<RecitationTask> {
  const { data, error } = await supabase
    .from('recitation_tasks')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data as RecitationTask;
}

export async function createRecitationTask(input: RecitationTaskInput): Promise<RecitationTask> {
  const { data, error } = await supabase
    .from('recitation_tasks')
    .insert({ ...input, status: 'saved' })
    .select('*')
    .single();
  if (error) throw error;
  return data as RecitationTask;
}

export async function updateRecitationTask(id: string, patch: Partial<RecitationTaskInput>): Promise<void> {
  const { error } = await supabase.from('recitation_tasks').update(patch).eq('id', id);
  if (error) throw error;
}

export async function deleteRecitationTask(id: string): Promise<void> {
  const { error } = await supabase.from('recitation_tasks').delete().eq('id', id);
  if (error) throw error;
}

// ==================== 学生作业实例 ====================

export async function listStudentInstances(
  memberId: string,
  status?: RecitationInstanceStatus,
): Promise<RecitationInstance[]> {
  let q = supabase
    .from('recitation_instances')
    .select('*, task:recitation_tasks(*)')
    .eq('member_id', memberId)
    .order('created_at', { ascending: false });
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as RecitationInstance[];
}

export async function getInstance(id: string): Promise<RecitationInstance> {
  const { data, error } = await supabase
    .from('recitation_instances')
    .select('*, task:recitation_tasks(*)')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data as unknown as RecitationInstance;
}

// 家长查看某模板下所有学生的提交/未提交实例
export async function listTaskSubmissions(taskId: string): Promise<RecitationInstance[]> {
  const { data, error } = await supabase
    .from('recitation_instances')
    .select('*, task:recitation_tasks(*)')
    .eq('task_id', taskId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as RecitationInstance[];
}

// 家长查看家庭下所有学生的提交/未提交实例（不按任务筛选）
export async function listFamilySubmissions(familyId: string): Promise<RecitationInstance[]> {
  const { data, error } = await supabase
    .from('recitation_instances')
    .select('*, task:recitation_tasks(*)')
    .eq('family_id', familyId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as RecitationInstance[];
}

// ==================== RPC：发布 / 提交 / 下线 ====================

export async function publishRecitationTask(
  taskId: string,
  memberIds: string[],
): Promise<PublishRecitationResult> {
  const { data, error } = await supabase.rpc('publish_recitation_task', {
    p_task_id: taskId,
    p_member_ids: memberIds,
  });
  if (error) throw error;
  const row = (data as any[])?.[0];
  return {
    success: row?.success ?? false,
    message: row?.message ?? '',
    published_count: row?.published_count ?? 0,
  };
}

export async function submitRecitationResult(
  instanceId: string,
  memberId: string,
  score: number,
  recognizedText: string,
): Promise<SubmitRecitationResult> {
  const { data, error } = await supabase.rpc('submit_recitation_result', {
    p_instance_id: instanceId,
    p_member_id: memberId,
    p_score: score,
    p_recognized_text: recognizedText,
  });
  if (error) throw error;
  const row = (data as any[])?.[0];
  return {
    success: row?.success ?? false,
    message: row?.message ?? '',
    passed: row?.passed ?? false,
    awarded_stars: row?.awarded_stars ?? 0,
    new_star: row?.new_star ?? 0,
  };
}

export async function offlineRecitationTask(taskId: string): Promise<void> {
  const { error } = await supabase.rpc('offline_recitation_task', {
    p_task_id: taskId,
  });
  if (error) throw error;
}

// 按学科获取默认识别语言
export function getRecitationLang(subject: RecitationSubject): string {
  return subject === 'english' ? 'en-US' : 'zh-CN';
}
