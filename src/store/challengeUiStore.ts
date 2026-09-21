import { create } from 'zustand';
import type { ChallengeSet, Question, Word, WordProgress, WordQuestionType } from '../api/types';

// 挑战赛答题进度快照：切换页面/Tab 时组件卸载，但 store 保留；
// 回到挑战赛页时 ChallengePage 从 store 读取并恢复进行中的题集与进度。
//
// 持久化范围：
// - 选择题/数学题：题目列表 + 当前 idx + 每题对错 + 累计奖励 + 是否在挑战结束页
// - 单词背诵：单词列表 + 当前 idx + stage + quizType
// - 已过知识点预览（started=true 表示直接进答题，不再显示预览）

export interface PlayerSnapshot {
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
  // 当前活动题集（完整对象，恢复时无需重新拉取）
  activeSet: ChallengeSet | null;
  // 是否已过知识点预览页
  started: boolean;
  // 答题进度快照
  snapshot: PlayerSnapshot | null;

  setActive: (set: ChallengeSet | null, started: boolean) => void;
  setSnapshot: (s: PlayerSnapshot | null) => void;
  patchSnapshot: (patch: Partial<PlayerSnapshot>) => void;
  clear: () => void;
}

export const useChallengeUiStore = create<ChallengeUiState>((set) => ({
  activeSet: null,
  started: false,
  snapshot: null,

  setActive: (setObj, started) => set({ activeSet: setObj, started }),
  setSnapshot: (s) => set({ snapshot: s }),
  patchSnapshot: (patch) =>
    set((state) => (state.snapshot ? { snapshot: { ...state.snapshot, ...patch } } : {})),
  clear: () => set({ activeSet: null, started: false, snapshot: null }),
}));
