import { create } from 'zustand';
import type { PetWord } from '../api/types';
import { setMuted as setAudioMuted } from '../lib/audio';

// 萌宠闯关任务类型（与 StudyCompanionModal 内部定义保持一致）
export interface PersistedStudyTask {
  id: string;
  text: string;
  reward: number;
  done: boolean;
  rewarded: boolean;
}

// 全局（内存级）UI 状态：切换 tab 时组件卸载，但 store 保留；
// 回到萌宠星球时 PetPage 从 store 读取并重新打开弹窗，游戏/学习可恢复
interface PetUiState {
  // 底部 4 个 modal 之一：shop / inventory / game / store
  activeModal: 'shop' | 'inventory' | 'game' | 'store' | null;
  // 学习陪伴弹窗是否打开
  showStudy: boolean;

  // 萌宠闯关：当前关卡与单词（用于恢复对局）
  gameLevel: number | null;
  gameWords: PetWord[];
  gameBookId: string | null;
  gameBookTitle: string;

  // 陪伴学习：关键字段（用于恢复）
  studyStep: 'select' | 'timer' | 'done' | 'records';
  studyPetId: string | null;
  studyMinutes: number;
  studyTaskText: string;
  studyTaskList: PersistedStudyTask[];
  studyRemaining: number; // 秒
  studyStudying: boolean;
  studyPaused: boolean;
  // 时间戳驱动：学习应结束的绝对时间（ms），跨页面/最小化期间倒计时继续
  studyEndsAt: number | null;
  // 已累计暂停时长（ms），用于结算实际学习分钟数
  studyPausedAccumMs: number;
  // 本次暂停开始时间戳（ms），null 表示未在暂停
  studyPauseStartAt: number | null;
  // 最小化标志：true 时仅渲染小浮窗，学习继续
  studyMinimized: boolean;
  // 本次学习已获得的星光值（跨页面恢复用）
  studyTotalStarEarned: number;

  // 全局音效静音开关（跨页面共享）
  audioMuted: boolean;

  // Actions
  setActiveModal: (m: PetUiState['activeModal']) => void;
  setShowStudy: (v: boolean) => void;
  setGameState: (level: number | null, words: PetWord[], bookId?: string | null, bookTitle?: string) => void;
  clearGameState: () => void;
  setStudyState: (patch: Partial<Pick<PetUiState,
    'studyStep' | 'studyPetId' | 'studyMinutes' | 'studyTaskText' |
    'studyTaskList' | 'studyRemaining' | 'studyStudying' | 'studyPaused' |
    'studyEndsAt' | 'studyPausedAccumMs' | 'studyPauseStartAt' | 'studyMinimized' | 'studyTotalStarEarned'
  >>) => void;
  clearStudyState: () => void;
  toggleAudioMute: () => void;
}

export const usePetUiStore = create<PetUiState>((set) => ({
  activeModal: null,
  showStudy: false,

  gameLevel: null,
  gameWords: [],
  gameBookId: null,
  gameBookTitle: '',

  studyStep: 'select',
  studyPetId: null,
  studyMinutes: 15,
  studyTaskText: '',
  studyTaskList: [],
  studyRemaining: 0,
  studyStudying: false,
  studyPaused: false,
  studyEndsAt: null,
  studyPausedAccumMs: 0,
  studyPauseStartAt: null,
  studyMinimized: false,
  studyTotalStarEarned: 0,

  audioMuted: (() => {
    try {
      const m = localStorage.getItem('pet-audio-muted') === 'true';
      setAudioMuted(m); // 初始化时同步到 audio 引擎
      return m;
    } catch { return false; }
  })(),

  setActiveModal: (m) => set({ activeModal: m }),
  setShowStudy: (v) => set({ showStudy: v }),
  setGameState: (level, words, bookId, bookTitle) => set({
    gameLevel: level, gameWords: words,
    gameBookId: bookId ?? null, gameBookTitle: bookTitle ?? '',
  }),
  clearGameState: () => set({ gameLevel: null, gameWords: [], gameBookId: null, gameBookTitle: '' }),
  setStudyState: (patch) => set(patch),
  clearStudyState: () => set({
    studyStep: 'select',
    studyPetId: null,
    studyMinutes: 15,
    studyTaskText: '',
    studyTaskList: [],
    studyRemaining: 0,
    studyStudying: false,
    studyPaused: false,
    studyEndsAt: null,
    studyPausedAccumMs: 0,
    studyPauseStartAt: null,
    studyMinimized: false,
    studyTotalStarEarned: 0,
  }),
  toggleAudioMute: () => set((s) => {
    const next = !s.audioMuted;
    try { localStorage.setItem('pet-audio-muted', String(next)); } catch {}
    setAudioMuted(next); // 同步到 audio 引擎
    return { audioMuted: next };
  }),
}));
