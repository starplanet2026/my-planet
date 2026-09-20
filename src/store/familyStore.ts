import { create } from 'zustand';
import type { Family, Member } from '../api/types';
import { loadFamily } from '../api/family';
import { supabase } from '../api/client';

interface FamilyState {
  family: Family | null;
  members: Member[];
  loading: boolean;
  error: string | null;

  load: () => Promise<void>;
  refreshMembers: () => Promise<void>;
  setFamily: (f: Family | null) => void;
  setMembers: (m: Member[]) => void;
  updateMember: (id: string, patch: Partial<Member>) => void;
  addMember: (m: Member) => void;
  removeMember: (id: string) => void;
  getCurrentChild: () => Member | null;
}

export const useFamilyStore = create<FamilyState>((set, get) => ({
  family: null,
  members: [],
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const result = await loadFamily();
      if (!result) {
        set({ family: null, members: [], loading: false });
        return;
      }
      set({ family: result.family, members: result.members, loading: false });

      // 订阅 members 表实时更新
      supabase
        .channel('rt:members')
        .on('postgres_changes',
          { event: '*', schema: 'public', table: 'members', filter: `family_id=eq.${result.family.id}` },
          (payload) => {
            const members = get().members;
            if (payload.eventType === 'DELETE') {
              set({ members: members.filter(m => m.id !== payload.old?.id) });
            } else if (payload.eventType === 'INSERT') {
              set({ members: [...members, payload.new as Member] });
            } else if (payload.eventType === 'UPDATE') {
              const updated = payload.new as Member;
              set({ members: members.map(m => m.id === updated.id ? updated : m) });
            }
          }
        )
        .subscribe();
    } catch (e: any) {
      set({ loading: false, error: e?.message ?? '加载失败' });
    }
  },

  // 只刷新 members，不重复创建 Realtime 订阅
  refreshMembers: async () => {
    const state = get();
    if (!state.family) return;
    try {
      const result = await loadFamily();
      if (result) {
        set({ members: result.members });
      }
    } catch {
      // 静默失败
    }
  },

  setFamily: (f) => set({ family: f }),
  setMembers: (m) => set({ members: m }),
  updateMember: (id, patch) => set(s => ({
    members: s.members.map(m => m.id === id ? { ...m, ...patch } : m)
  })),
  addMember: (m) => set(s => ({ members: [...s.members, m] })),
  removeMember: (id) => set(s => ({
    members: s.members.filter(m => m.id !== id)
  })),
  getCurrentChild: () => {
    const state = get();
    if (state.members.length === 0) return null;
    const childId = state.members.find(m => m.role === 'child')?.id;
    return state.members.find(m => m.id === childId) ?? null;
  },
}));
