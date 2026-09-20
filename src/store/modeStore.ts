import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { verifyParentPin, setParentPin as setPinApi, hasParentPin as hasPinApi } from '../api/family';

interface ModeState {
  mode: 'child' | 'parent';
  currentChildId: string | null;
  multiChildMode: boolean;
  parentUnlocked: boolean;
  isUnlocking: boolean;
  unlockError: string | null;
  pinConfigured: boolean | null;

  unlockParent: (pin: string) => Promise<boolean>;
  setupParentPin: (pin: string) => Promise<boolean>;
  checkPinConfigured: () => Promise<void>;
  lockParent: () => void;
  setChild: (id: string) => void;
  setMultiChildMode: (on: boolean) => void;
}

export const useModeStore = create<ModeState>()(
  persist(
    (set) => ({
      mode: 'child',
      currentChildId: null,
      multiChildMode: false,
      parentUnlocked: false,
      isUnlocking: false,
      unlockError: null,
      pinConfigured: null,

      unlockParent: async (pin) => {
        set({ isUnlocking: true, unlockError: null });
        try {
          const ok = await verifyParentPin(pin);
          if (ok) {
            set({ mode: 'parent', parentUnlocked: true, isUnlocking: false, pinConfigured: true });
            return true;
          }
          set({ isUnlocking: false, unlockError: 'PIN 码错误' });
          return false;
        } catch (e: any) {
          set({ isUnlocking: false, unlockError: e?.message ?? '验证失败' });
          return false;
        }
      },

      setupParentPin: async (pin) => {
        set({ isUnlocking: true, unlockError: null });
        try {
          await setPinApi(pin);
          set({ mode: 'parent', parentUnlocked: true, isUnlocking: false, pinConfigured: true });
          return true;
        } catch (e: any) {
          set({ isUnlocking: false, unlockError: e?.message ?? '设置失败' });
          return false;
        }
      },

      checkPinConfigured: async () => {
        try {
          const configured = await hasPinApi();
          set({ pinConfigured: configured });
        } catch {
          set({ pinConfigured: null });
        }
      },

      lockParent: () => set({ mode: 'child', parentUnlocked: false, unlockError: null }),
      setChild: (id) => set({ currentChildId: id }),
      setMultiChildMode: (on) => set({ multiChildMode: on }),
    }),
    {
      name: 'mp-mode',
      partialize: (s) => ({ currentChildId: s.currentChildId, mode: s.mode, multiChildMode: s.multiChildMode }),
    }
  )
);
