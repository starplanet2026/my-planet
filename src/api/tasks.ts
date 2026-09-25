import { supabase } from './client';
import type { Task, TaskTemplate, TaskCategory, TaskCategoryItem, CompleteTaskResult } from './types';

// 查询任务
export async function fetchTasks(familyId: string, category?: TaskCategory): Promise<Task[]> {
  let q = supabase
    .from('tasks')
    .select('*')
    .eq('family_id', familyId)
    .order('created_at', { ascending: false });
  if (category) q = q.eq('category', category);
  const { data, error } = await q;
  if (error) throw error;
  // 按优先级降序排列（数值越大越靠前），优先级相同时按 sort_order 升序
  return ((data ?? []) as Task[]).sort((a, b) =>
    (b.priority ?? 0) - (a.priority ?? 0) || (a.sort_order ?? 999) - (b.sort_order ?? 999)
  );
}

// 批量更新任务排序（拖拽后按新顺序写入 priority，数值越大越靠前）
export async function updateTaskOrder(taskIds: string[]): Promise<void> {
  const total = taskIds.length;
  const updates = taskIds.map((id, idx) => ({ id, priority: (total - idx) * 10 }));
  const { error } = await supabase
    .from('tasks')
    .upsert(updates, { onConflict: 'id' });
  if (error) throw error;
}

// 更新单个任务优先级
export async function updateTaskPriority(id: string, priority: number): Promise<Task> {
  const { data, error } = await supabase
    .from('tasks')
    .update({ priority })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data as Task;
}

// ====== 任务分类 ======

// 查询分类（默认分类 + 该家庭自定义分类）
export async function fetchTaskCategories(familyId: string): Promise<TaskCategoryItem[]> {
  const { data, error } = await supabase
    .from('task_categories')
    .select('*')
    .or(`family_id.is.null,family_id.eq.${familyId}`)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as TaskCategoryItem[];
}

