import { useState } from 'react';
import { useFamilyStore } from '../../store/familyStore';
import { useModeStore } from '../../store/modeStore';
import { Modal } from '../common/Modal';
import { Avatar } from '../common/Avatar';
import { cn } from '../../lib/utils';
import { ChevronDown } from 'lucide-react';

export function ChildSwitcher() {
  const members = useFamilyStore(s => s.members);
  const childMembers = members.filter(m => m.role === 'child');
  const currentChildId = useModeStore(s => s.currentChildId);
  const setChild = useModeStore(s => s.setChild);
  const [open, setOpen] = useState(false);

  const currentChild = childMembers.find(m => m.id === currentChildId);

  if (childMembers.length <= 1) return null;

  return (
    <>
      {/* 网页中间的切换按钮 */}
      <div className="flex justify-center py-3">
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 px-4 py-2 bg-white rounded-full shadow-sm border border-star-200 hover:shadow-md transition-all"
        >
          <Avatar emoji={currentChild?.avatar_emoji} size="sm" />
          <span className="font-bold text-slate-700">{currentChild?.name ?? '选择小朋友'}</span>
          <ChevronDown className="w-4 h-4 text-slate-400" />
        </button>
      </div>

      {/* 切换弹窗 */}
      <Modal open={open} onClose={() => setOpen(false)} title="选择小朋友" size="sm">
        <div className="space-y-2">
          {childMembers.map(child => (
            <button
              key={child.id}
              onClick={() => { setChild(child.id); setOpen(false); }}
              className={cn(
                'w-full flex items-center gap-3 p-3 rounded-cute transition-colors',
                child.id === currentChildId
                  ? 'bg-star-100 border-2 border-star-400'
                  : 'bg-slate-50 hover:bg-star-50 border-2 border-transparent'
              )}
            >
              <Avatar emoji={child.avatar_emoji} size="md" />
              <div className="flex-1 text-left">
                <div className="font-medium">{child.name}</div>
                <div className="text-xs text-slate-400">{child.coin_balance} 金币</div>
              </div>
              {child.id === currentChildId && (
                <span className="text-star-500 text-sm font-medium">当前</span>
              )}
            </button>
          ))}
        </div>
      </Modal>
    </>
  );
}
