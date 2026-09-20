import { create } from 'zustand';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: number;
  type: ToastType;
  message: string;
}

interface ToastState {
  toasts: Toast[];
  show: (type: ToastType, message: string) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  warning: (message: string) => void;
  info: (message: string) => void;
  remove: (id: number) => void;
}

let toastId = 0;

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],

  show: (type, message) => {
    const id = ++toastId;
    set(s => ({ toasts: [...s.toasts, { id, type, message }] }));
    setTimeout(() => get().remove(id), 3000);
  },

  success: (msg) => get().show('success', msg),
  error: (msg) => get().show('error', msg),
  warning: (msg) => get().show('warning', msg),
  info: (msg) => get().show('info', msg),

  remove: (id) => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })),
}));