// 新建自定义分类（key 自动生成 UUID）
export async function createTaskCategory(familyId: string, name: string): Promise<TaskCategoryItem> {
  const key = `custom_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const { data, error } = await supabase
    .from('task_categories')
    .insert({ family_id: familyId, key, name, is_default: false, sort_order: 100 })
    .select()
    .single();
  if (error) throw error;
  return data as TaskCategoryItem;
}

// 重命名分类（默认分类也可改名）
export async function updateTaskCategory(id: string, name: string): Promise<TaskCategoryItem> {
  const { data, error } = await supabase
    .from('task_categories')
    .update({ name })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data as TaskCategoryItem;
}

// 删除分类（仅非默认分类可删；删除后该分类下任务需家长手动迁移，这里仅限制 is_default=false）
export async function deleteTaskCategory(id: string): Promise<void> {
  const { error } = await supabase
    .from('task_categories')
    .delete()
    .eq('id', id)
    .eq('is_default', false);
  if (error) throw error;
}

// 创建任务
export async function createTask(task: {
  family_id: string;
  member_id: string | null;
  title: string;
  description: string | null;
  category: TaskCategory;
  reward_coins: number;
  deadline: string | null;
  created_by: string;
  icon?: string | null;
  repeat_days?: number[] | null;
}): Promise<Task> {
  const { data, error } = await supabase
    .from('tasks').insert(task).select().single();
  if (error) throw error;
  return data as Task;
}

// 更新任务
export async function updateTask(id: string, patch: Partial<Task>): Promise<Task> {
  const { data, error } = await supabase
    .from('tasks').update(patch).eq('id', id).select().single();
  if (error) throw error;
  return data as Task;
}

// 删除任务（软删除）— 默认任务不可删除
export async function deleteTask(id: string): Promise<void> {
  const { error } = await supabase
    .from('tasks').update({ status: 'deleted' }).eq('id', id).eq('is_default', false);
  if (error) throw error;
}

// 批量发布任务（draft → active）
export async function publishTasks(ids: string[]): Promise<void> {
  const { error } = await supabase
    .from('tasks').update({ status: 'active' }).in('id', ids);
  if (error) throw error;
}

// 批量下架任务（active → draft）
export async function offlineTasks(ids: string[]): Promise<void> {
  const { error } = await supabase
    .from('tasks').update({ status: 'draft' }).in('id', ids);
  if (error) throw error;
}

// 批量删除任务（默认任务除外）
export async function deleteTasks(ids: string[]): Promise<void> {
  const { error } = await supabase
    .from('tasks').update({ status: 'deleted' }).neq('is_default', true).in('id', ids);
  if (error) throw error;
}

// 导入默认成就清单任务
export async function seedDefaultTasks(familyId: string, createdBy: string): Promise<{ success: boolean; message: string; inserted_count: number }> {
  const { data, error } = await supabase.rpc('seed_default_tasks', {
    p_family_id: familyId,
    p_created_by: createdBy,
  });
  if (error) throw error;
  return (Array.isArray(data) ? data[0] : data) as { success: boolean; message: string; inserted_count: number };
}

// 完成任务（RPC 原子操作）
export async function completeTask(taskId: string, memberId: string): Promise<CompleteTaskResult> {
  const { data, error } = await supabase.rpc('complete_task', {
    p_task_id: taskId,
    p_member_id: memberId,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row as CompleteTaskResult;
}

// 孩子请求完成任务（status → pending_approval，不加金币）
export async function requestCompleteTask(taskId: string, memberId: string): Promise<void> {
  const { error } = await supabase.rpc('request_complete_task', {
    p_task_id: taskId,
    p_member_id: memberId,
  });
  if (error) throw error;
}

// 重复任务跨天重新提交
// 当重复任务在前一天已提交（pending_approval）但家长未确认时，孩子可在新一天重新提交
// 保持 status = pending_approval，仅更新 completed_at / completed_by 时间戳，家长端仍可见该待审批记录
export async function resubmitRepeatingTask(taskId: string, memberId: string): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('tasks')
    .update({
      completed_by: memberId,
      completed_at: now,
      updated_at: now,
    })
    .eq('id', taskId)
    .eq('status', 'pending_approval');
  if (error) throw error;
}

// 家长确认完成任务 → 加减金币 → 记账
export async function approveTask(taskId: string): Promise<CompleteTaskResult> {
  const { data, error } = await supabase.rpc('approve_task', {
    p_task_id: taskId,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row as CompleteTaskResult;
}

// 家长拒绝完成 → 退回 active 状态（可附退回原因）
export async function rejectTask(taskId: string, reason?: string): Promise<void> {
  const { error } = await supabase.rpc('reject_task', {
    p_task_id: taskId,
    p_reason: reason ?? null,
  });
  if (error) throw error;
}

// 单个任务发布（draft → active）
export async function publishTask(taskId: string): Promise<void> {
  const { error } = await supabase.rpc('publish_task', { p_task_id: taskId });
  if (error) throw error;
}

// 单个任务下线（active → draft）
export async function offlineTask(taskId: string): Promise<void> {
  const { error } = await supabase.rpc('offline_task', { p_task_id: taskId });
  if (error) throw error;
}

// 自动过期 + 刷新重复任务（每次加载任务列表前调用）
export async function refreshAndExpireTasks(familyId: string): Promise<void> {
  const { error: e1 } = await supabase.rpc('expire_tasks', { p_family_id: familyId });
  if (e1) throw e1;
  const { error: e2 } = await supabase.rpc('refresh_repeat_tasks', { p_family_id: familyId });
  if (e2) throw e2;
}

// ---- 模板 ----

export async function fetchTaskTemplates(): Promise<TaskTemplate[]> {
  const { data, error } = await supabase
    .from('task_templates').select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as TaskTemplate[];
}

export async function saveTaskTemplate(template: {
  title: string;
  description: string | null;
  category: TaskCategory;
  reward_coins: number;
}): Promise<TaskTemplate> {
  const { data, error } = await supabase
    .from('task_templates').insert(template).select().single();
  if (error) throw error;
  return data as TaskTemplate;
}

export async function deleteTaskTemplate(id: string): Promise<void> {
  const { error } = await supabase.from('task_templates').delete().eq('id', id);
  if (error) throw error;
}
