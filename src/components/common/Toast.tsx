import { CheckCircle, XCircle, AlertCircle, Info, X } from 'lucide-react';
import { useToastStore, type ToastType } from '../../store/toastStore';
import { cn } from '../../lib/utils';

const icons = {
  success: CheckCircle,
  error: XCircle,
  warning: AlertCircle,
  info: Info,
};

const colors: Record<ToastType, string> = {
  success: 'text-emerald-500',
  error: 'text-red-500',
  warning: 'text-amber-500',
  info: 'text-blue-500',
};

export function ToastContainer() {
  const { toasts, remove } = useToastStore();

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2 w-full max-w-sm px-4 pointer-events-none">
      {toasts.map(toast => {
        const Icon = icons[toast.type];
        return (
          <div
            key={toast.id}
            className={cn(
              'flex items-center gap-3 bg-white rounded-xl shadow-lg px-4 py-3 border border-slate-100',
              'animate-slide-up pointer-events-auto'
            )}
          >
            <Icon className={cn('w-5 h-5 flex-shrink-0', colors[toast.type])} />
            <p className="flex-1 text-sm text-slate-800">{toast.message}</p>
            <button
              onClick={() => remove(toast.id)}
              className="text-slate-400 hover:text-slate-600 flex-shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
