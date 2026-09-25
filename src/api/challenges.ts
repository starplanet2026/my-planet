import { supabase } from './client';
import type {
  ChallengeSet, Question, Word, WordProgress,
  AnswerQuestionResult, AnswerWordResult, ReviewWrongResult,
  ChallengeSetType, QuestionType, Difficulty, ChallengeAnalysisItem,
  ChallengeBoard, ChallengeBoardType, LevelSnapshot, FinishLevelResult,
  WrongBattlePoolItem, WrongQuestionStat,
  ChallengeLevel, ChallengeSubject, LevelTargetSection,
} from './types';

// 上传知识点图片到 storage bucket，返回 public URL
export async function uploadKnowledgeImage(file: File): Promise<string> {
  const ext = file.name.split('.').pop() || 'png';
  const fileName = `kp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage
    .from('knowledge-points')
    .upload(fileName, file, { upsert: false });
  if (error) throw error;
  const { data } = supabase.storage.from('knowledge-points').getPublicUrl(fileName);
  return data.publicUrl;
}

// 删除知识点图片
export async function deleteKnowledgeImage(url: string): Promise<void> {
  // 从 URL 提取文件名
  const parts = url.split('/knowledge-points/');
  if (parts.length < 2) return;
  const fileName = parts[parts.length - 1];
  await supabase.storage.from('knowledge-points').remove([fileName]);
}

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
  board?: ChallengeBoardType;
  subject?: ChallengeSubject | null;
  reward_easy: number;
  reward_medium: number;
  reward_hard: number;
  knowledge_points?: string;
  knowledge_points_images?: string[];
}): Promise<ChallengeSet> {
  // Only include migration-dependent optional fields when they have values,
  // so insert works even if migration 0102/0103 hasn't been applied yet.
  const { subject, knowledge_points, knowledge_points_images, ...rest } = data;
  const payload: Record<string, any> = { ...rest, status: 'draft' };
  if (subject) payload.subject = subject;
  if (knowledge_points) payload.knowledge_points = knowledge_points;
  if (knowledge_points_images && knowledge_points_images.length > 0) {
    payload.knowledge_points_images = knowledge_points_images;
  }
  const { data: result, error } = await supabase
    .from('challenge_sets')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return result as ChallengeSet;
}

export async function updateChallengeSet(id: string, patch: Partial<ChallengeSet>): Promise<ChallengeSet> {
  // Strip null/empty for migration-dependent columns (avoid "column not found" if migration not applied)
  const cleanPatch: Record<string, any> = { ...patch };
  if (!cleanPatch.subject) delete cleanPatch.subject;
  if (!cleanPatch.knowledge_points) delete cleanPatch.knowledge_points;
  if (!cleanPatch.knowledge_points_images ||
      (Array.isArray(cleanPatch.knowledge_points_images) && cleanPatch.knowledge_points_images.length === 0)) {
    delete cleanPatch.knowledge_points_images;
  }
  const { data, error } = await supabase
    .from('challenge_sets')
    .update(cleanPatch)
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
  challenge_set_id?: string | null;
  type: QuestionType;
  question_text: string;
  options?: string[];
  correct_answer: string;
  explanation?: string;
  difficulty?: Difficulty;
  display_order?: number;
  level_id?: string;
  metadata?: Record<string, any>;
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
    challenge_set_id?: string | null;
    type: QuestionType;
    question_text: string;
    options?: string[];
    correct_answer: string;
    explanation?: string;
    difficulty?: Difficulty;
    display_order?: number;
    level_id?: string;
    metadata?: Record<string, any>;
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

// ====== 二次开发新增：板块/关卡/快照/错题混战 ======

// 一次性拉取4板块题集+关卡+解锁状态
export async function fetchChallengeBoards(memberId: string): Promise<ChallengeBoard[]> {
  const { data, error } = await supabase.rpc('get_challenge_boards', {
    p_member_id: memberId,
  });
  if (error) throw error;
  const boards = (data ?? []) as ChallengeBoard[];

  // 拉取各关卡的难度分布（避免依赖 RPC 迁移）
  const setLevelIds = boards.flatMap(b => b.sets.flatMap(s => s.levels.map(l => l.id)));
  const standaloneLevelIds = boards.flatMap(b => (b.levels ?? []).map(l => l.id));
  const allLevelIds = [...setLevelIds, ...standaloneLevelIds];
  if (allLevelIds.length > 0) {
    const { data: qData } = await supabase
      .from('questions')
      .select('difficulty, level_id')
      .in('level_id', allLevelIds)
      .eq('is_active', true);
    if (qData) {
      // level_id -> set_id 映射
      const levelToSet = new Map<string, string>();
      for (const b of boards) {
        for (const s of b.sets) {
          for (const l of s.levels) levelToSet.set(l.id, s.id);
        }
      }
      // 按题集统计各难度数量
      const counts = new Map<string, { easy: number; medium: number; hard: number }>();
      for (const q of qData as { difficulty: string; level_id: string }[]) {
        const setId = levelToSet.get(q.level_id);
        if (!setId) continue;
        const c = counts.get(setId) ?? { easy: 0, medium: 0, hard: 0 };
        if (q.difficulty === 'easy') c.easy++;
        else if (q.difficulty === 'medium') c.medium++;
        else if (q.difficulty === 'hard') c.hard++;
        counts.set(setId, c);
      }
      // 写回 boards - sets
      for (const b of boards) {
        for (const s of b.sets) {
          const c = counts.get(s.id);
          s.easy_count = c?.easy ?? 0;
          s.medium_count = c?.medium ?? 0;
          s.hard_count = c?.hard ?? 0;
        }
      }

      // 写回 boards - standalone levels
      const levelCounts = new Map<string, { easy: number; medium: number; hard: number }>();
      for (const q of qData as { difficulty: string; level_id: string }[]) {
        const c = levelCounts.get(q.level_id) ?? { easy: 0, medium: 0, hard: 0 };
        if (q.difficulty === 'easy') c.easy++;
        else if (q.difficulty === 'medium') c.medium++;
        else if (q.difficulty === 'hard') c.hard++;
        levelCounts.set(q.level_id, c);
      }
      for (const b of boards) {
        for (const lv of b.levels ?? []) {
          const c = levelCounts.get(lv.id);
          lv.easy_count = c?.easy ?? 0;
          lv.medium_count = c?.medium ?? 0;
          lv.hard_count = c?.hard ?? 0;
        }
      }
    }
  }

  return boards;
}

// 按关卡 ID 拉取题目（按 display_order 排序，仅活跃题，孩子端用）
// 获取题集下全部题目（通过关联关卡 + 直接关联，用于只读查看）
export async function fetchSetQuestionsAll(setId: string): Promise<Question[]> {
  // 1. 获取题集关联的关卡 ID
  const { data: rels } = await supabase
    .from('challenge_set_levels')
    .select('level_id')
    .eq('set_id', setId);
  const levelIds = (rels ?? []).map((r: any) => r.level_id);

  let allQs: Question[] = [];

  // 2. 通过关卡拉取题目
  if (levelIds.length > 0) {
    const { data: lvQs, error } = await supabase
      .from('questions')
      .select('*')
      .in('level_id', levelIds)
      .eq('is_active', true)
      .order('created_at');
    if (!error && lvQs) allQs = lvQs as Question[];
  }

  // 3. 也拉取直接关联题集的旧流程题目
  const { data: setQs, error: setErr } = await supabase
    .from('questions')
    .select('*')
    .eq('challenge_set_id', setId)
    .eq('is_active', true)
    .order('created_at');
  if (!setErr && setQs) allQs = [...allQs, ...setQs as Question[]];

  return allQs.sort((a, b) => (a.display_order ?? 999) - (b.display_order ?? 999));
}

export async function fetchLevelQuestions(levelId: string): Promise<Question[]> {
  const { data, error } = await supabase
    .from('questions')
    .select('*')
    .eq('level_id', levelId)
    .eq('is_active', true)
    .order('created_at');
  if (error) throw error;
  return ((data ?? []) as Question[]).sort((a, b) =>
    (a.display_order ?? 999) - (b.display_order ?? 999));
}

// 按关卡 ID 拉取全部题目（含下线题，后台管理用）
export async function fetchLevelQuestionsAll(levelId: string): Promise<Question[]> {
  const { data, error } = await supabase
    .from('questions')
    .select('*')
    .eq('level_id', levelId)
    .order('created_at');
  if (error) throw error;
  return ((data ?? []) as Question[]).sort((a, b) =>
    (a.display_order ?? 999) - (b.display_order ?? 999));
}

// 保存关卡进度快照（断点续做）
export async function saveLevelSnapshot(
  memberId: string,
  levelId: string,
  currentIdx: number,
  clearedIds: string[],
  isPaused: boolean = false,
): Promise<void> {
  const { error } = await supabase.rpc('save_level_snapshot', {
    p_member_id: memberId,
    p_level_id: levelId,
    p_current_idx: currentIdx,
    p_cleared_ids: clearedIds,
    p_is_paused: isPaused,
  });
  if (error) throw error;
}

// 加载关卡进度快照
export async function loadLevelSnapshot(
  memberId: string,
  levelId: string,
): Promise<LevelSnapshot | null> {
  const { data, error } = await supabase.rpc('load_level_snapshot', {
    p_member_id: memberId,
    p_level_id: levelId,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    current_idx: row.current_idx ?? 0,
    cleared_question_ids: row.cleared_question_ids ?? [],
    is_cleared: row.is_cleared ?? false,
    is_paused: row.is_paused ?? false,
    last_played_at: row.last_played_at ?? null,
  } as LevelSnapshot;
}

// 重置暂停状态（保留 cleared）
export async function resetLevelSnapshot(
  memberId: string,
  levelId: string,
): Promise<void> {
  const { error } = await supabase.rpc('reset_level_snapshot', {
    p_member_id: memberId,
    p_level_id: levelId,
  });
  if (error) throw error;
}

// 关卡清零发奖 → 整集通关额外奖励
export async function finishChallengeLevel(
  memberId: string,
  levelId: string,
): Promise<FinishLevelResult> {
  const { data, error } = await supabase.rpc('finish_challenge_level', {
    p_member_id: memberId,
    p_level_id: levelId,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row as FinishLevelResult;
}

// 批量加入错题混战池
export async function addWrongToBattlePool(
  memberId: string,
  questionIds: string[],
  addedBy?: string,
): Promise<number> {
  const { data, error } = await supabase.rpc('add_wrong_to_battle_pool', {
    p_member_id: memberId,
    p_question_ids: questionIds,
    p_added_by: addedBy ?? null,
  });
  if (error) throw error;
  return data as number;
}

// 批量移除错题混战池
export async function removeWrongFromBattlePool(poolIds: string[]): Promise<number> {
  const { data, error } = await supabase.rpc('remove_wrong_from_battle_pool', {
    p_pool_ids: poolIds,
  });
  if (error) throw error;
  return data as number;
}

// 获取错题混战池
export async function fetchWrongBattlePool(memberId: string): Promise<WrongBattlePoolItem[]> {
  const { data, error } = await supabase.rpc('get_wrong_battle_pool', {
    p_member_id: memberId,
  });
  if (error) throw error;
  return (data ?? []) as WrongBattlePoolItem[];
}

// 获取错题统计（后台筛选用）
export async function fetchWrongQuestionStats(
  memberId?: string,
  challengeSetId?: string,
): Promise<WrongQuestionStat[]> {
  const { data, error } = await supabase.rpc('get_wrong_question_stats', {
    p_member_id: memberId ?? null,
    p_challenge_set_id: challengeSetId ?? null,
  });
  if (error) throw error;
  return (data ?? []) as WrongQuestionStat[];
}

// 获取指定关卡的错题统计（用于"查看错题"和"挑战错题"）
export async function fetchLevelWrongQuestionStats(
  memberId: string,
  levelId: string,
): Promise<WrongQuestionStat[]> {
  // 1. 获取该关卡所有题目 ID
  const { data: questions, error: qErr } = await supabase
    .from('questions')
    .select('id, question_text, difficulty, type')
    .eq('level_id', levelId);
  if (qErr) throw qErr;
  if (!questions || questions.length === 0) return [];

  const qIds = questions.map(q => q.id);
  const qMap = new Map(questions.map(q => [q.id, q]));

  // 2. 查询该成员对这些题目的错题记录（仅活跃错题，已掌握的不显示）
  const { data: wrongRecords, error: wErr } = await supabase
    .from('wrong_questions')
    .select('question_id, wrong_count, correct_count, status')
    .eq('member_id', memberId)
    .eq('status', 'active')
    .in('question_id', qIds);
  if (wErr) throw wErr;

  // 3. 查询答题记录统计
  const { data: records, error: rErr } = await supabase
    .from('question_records')
    .select('question_id, is_correct')
    .eq('member_id', memberId)
    .in('question_id', qIds);
  if (rErr) throw rErr;

  const attemptMap = new Map<string, { attempt: number; correct: number }>();
  for (const r of (records ?? []) as { question_id: string; is_correct: boolean }[]) {
    const cur = attemptMap.get(r.question_id) ?? { attempt: 0, correct: 0 };
    cur.attempt++;
    if (r.is_correct) cur.correct++;
    attemptMap.set(r.question_id, cur);
  }

  return ((wrongRecords ?? []) as any[])
    .filter(w => w.wrong_count > 0)
    .map(w => {
      const q = qMap.get(w.question_id);
      const stats = attemptMap.get(w.question_id) ?? { attempt: 0, correct: 0 };
      const total = stats.attempt;
      return {
        question_id: w.question_id,
        challenge_set_id: null,
        question_text: q?.question_text ?? '',
        type: q?.type ?? 'choice',
        difficulty: q?.difficulty ?? 'medium',
        display_order: 0,
        attempt_count: total,
        correct_count: stats.correct,
        wrong_count: w.wrong_count as number,
        error_rate: total > 0 ? (w.wrong_count / total) * 100 : 0,
        is_mastered: w.status === 'mastered',
        member_id: memberId,
        member_name: null,
      } as unknown as WrongQuestionStat;
    });
}

// ====== 关卡 CRUD（后台管理） ======

// 获取题集下所有关卡（通过关联表，按 sort_order 排序）
export async function fetchChallengeLevels(setId: string): Promise<(ChallengeLevel & { sort_order: number })[]> {
  const { data, error } = await supabase
    .from('challenge_set_levels')
    .select('sort_order, level:challenge_levels(*)')
    .eq('set_id', setId)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row: any) => ({ ...row.level, sort_order: row.sort_order }));
}

// 创建关卡（独立或题集内）
export async function createChallengeLevel(data: {
  challenge_set_id?: string;
  level_no: number;
  title?: string;
  description?: string;
  pass_reward?: number;
  status?: 'active' | 'inactive';
  subject?: ChallengeSubject | null;
  target_section?: LevelTargetSection | null;
  published?: boolean;
  knowledge_points?: string | null;
  knowledge_points_images?: string[] | null;
}): Promise<ChallengeLevel> {
  const { challenge_set_id, knowledge_points, knowledge_points_images, ...levelData } = data;
  const payload: Record<string, any> = { ...levelData };
  if (knowledge_points) payload.knowledge_points = knowledge_points;
  if (knowledge_points_images && Array.isArray(knowledge_points_images) && knowledge_points_images.length > 0) {
    payload.knowledge_points_images = knowledge_points_images;
  }
  const { data: result, error } = await supabase
    .from('challenge_levels')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  const level = result as ChallengeLevel;
  // If setId provided, create junction record
  if (challenge_set_id) {
    await addLevelToSet(challenge_set_id, level.id, data.level_no);
  }
  return level;
}

// 更新关卡
export async function updateChallengeLevel(id: string, patch: Partial<Omit<ChallengeLevel, 'id' | 'challenge_set_id' | 'created_at'>>): Promise<ChallengeLevel> {
  const cleanPatch: Record<string, any> = { ...patch };
  if (!cleanPatch.knowledge_points) delete cleanPatch.knowledge_points;
  if (!cleanPatch.knowledge_points_images ||
      (Array.isArray(cleanPatch.knowledge_points_images) && cleanPatch.knowledge_points_images.length === 0)) {
    delete cleanPatch.knowledge_points_images;
  }
  const { data, error } = await supabase
    .from('challenge_levels')
    .update(cleanPatch)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data as ChallengeLevel;
}

// 删除关卡（先删该关卡下所有题目，再删关卡本体，关联表 on delete cascade 自动清理）
export async function deleteChallengeLevel(id: string): Promise<void> {
  // Delete questions under this level first
  const { error: qErr } = await supabase.from('questions').delete().eq('level_id', id);
  if (qErr) throw qErr;
  // Then delete the level (junction records auto-cleanup via on delete cascade)
  const { error } = await supabase.from('challenge_levels').delete().eq('id', id);
  if (error) throw error;
}

// 批量更新题目的所属关卡（用于把题目分配到关卡）
// 注意：必须用 update 而非 upsert，否则不匹配冲突键时会 INSERT，导致 NOT NULL 列报错
export async function setQuestionsLevel(updates: { id: string; level_id: string | null }[]): Promise<void> {
  if (updates.length === 0) return;
  // 按 level_id 分组，每组用一条 update 批量更新，避免逐题请求
  const groups = new Map<string | null, string[]>();
  for (const u of updates) {
    const key = u.level_id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(u.id);
  }
  for (const [levelId, ids] of groups) {
    const { error } = await supabase
      .from('questions')
      .update({ level_id: levelId })
      .in('id', ids);
    if (error) throw error;
  }
}

// ====== 全局关卡库 API ======

// 获取全局关卡列表（可选学科筛选）
export async function fetchGlobalLevels(subject?: ChallengeSubject | null): Promise<ChallengeLevel[]> {
  let query = supabase.from('challenge_levels').select('*').order('created_at', { ascending: false });
  if (subject) query = query.eq('subject', subject);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as ChallengeLevel[];
}

// ====== 题集-关卡关联表 API ======

// 添加关卡到题集
export async function addLevelToSet(setId: string, levelId: string, sortOrder: number): Promise<void> {
  const { error } = await supabase
    .from('challenge_set_levels')
    .insert({ set_id: setId, level_id: levelId, sort_order: sortOrder });
  if (error) throw error;
}

// 从题集移除关卡引用（不删关卡本体）
export async function removeLevelFromSet(setId: string, levelId: string): Promise<void> {
  const { error } = await supabase
    .from('challenge_set_levels')
    .delete()
    .eq('set_id', setId)
    .eq('level_id', levelId);
  if (error) throw error;
}

// 批量更新题集内关卡排序
export async function updateSetLevelOrder(setId: string, updates: { level_id: string; sort_order: number }[]): Promise<void> {
  if (updates.length === 0) return;
  for (const u of updates) {
    const { error } = await supabase
      .from('challenge_set_levels')
      .update({ sort_order: u.sort_order })
      .eq('set_id', setId)
      .eq('level_id', u.level_id);
    if (error) throw error;
  }
}

// ====== 挑战会话星光汇总 ======
// 开始会话：先补录上一轮未汇总的星光（异常关闭兜底），再开启新会话
export async function startChallengeSession(
  memberId: string,
  setId?: string,
  levelId?: string,
  setTitle?: string,
): Promise<void> {
  const { error } = await supabase.rpc('start_challenge_session', {
    p_member_id: memberId,
    p_set_id: setId ?? null,
    p_level_id: levelId ?? null,
    p_set_title: setTitle ?? '',
  });
  if (error) throw error;
}

// 汇总会话星光：生成单条星光流水，清零累积
export async function flushChallengeSession(memberId: string): Promise<number> {
  const { data, error } = await supabase.rpc('flush_challenge_session', {
    p_member_id: memberId,
  });
  if (error) throw error;
  return (data as number) ?? 0;
}

