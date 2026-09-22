import { create } from 'zustand';
import type { ChallengeSet, Question, Word, WordProgress, WordQuestionType } from '../api/types';

// 挑战赛答题进度快照：切换页面/Tab 或点返回时组件卸载，但 store 保留；
// 回到挑战赛页或再次进入同一题集时从 store 恢复断点。
//
// 两条流程：
// 1) word_vocab 旧流程：activeSet + PlayerSnapshot（words 数组 + idx/stage/quizType）
// 2) 关卡制新流程：activeSet + activeLevelId + LevelSnapshot（questions 数组 + clearedIds/currentIdx/results）

export interface PlayerSnapshot {
  setId: string;                // 关联题集 ID，用于判断是否恢复
  started: boolean;             // 是否已过知识点预览
  type: 'question' | 'word';
  // 选择题/数学题（旧流程，仅 word_vocab 走 type='word'）
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

// 关卡制新流程的快照
export interface LevelSnapshotState {
  setId: string;               // 关联题集 ID
  levelId: string;              // 关卡 ID
  questions: Question[];        // 当前关卡剩余题目（含本轮未消题）
  clearedIds: string[];         // 本轮已消题 ID 列表
  currentIdx: number;           // 当前做题位置
  results: boolean[];           // 本轮每题对错（用于正确率计算）
  totalReward: number;          // 本轮累计星光
  showRoundResult: boolean;    // 是否显示一轮结果弹窗
}

interface ChallengeUiState {
  // 当前活动题集（有值=在答题界面，null=在列表页）
  activeSet: ChallengeSet | null;
  // 旧流程快照（word_vocab 用）
  snapshot: PlayerSnapshot | null;
  // 新流程：当前活动关卡 ID
  activeLevelId: string | null;
  // 新流程快照（关卡制用）
  levelSnapshot: LevelSnapshotState | null;

  // 设置活动题集（进入答题界面）
  setActive: (set: ChallengeSet | null) => void;
  // 设置完整快照（旧流程）
  setSnapshot: (s: PlayerSnapshot | null) => void;
  // 增量更新快照（旧流程）
  patchSnapshot: (patch: Partial<PlayerSnapshot>) => void;
  // 只清 activeSet，保留 snapshot（点返回回列表，进度保留）
  clearActive: () => void;
  // 清空全部（挑战结束/全部掌握）
  clear: () => void;

  // 新流程：设置活动关卡
  setActiveLevel: (levelId: string | null) => void;
  // 新流程：设置关卡快照
  setLevelSnapshot: (s: LevelSnapshotState | null) => void;
  // 新流程：增量更新关卡快照
  patchLevelSnapshot: (patch: Partial<LevelSnapshotState>) => void;
  // 新流程：清空关卡状态
  clearLevel: () => void;
}

export const useChallengeUiStore = create<ChallengeUiState>((set) => ({
  activeSet: null,
  snapshot: null,
  activeLevelId: null,
  levelSnapshot: null,

  setActive: (setObj) => set({ activeSet: setObj }),
  setSnapshot: (s) => set({ snapshot: s }),
  patchSnapshot: (patch) =>
    set((state) => (state.snapshot ? { snapshot: { ...state.snapshot, ...patch } } : {})),
  clearActive: () => set({ activeSet: null }),
  clear: () => set({ activeSet: null, snapshot: null, activeLevelId: null, levelSnapshot: null }),

  setActiveLevel: (levelId) => set({ activeLevelId: levelId }),
  setLevelSnapshot: (s) => set({ levelSnapshot: s }),
  patchLevelSnapshot: (patch) =>
    set((state) => (state.levelSnapshot ? { levelSnapshot: { ...state.levelSnapshot, ...patch } } : {})),
  clearLevel: () => set({ activeLevelId: null, levelSnapshot: null }),
}));
