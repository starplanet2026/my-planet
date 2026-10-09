import { supabase } from './client';
import type {
  DictationSubject, DictationWord, DictationErrorWord, DictationTask,
  DictationTaskWord, DictationTaskMode, SubmitDictationResult,
} from './types';

// ==================== 词条库 ====================

export interface WordFilter {
  textbook_name?: string;
  unit_no?: number;
  page_no?: number;
}

export async function listWords(
  familyId: string,
  subject: DictationSubject,
  filter?: WordFilter,
): Promise<DictationWord[]> {
  let q = supabase
    .from('dictation_words')
    .select('*')
    .eq('family_id', familyId)
    .eq('subject', subject)
    .order('unit_no', { ascending: true })
    .order('page_no', { ascending: true })
    .order('created_at', { ascending: true });
  if (filter?.textbook_name) q = q.eq('textbook_name', filter.textbook_name);
  if (filter?.unit_no != null) q = q.eq('unit_no', filter.unit_no);
  if (filter?.page_no != null) q = q.eq('page_no', filter.page_no);
  const { data, error } = await q;
  if (error) throw error;
  return data as DictationWord[];
}

export async function listWordTextbooks(familyId: string, subject: DictationSubject): Promise<string[]> {
  const { data, error } = await supabase
    .from('dictation_words')
    .select('textbook_name')
    .eq('family_id', familyId)
    .eq('subject', subject);
  if (error) throw error;
  return [...new Set((data ?? []).map(r => r.textbook_name).filter(Boolean))];
}

export async function listWordUnits(familyId: string, subject: DictationSubject, textbook: string): Promise<number[]> {
  const { data, error } = await supabase
    .from('dictation_words')
    .select('unit_no')
    .eq('family_id', familyId)
    .eq('subject', subject)
    .eq('textbook_name', textbook);
  if (error) throw error;
  return [...new Set((data ?? []).map(r => r.unit_no))].sort((a, b) => a - b);
}

export interface WordInput {
  subject: DictationSubject;
  textbook_name: string;
  unit_no: number;
  unit_name: string;
  page_no?: number | null;
  chinese_meaning?: string | null;
  part_of_speech?: string | null;
  pinyin?: string | null;
  answer: string;
}

export async function createWord(familyId: string, input: WordInput): Promise<DictationWord> {
  const { data, error } = await supabase
    .from('dictation_words')
    .insert({ family_id: familyId, ...input })
    .select('*')
    .single();
  if (error) throw error;
  return data as DictationWord;
}

export async function updateWord(id: string, input: Partial<WordInput>): Promise<void> {
  const { error } = await supabase.from('dictation_words').update(input).eq('id', id);
  if (error) throw error;
}

export async function deleteWords(ids: string[]): Promise<void> {
  const { error } = await supabase.from('dictation_words').delete().in('id', ids);
  if (error) throw error;
}

// 批量导入词条（带重复校验：同 family+subject+textbook+unit_no+answer）
export interface ImportResult {
  success: number;
  duplicate: number;
  failed: number;
}

export async function importWords(
  familyId: string,
  subject: DictationSubject,
  rows: WordInput[],
): Promise<ImportResult> {
  let success = 0, duplicate = 0, failed = 0;
  for (const row of rows) {
    try {
      // 重复校验
      const { data: existing } = await supabase
        .from('dictation_words')
        .select('id')
        .eq('family_id', familyId)
        .eq('subject', subject)
        .eq('textbook_name', row.textbook_name)
        .eq('unit_no', row.unit_no)
        .eq('answer', row.answer)
        .limit(1);
      if (existing && existing.length > 0) {
        duplicate++;
        continue;
      }
      await createWord(familyId, row);
      success++;
    } catch {
      failed++;
    }
  }
  return { success, duplicate, failed };
}

// ==================== 错词库 ====================

export async function listErrorWords(memberId: string, subject?: DictationSubject): Promise<DictationErrorWord[]> {
  let q = supabase
    .from('dictation_error_words')
    .select('*')
    .eq('member_id', memberId)
    .order('next_review_date', { ascending: true });
  if (subject) q = q.eq('subject', subject);
  const { data, error } = await q;
  if (error) throw error;
  return data as DictationErrorWord[];
}

