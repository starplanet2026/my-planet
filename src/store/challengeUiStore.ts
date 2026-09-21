import { create } from 'zustand';
import type { ChallengeSet, Question, Word, WordProgress, WordQuestionType } from '../api/types';

// 挑战赛答题进度快照：切换页面/Tab 或点返回时组件卸载，但 store 保留；
// 回到挑战赛页或再次进入同一题集时从 store 恢复断点。
//
// 关键逻辑：
// - 中途退出（点返回/切Tab）→ 只清 activeSet，保留 snapshot → 下次进入同一题集继续
// - 全部做完 / 挑战结束 → clear() 清空全部 → 再次挑战时 fetchActiveQuestions 重新过滤（只出现错题）

export interface PlayerSnapshot {
  setId: string;                // 关联题集 ID，用于判断是否恢复
  started: boolean;             // 是否已过知识点预览
  type: 'question' | 'word';
  // 选择题/数学题
  questions: Question[];
  idx: number;
  results: boolean[];           // 本轮每题对错
  totalReward: number;
  totalBonus: number;
  showChallengeResult: boolean; // 是否已进入挑战结束页
  // 单词背诵
  words: (Word & { progress?: WordProgress })[];
  stage: 'familiar' | 'quiz';
  quizType: WordQuestionType;
}

interface ChallengeUiState {
  // 当前活动题集（有值=在答题界面，null=在列表页）
  activeSet: ChallengeSet | null;
  // 答题进度快照（含 setId，用于恢复判断）
  snapshot: PlayerSnapshot | null;

  // 设置活动题集（进入答题界面）
  setActive: (set: ChallengeSet | null) => void;
  // 设置完整快照
  setSnapshot: (s: PlayerSnapshot | null) => void;
  // 增量更新快照
  patchSnapshot: (patch: Partial<PlayerSnapshot>) => void;
  // 只清 activeSet，保留 snapshot（点返回回列表，进度保留）
  clearActive: () => void;
  // 清空全部（挑战结束/全部掌握）
  clear: () => void;
}

export const useChallengeUiStore = create<ChallengeUiState>((set) => ({
  activeSet: null,
  snapshot: null,

  setActive: (setObj) => set({ activeSet: setObj }),
  setSnapshot: (s) => set({ snapshot: s }),
  patchSnapshot: (patch) =>
    set((state) => (state.snapshot ? { snapshot: { ...state.snapshot, ...patch } } : {})),
  clearActive: () => set({ activeSet: null }),
  clear: () => set({ activeSet: null, snapshot: null }),
}));
