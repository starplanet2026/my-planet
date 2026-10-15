import { create } from 'zustand';
import { fetchStudyUnlockState } from '../api/pets';
import { useModeStore } from './modeStore';
import { useFamilyStore } from './familyStore';

/**
 * 陪伴学习任务分级解锁等级（仅限制孩子端前端手动点击）
 *  2 → 当日基础任务未完成（含家长未标记任何基础任务的情况，此时第一档视作未完成）：
 *      萌宠星球除「陪伴学习」外全部锁定，底部「领取成就 / 特权兑换 / 我的星球」锁定（智慧星战开放）
 *  1 → 基础任务已完成、当日全部任务未完成：除「宠物店」外全部解锁
 *  0 → 当日全部任务已完成（或家长未发布任何任务）：全部解锁
 *
 * 每日零点自动重置：状态由数据库按「当日已审核通过的学习记录」实时计算，跨天自然失配。
 * 后台托管定时任务不读取本状态，不受限制。
 */
export type StudyLockLevel = 0 | 1 | 2;

interface StudyLockState {
  level: StudyLockLevel;
  // 当日已发布的基础任务数（0 = 家长未标记基础任务，用于区分锁定提示文案）
  basicCount: number;
  loaded: boolean;
  refresh: () => Promise<void>;
}

export const useStudyLockStore = create<StudyLockState>((set) => ({
  level: 0,
  basicCount: 0,
  loaded: false,

  refresh: async () => {
    const mode = useModeStore.getState().mode;
    // 家长端不做门禁
    if (mode !== 'child') {
      set({ level: 0, basicCount: 0, loaded: true });
      return;
    }
    const members = useFamilyStore.getState().members;
    const childId = useModeStore.getState().currentChildId
      ?? members.find(m => m.role === 'child')?.id
      ?? null;
    if (!childId) {
      set({ level: 0, basicCount: 0, loaded: true });
      return;
    }
    try {
      const state = await fetchStudyUnlockState(childId);
      set({
        level: state.allDone ? 0 : state.basicDone ? 1 : 2,
        basicCount: state.basicCount,
        loaded: true,
      });
    } catch {
      // 查询失败时保持既有等级，避免因网络问题误锁孩子
      set({ loaded: true });
    }
  },
}));