// 到期错词候选：next_review_date <= today 且 in_progress
export async function listDueErrorWords(memberId: string, subject: DictationSubject): Promise<DictationErrorWord[]> {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('dictation_error_words')
    .select('*')
    .eq('member_id', memberId)
    .eq('subject', subject)
    .eq('status', 'in_progress')
    .lte('next_review_date', today)
    .order('next_review_date', { ascending: true });
  if (error) throw error;
  return data as DictationErrorWord[];
}

export interface ErrorWordInput {
  subject: DictationSubject;
  textbook_name?: string;
  unit_no?: number;
  unit_name?: string;
  page_no?: number | null;
  chinese_meaning?: string | null;
  part_of_speech?: string | null;
  pinyin?: string | null;
  answer: string;
}

export async function createErrorWord(memberId: string, input: ErrorWordInput): Promise<DictationErrorWord> {
  const today = new Date().toISOString().slice(0, 10);
  const nextDate = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('dictation_error_words')
    .insert({
      member_id: memberId,
      subject: input.subject,
      textbook_name: input.textbook_name ?? '',
      unit_no: input.unit_no ?? 0,
      unit_name: input.unit_name ?? '',
      page_no: input.page_no ?? null,
      chinese_meaning: input.chinese_meaning ?? null,
      part_of_speech: input.part_of_speech ?? null,
      pinyin: input.pinyin ?? null,
      answer: input.answer,
      cycle_start_date: today,
      current_node: 1,
      next_review_date: nextDate,
      status: 'in_progress',
      last_review_date: null,
      review_history: [],
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as DictationErrorWord;
}

// 批量删除错词（仅删除个人错词记录，不影响基础词条库）
export async function deleteErrorWords(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase.from('dictation_error_words').delete().in('id', ids);
  if (error) throw error;
}

export async function importErrorWords(
  memberId: string,
  subject: DictationSubject,
  rows: ErrorWordInput[],
): Promise<ImportResult> {
  let success = 0, duplicate = 0, failed = 0;
  for (const row of rows) {
    try {
      const { data: existing } = await supabase
        .from('dictation_error_words')
        .select('id')
        .eq('member_id', memberId)
        .eq('subject', subject)
        .eq('answer', row.answer)
        .limit(1);
      if (existing && existing.length > 0) { duplicate++; continue; }
      await createErrorWord(memberId, { ...row, subject });
      success++;
    } catch {
      failed++;
    }
  }
  return { success, duplicate, failed };
}

// ==================== 任务 ====================

export async function listTasks(memberId: string, subject?: DictationSubject): Promise<DictationTask[]> {
  let q = supabase
    .from('dictation_tasks')
    .select('*')
    .eq('member_id', memberId)
    .order('created_at', { ascending: false });
  if (subject) q = q.eq('subject', subject);
  const { data, error } = await q;
  if (error) throw error;
  return data as DictationTask[];
}

export async function getActiveTask(memberId: string, subject: DictationSubject): Promise<DictationTask | null> {
  const { data, error } = await supabase
    .from('dictation_tasks')
    .select('*')
    .eq('member_id', memberId)
    .eq('subject', subject)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw error;
  return (data?.[0] ?? null) as DictationTask | null;
}

// 按 ID 加载指定任务（用于多任务场景下从入口卡片直达指定任务）
export async function getTaskById(taskId: string): Promise<DictationTask | null> {
  const { data, error } = await supabase
    .from('dictation_tasks')
    .select('*')
    .eq('id', taskId)
    .single();
  if (error) throw error;
  return (data ?? null) as DictationTask | null;
}

export interface CreateTaskPayload {
  family_id: string;
  member_id: string;
  subject: DictationSubject;
  title: string;
  task_date?: string | null;
  star_per_word: number;
  mode?: DictationTaskMode;
}

export async function createTask(payload: CreateTaskPayload): Promise<DictationTask> {
  const { data, error } = await supabase
    .from('dictation_tasks')
    .insert({ ...payload, status: 'active', mode: payload.mode ?? 'dictation' })
    .select('*')
    .single();
  if (error) throw error;
  return data as DictationTask;
}

export interface TaskWordInput {
  word_id?: string | null;
  error_word_id?: string | null;
  textbook_name: string;
  unit_no: number;
  unit_name: string;
  page_no?: number | null;
  chinese_meaning?: string | null;
  part_of_speech?: string | null;
  pinyin?: string | null;
  answer: string;
  is_temporary: boolean;
  save_to_library: boolean;
}

export async function deleteTask(taskId: string): Promise<void> {
  const { error } = await supabase.from('dictation_tasks').delete().eq('id', taskId);
  if (error) throw error;
}

// 上线/下线任务（active / offline）
export async function updateTaskStatus(taskId: string, status: 'active' | 'offline'): Promise<void> {
  const { error } = await supabase
    .from('dictation_tasks')
    .update({ status })
    .eq('id', taskId);
  if (error) throw error;
}

// 修改任务星光值（仅当前任务，不影响基础词条库）
export async function updateTaskStarPerWord(taskId: string, starPerWord: number): Promise<void> {
  const { error } = await supabase
    .from('dictation_tasks')
    .update({ star_per_word: starPerWord })
    .eq('id', taskId);
  if (error) throw error;
}

export async function addTaskWords(taskId: string, words: TaskWordInput[]): Promise<void> {
  if (words.length === 0) return;
  const rows = words.map(w => ({ task_id: taskId, ...w }));
  const { error } = await supabase.from('dictation_task_words').insert(rows);
  if (error) throw error;
}

export async function listTaskWords(taskId: string): Promise<DictationTaskWord[]> {
  const { data, error } = await supabase
    .from('dictation_task_words')
    .select('*')
    .eq('task_id', taskId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data as DictationTaskWord[];
}

// 批量获取多个任务的词条数量
export async function getTaskWordCounts(taskIds: string[]): Promise<Record<string, number>> {
  if (taskIds.length === 0) return {};
  const { data, error } = await supabase
    .from('dictation_task_words')
    .select('task_id')
    .in('task_id', taskIds);
  if (error) throw error;
  const counts: Record<string, number> = {};
  (data ?? []).forEach(row => {
    const tid = row.task_id as string;
    counts[tid] = (counts[tid] ?? 0) + 1;
  });
  return counts;
}

export async function removeTaskWord(id: string): Promise<void> {
  const { error } = await supabase.from('dictation_task_words').delete().eq('id', id);
  if (error) throw error;
}

// ==================== 批改 ====================

export interface DictationResultItem {
  word_id?: string | null;
  error_word_id?: string | null;
  word_text: string;
  answer: string;
  is_correct: boolean;
}

export async function submitDictationResult(
  taskId: string,
  memberId: string,
  results: DictationResultItem[],
): Promise<SubmitDictationResult> {
  const { data, error } = await supabase.rpc('submit_dictation_result', {
    p_task_id: taskId,
    p_member_id: memberId,
    p_results: results,
  });
  if (error) throw error;
  const row = (data as any[])?.[0];
  return {
    success: row?.success ?? false,
    message: row?.message ?? '',
    correct_count: row?.correct_count ?? 0,
    error_count: row?.error_count ?? 0,
    total_star: row?.total_star ?? 0,
    new_star: row?.new_star ?? 0,
  };
}

// ==================== 快速复习模式 ====================

export interface QuickReviewResult {
  success: boolean;
  message: string;
  new_star: number;
}

// 快速复习单条判题（正确→加星光值，错误→存入错词库，即时生效）
export async function judgeQuickReviewWord(
  taskId: string,
  memberId: string,
  word: DictationTaskWord,
  subject: DictationSubject,
  isCorrect: boolean,
  starPerWord: number,
): Promise<QuickReviewResult> {
  const wordData = {
    word_id: word.word_id ?? null,
    error_word_id: word.error_word_id ?? null,
    answer: word.answer,
    word_text: subject === 'english' ? (word.chinese_meaning ?? '') : (word.pinyin ?? ''),
    subject,
    textbook_name: word.textbook_name,
    unit_no: word.unit_no,
    unit_name: word.unit_name,
    page_no: word.page_no,
    chinese_meaning: word.chinese_meaning,
    part_of_speech: word.part_of_speech,
    pinyin: word.pinyin,
  };
  const { data, error } = await supabase.rpc('judge_quick_review_word', {
    p_task_id: taskId,
    p_member_id: memberId,
    p_word: wordData,
    p_is_correct: isCorrect,
    p_star_per_word: starPerWord,
  });
  if (error) throw error;
  const row = (data as any[])?.[0];
  return {
    success: row?.success ?? false,
    message: row?.message ?? '',
    new_star: row?.new_star ?? 0,
  };
}
