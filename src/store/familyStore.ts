import { create } from 'zustand';
import type { Family, Member } from '../api/types';

// 防御性处理用户名：如果 name 字段被错误存入了 base64 图片数据等异常内容，回退为默认名称
export function safeName(name: unknown): string {
  const s = String(name ?? '').trim();
  if (!s) return '未命名';
  if (s.startsWith('data:') || s.length > 100 || /^[A-Za-z0-9+/=]{50,}$/.test(s)) {
    return '学生';
  }
  return s;
}

// 防御性处理头像 emoji：如果被错误存入了 base64 等异常内容，回退为默认头像
export function safeAvatar(avatar: unknown): string {
  const s = String(avatar ?? '').trim();
  if (!s) return '👤';
  if (s.startsWith('data:') || s.length > 100 || /^[A-Za-z0-9+/=]{50,}$/.test(s)) {
    return '👤';
  }
  return s;
}

function cleanMember(m: Member): Member {
  return { ...m, name: safeName(m.name) };
}

function cleanMembers(list: Member[]): Member[] {
  return list.map(cleanMember);
}
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
  patchMember: (id: string, patch: Partial<Member>) => void;
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
      set({ family: result.family, members: cleanMembers(result.members), loading: false });

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
              set({ members: [...members, cleanMember(payload.new as Member)] });
            } else if (payload.eventType === 'UPDATE') {
              const updated = cleanMember(payload.new as Member);
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
        set({ members: cleanMembers(result.members) });
      }
    } catch {
      // 静默失败
    }
  },

  setFamily: (f) => set({ family: f }),
  setMembers: (m) => set({ members: cleanMembers(m) }),
  patchMember: (id, patch) => set(s => ({
    members: s.members.map(m => m.id === id ? cleanMember({ ...m, ...patch }) : m)
  })),
  addMember: (m) => set(s => ({ members: [...s.members, cleanMember(m)] })),
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
