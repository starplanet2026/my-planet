import { useMemo } from 'react';
import { useRealtimeTable } from './useRealtimeTable';
import { useFamilyStore } from '../store/familyStore';
import { fetchTasks, createTask, updateTask, deleteTask, publishTasks, completeTask, requestCompleteTask, approveTask, rejectTask, publishTask, offlineTask, refreshAndExpireTasks, fetchTaskTemplates, saveTaskTemplate, deleteTaskTemplate } from '../api/tasks';
import type { Task, TaskTemplate, TaskCategory, CompleteTaskResult } from '../api/types';

export function useTasks(category?: TaskCategory) {
  const familyId = useFamilyStore(s => s.family?.id);

  const filter = familyId ? `family_id=eq.${familyId}` : undefined;

  const { rows: tasks, loading, refresh } = useRealtimeTable<Task>({
    table: 'tasks',
    filter,
    fetchFn: async () => {
      if (!familyId) return [];
      await refreshAndExpireTasks(familyId);
      return fetchTasks(familyId, category);
    },
    enabled: !!familyId,
  });

  const filtered = useMemo(() => {
    if (category) return tasks.filter(t => t.category === category);
    return tasks;
  }, [tasks, category]);

  return {
    tasks: filtered,
    allTasks: tasks,
    loading,
    refresh,
    createTask,
    updateTask,
    deleteTask,
    publishTasks,
    completeTask: (taskId: string, memberId: string): Promise<CompleteTaskResult> =>
      completeTask(taskId, memberId),
    requestCompleteTask: (taskId: string, memberId: string): Promise<void> =>
      requestCompleteTask(taskId, memberId),
    approveTask: (taskId: string): Promise<CompleteTaskResult> =>
      approveTask(taskId),
    rejectTask: (taskId: string, reason?: string): Promise<void> =>
      rejectTask(taskId, reason),
    publishTask: (taskId: string): Promise<void> => publishTask(taskId),
    offlineTask: (taskId: string): Promise<void> => offlineTask(taskId),
    refreshAndExpireTasks: (fid: string): Promise<void> => refreshAndExpireTasks(fid),
  };
}

export function useTaskTemplates() {
  const { rows: templates, loading } = useRealtimeTable<TaskTemplate>({
    table: 'task_templates',
    fetchFn: () => fetchTaskTemplates(),
  });

  return {
    templates,
    loading,
    saveTemplate: saveTaskTemplate,
    deleteTemplate: deleteTaskTemplate,
  };
}
