import { supabase } from './client';
import type {
  ChallengeSet, Question, Word, WordProgress,
  AnswerQuestionResult, AnswerWordResult, ReviewWrongResult,
  ChallengeSetType, QuestionType, Difficulty, ChallengeAnalysisItem,
} from './types';

// ====== ChallengeSet 题集 ======

export async function fetchChallengeSets(type?: ChallengeSetType): Promise<ChallengeSet[]> {
  let q = supabase.from('challenge_sets').select('*').order('created_at', { ascending: false });
  if (type) q = q.eq('type', type);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as ChallengeSet[];
}

export async function createChallengeSet(data: {
  title: string;
  description?: string;
  type: ChallengeSetType;
  reward_easy: number;
  reward_medium: number;
  reward_hard: number;
  knowledge_points?: string;
}): Promise<ChallengeSet> {
  const { data: result, error } = await supabase
    .from('challenge_sets')
    .insert({ ...data, status: 'draft' })
    .select()
    .single();
  if (error) throw error;
  return result as ChallengeSet;
}

export async function updateChallengeSet(id: string, patch: Partial<ChallengeSet>): Promise<ChallengeSet> {
  const { data, error } = await supabase
    .from('challenge_sets')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data as ChallengeSet;
}

export async function deleteChallengeSet(id: string): Promise<void> {
  const { error } = await supabase.from('challenge_sets').delete().eq('id', id);
  if (error) throw error;
}

export async function publishChallengeSet(id: string): Promise<void> {
  const { error } = await supabase.from('challenge_sets').update({ status: 'active' }).eq('id', id);
  if (error) throw error;
}

// ====== Question 题目（选择题/数学） ======

export async function fetchQuestions(setId: string): Promise<Question[]> {
  const { data, error } = await supabase
    .from('questions')
    .select('*')
    .eq('challenge_set_id', setId)
    .order('created_at');
  if (error) throw error;
  // 前端按 display_order 排序（迁移未执行时字段为 undefined，不影响）
  return ((data ?? []) as Question[]).sort((a, b) => (a.display_order ?? 999) - (b.display_order ?? 999));
}

// 获取该题集中未掌握的题目（is_mastered=false 或 question_progress 不存在）
// 用于"做对自动下线，重做时只出现错题"逻辑
export async function fetchActiveQuestions(setId: string, memberId: string): Promise<Question[]> {
  // 先取所有题目
  const { data: questions, error: qErr } = await supabase
    .from('questions')
    .select('*')
    .eq('challenge_set_id', setId)
    .order('created_at');
  if (qErr) throw qErr;
  const sorted = ((questions ?? []) as Question[]).sort((a, b) =>
    (a.display_order ?? 999) - (b.display_order ?? 999));

  // 强制下线（is_active=false）的题不出现
  const active = sorted.filter(q => q.is_active !== false);

  // 再取已掌握题目
  const { data: progresses, error: pErr } = await supabase
    .from('question_progress')
    .select('question_id, is_mastered')
    .eq('member_id', memberId);
  if (pErr && !pErr.message.includes('question_progress')) throw pErr;

  const masteredIds = new Set(
    (progresses ?? []).filter(p => p.is_mastered).map(p => p.question_id)
  );

  // 过滤掉已掌握的题（首次挑战时这批题为空，会全部展示）
  return active.filter(q => !masteredIds.has(q.id));
}

export async function createQuestion(data: {
  challenge_set_id: string;
  type: QuestionType;
  question_text: string;
  options?: string[];
  correct_answer: string;
  explanation?: string;
  difficulty?: Difficulty;
  display_order?: number;
}): Promise<Question> {
  const { data: result, error } = await supabase
    .from('questions')
    .insert(data)
    .select()
    .single();
  if (error) throw error;
  return result as Question;
}

export async function deleteQuestion(id: string): Promise<void> {
  const { error } = await supabase.from('questions').delete().eq('id', id);
  if (error) throw error;
}

