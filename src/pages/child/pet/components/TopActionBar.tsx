import { Calendar, BookOpen } from 'lucide-react';
import { cn } from '../../../../lib/utils';

// 左上角浮动按钮组：签到 + 图鉴
export function TopActionBar({ memberId, onShowCheckin, onShowDex, onRefresh }: {
  memberId: string;
  onShowCheckin: () => void;
  onShowDex: () => void;
  onRefresh: () => void;
}) {
  // 紧凑的水平按钮组，半透明白色背景
  const btnClass = cn(
    'flex items-center gap-1.5 px-3 py-1.5 rounded-full',
    'bg-white/70 backdrop-blur-sm border border-white/60',
    'text-green-600 hover:bg-white/90 hover:border-green-200',
    'shadow-sm transition-colors active:scale-95'
  );

  return (
    <div className="flex items-center gap-2" data-member-id={memberId} data-refresh-available={typeof onRefresh === 'function'}>
      <button onClick={onShowCheckin} className={btnClass}>
        <Calendar className="w-4 h-4" />
        <span className="text-xs font-medium">签到</span>
      </button>
      <button onClick={onShowDex} className={btnClass}>
        <BookOpen className="w-4 h-4" />
        <span className="text-xs font-medium">图鉴</span>
      </button>
    </div>
  );
}
