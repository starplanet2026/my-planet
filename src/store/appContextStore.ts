import { create } from 'zustand';
import { fetchAppContext } from '../api/appContext';

interface AppContextState {
  isSuperAdmin: boolean;
  features: Record<string, boolean>;
  loaded: boolean;
  load: () => Promise<void>;
  // 新功能默认仅超管可用；管理员「应用全局」后普通用户才可用
  isFeatureEnabled: (key: string) => boolean;
}

export const useAppContextStore = create<AppContextState>((set, get) => ({
  isSuperAdmin: false,
  features: {},
  loaded: false,

  load: async () => {
    try {
      const ctx = await fetchAppContext();
      set({ isSuperAdmin: ctx.isSuperAdmin, features: ctx.features, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },

  isFeatureEnabled: (key: string) => {
    const { isSuperAdmin, features } = get();
    return isSuperAdmin || features[key] === true;
  },
}));