// 批量删除题目
export async function deleteQuestionsBatch(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase.from('questions').delete().in('id', ids);
  if (error) throw error;
}

// 批量上线/下线题目（is_active: true=上线, false=下线）
export async function setQuestionsActiveBatch(ids: string[], isActive: boolean): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase.from('questions').update({ is_active: isActive }).in('id', ids);
  if (error && !error.message.includes('is_active')) throw error;
}

// 批量更新题目排序
export async function updateQuestionOrder(updates: { id: string; display_order: number }[]): Promise<void> {
  if (updates.length === 0) return;
  const { error } = await supabase
    .from('questions')
    .upsert(updates, { onConflict: 'id' });
  // 列不存在时静默失败（迁移未执行）
  if (error && !error.message.includes('display_order')) throw error;
}

export async function updateQuestion(id: string, patch: Partial<Omit<Question, 'id' | 'challenge_set_id' | 'created_at'>>): Promise<Question> {
  const { data, error } = await supabase
    .from('questions')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data as Question;
}

// 批量创建题目（用于 Excel 导入）
export async function createQuestionsBatch(
  questions: Array<{
    challenge_set_id: string;
    type: QuestionType;
    question_text: string;
    options?: string[];
    correct_answer: string;
    explanation?: string;
    difficulty?: Difficulty;
    display_order?: number;
  }>
): Promise<void> {
  if (questions.length === 0) return;
  const { error } = await supabase.from('questions').insert(questions);
  if (error) throw error;
}

// ====== Word 单词 ======

export async function fetchWords(setId: string): Promise<Word[]> {
  const { data, error } = await supabase
    .from('words')
    .select('*')
    .eq('challenge_set_id', setId)
    .order('created_at');
  if (error) throw error;
  return (data ?? []) as Word[];
}

export async function createWord(data: {
  challenge_set_id: string;
  word_en: string;
  word_cn: string;
  phonetic?: string;
  example_sentence?: string;
}): Promise<Word> {
  const { data: result, error } = await supabase
    .from('words')
    .insert(data)
    .select()
    .single();
  if (error) throw error;
  return result as Word;
}

export async function deleteWord(id: string): Promise<void> {
  const { error } = await supabase.from('words').delete().eq('id', id);
  if (error) throw error;
}

// 批量创建单词
export async function createWordsBatch(words: Array<{
  challenge_set_id: string;
  word_en: string;
  word_cn: string;
  phonetic?: string;
  example_sentence?: string;
}>): Promise<void> {
  const { error } = await supabase.from('words').insert(words);
  if (error) throw error;
}

// ====== WordProgress 单词进度 ======

export async function fetchWordProgress(memberId: string, setId: string): Promise<(Word & { progress?: WordProgress })[]> {
  const { data: words, error: wErr } = await supabase
    .from('words')
    .select('*')
    .eq('challenge_set_id', setId);
  if (wErr) throw wErr;

  const { data: progresses, error: pErr } = await supabase
    .from('word_progress')
    .select('*')
    .eq('member_id', memberId);
  if (pErr) throw pErr;

  const progMap = new Map((progresses ?? []).map(p => [p.word_id, p]));
  return (words ?? []).map(w => ({ ...w, progress: progMap.get(w.id) }));
}

// ====== 答题 RPC ======

export async function answerQuestion(
  memberId: string,
  questionId: string,
  answer: string
): Promise<AnswerQuestionResult> {
  const { data, error } = await supabase.rpc('answer_question', {
    p_member_id: memberId,
    p_question_id: questionId,
    p_answer: answer,
  });
  if (error) throw error;
  // answer_question 是 returns table 的集合函数，rpc 返回数组，取首行
  const row = Array.isArray(data) ? data[0] : data;
  return row as AnswerQuestionResult;
}

