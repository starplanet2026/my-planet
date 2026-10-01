import { cn } from '../../../../lib/utils';

// 数字键盘按键（含括号、小数点、省略号、加减乘除、退格）
export const KEYS = ['7', '8', '9', '(', ')', '4', '5', '6', '+', '-', '1', '2', '3', '×', '÷', '0', '.', '……', '⌫'];

interface NumberKeypadProps {
  onKey: (key: string) => void;
  onClose: () => void;
}

export function NumberKeypad({ onKey, onClose }: NumberKeypadProps) {
  return (
    <div className="bg-slate-50 rounded-xl p-3" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-slate-500">数学输入键盘</span>
        <button
          onClick={onClose}
          className="text-xs text-slate-400 hover:text-slate-600"
        >
          收起
        </button>
      </div>
      <div className="grid grid-cols-5 gap-2">
        {KEYS.map(k => (
          <button
            key={k}
            onClick={() => onKey(k)}
            className={cn(
              'h-12 rounded-lg text-lg font-medium transition-colors',
              k === '⌫'
                ? 'bg-red-50 text-red-500 hover:bg-red-100'
                : k === '×' || k === '÷' || k === '+' || k === '-'
                  ? 'bg-star-50 text-star-600 hover:bg-star-100 border border-star-200'
                  : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
            )}
          >
            {k}
          </button>
        ))}
      </div>
    </div>
  );
}