// 获取用户对该题集所有题目的挑战分析（尝试次数/答对次数/是否掌握）
export async function getChallengeAnalysis(memberId: string, setId: string): Promise<ChallengeAnalysisItem[]> {
  const { data, error } = await supabase.rpc('get_challenge_analysis', {
    p_member_id: memberId,
    p_set_id: setId,
  });
  if (error) throw error;
  return (data ?? []) as ChallengeAnalysisItem[];
}

// 挑战结束页正确率100%时调用，一次性奖励10星光
// 返回 { awarded, bonus, new_star }；awarded=false 表示未达到条件或已发过
export async function awardPerfectChallengeBonus(memberId: string, challengeSetId: string): Promise<{ awarded: boolean; bonus: number; new_star: number }> {
  const { data, error } = await supabase.rpc('award_perfect_challenge_bonus', {
    p_member_id: memberId,
    p_challenge_set_id: challengeSetId,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row as { awarded: boolean; bonus: number; new_star: number };
}

export async function answerWord(
  memberId: string,
  wordId: string,
  questionType: string,
  answer: string,
  isFamiliar = false
): Promise<AnswerWordResult> {
  const { data, error } = await supabase.rpc('answer_word', {
    p_member_id: memberId,
    p_word_id: wordId,
    p_question_type: questionType,
    p_answer: answer,
    p_is_familiar: isFamiliar,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row as AnswerWordResult;
}

export async function reviewWrongQuestion(
  wrongId: string,
  memberId: string,
  isCorrect: boolean
): Promise<ReviewWrongResult> {
  const { data, error } = await supabase.rpc('review_wrong_question', {
    p_wrong_id: wrongId,
    p_member_id: memberId,
    p_is_correct: isCorrect,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row as ReviewWrongResult;
}

// ====== 挑战进度汇总（题集外层显示 已掌握/总数） ======

// 批量获取多个题集的挑战进度：setId → { total, mastered }
// - total: 该题集中「未强制下线」的题数（is_active !== false）
// - mastered: 其中已掌握的题数（question_progress.is_mastered = true）
// 仅 2 次查询，与题集数量无关
export async function fetchChallengeProgress(
  setIds: string[],
  memberId: string,
): Promise<Record<string, { total: number; mastered: number }>> {
  const result: Record<string, { total: number; mastered: number }> = {};
  if (setIds.length === 0) return result;

  // 1) 取这些题集下所有题目（id + 所属 set + 是否下线）
  const { data: questions, error: qErr } = await supabase
    .from('questions')
    .select('id, challenge_set_id, is_active')
    .in('challenge_set_id', setIds);
  if (qErr) throw qErr;

  // 初始化每个 set 的计数
  for (const sid of setIds) result[sid] = { total: 0, mastered: 0 };
  // 题目 id → 所属 set（用于把掌握进度归集到 set）
  const qidToSet: Record<string, string> = {};
  for (const q of (questions ?? []) as { id: string; challenge_set_id: string; is_active?: boolean }[]) {
    qidToSet[q.id] = q.challenge_set_id;
    if (q.is_active !== false) {
      result[q.challenge_set_id].total += 1;
    }
  }

  // 2) 取该成员已掌握的题
  const { data: progresses, error: pErr } = await supabase
    .from('question_progress')
    .select('question_id, is_mastered')
    .eq('member_id', memberId)
    .eq('is_mastered', true);
  if (pErr && !pErr.message.includes('question_progress')) throw pErr;

  const masteredSet = new Set(
    (progresses ?? []).map((p: { question_id: string }) => p.question_id)
  );
  // 把掌握的题归集到对应 set（注意必须是该 set 中存在的题）
  for (const q of (questions ?? []) as { id: string; is_active?: boolean }[]) {
    if (masteredSet.has(q.id) && q.is_active !== false) {
      const sid = qidToSet[q.id];
      if (sid) result[sid].mastered += 1;
    }
  }

  return result;
}

