import { useState } from 'react';
import { Star } from 'lucide-react';
import { Button } from '../../../../components/common/Button';
import { ConfirmDialog } from '../../../../components/common/ConfirmDialog';
import { useToastStore } from '../../../../store/toastStore';
import { cn } from '../../../../lib/utils';
import { upgradeDogHouse } from '../../../../api/pets';
import type { DogHouse } from '../../../../api/types';

// 狗窝容量信息条：显示在草地上方，展示容量与升级入口
export function DogHouseBar({ dogHouse, memberId, onUpgraded }: {
  dogHouse: DogHouse;
  memberId: string;
  onUpgraded: () => void;
}) {
  const toast = useToastStore();
  const [upgrading, setUpgrading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // 宠物已满：高亮升级按钮提示扩容
  const isFull = dogHouse.current_pet_count >= dogHouse.capacity;

  const handleUpgrade = async () => {
    setUpgrading(true);
    try {
      const result = await upgradeDogHouse(memberId);
      if (result.success) {
        toast.success(result.message);
        onUpgraded();
      } else {
        toast.error(result.message);
      }
    } catch (e: any) {
      toast.error(e?.message ?? '升级失败');
    } finally {
      setUpgrading(false);
    }
  };

  return (
    <div
      className={cn(
        'flex items-center gap-3 px-4 py-2.5 rounded-2xl border',
        'bg-gradient-to-r from-green-50 to-emerald-50 border-green-200'
      )}
    >
      {/* 狗窝图标 + 容量 */}
      <span className="text-2xl">🏠</span>
      <div className="flex flex-col">
        <span className="text-[11px] text-green-600 font-medium">狗窝 Lv.{dogHouse.level}</span>
        <span
          className={cn(
            'text-sm font-bold',
            isFull ? 'text-red-500' : 'text-slate-700'
          )}
        >
          宠物 {dogHouse.current_pet_count}/{dogHouse.capacity}
        </span>
      </div>

      {/* 升级费用 + 升级按钮 */}
      <div className="ml-auto flex items-center gap-2">
        <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-amber-100">
          <Star className="w-3.5 h-3.5 text-amber-500" />
          <span className="text-xs font-bold text-amber-600">{dogHouse.upgrade_cost}</span>
        </div>
        <Button
          size="sm"
          variant={isFull ? 'primary' : 'secondary'}
          loading={upgrading}
          onClick={() => setShowConfirm(true)}
          className={cn(isFull && 'animate-pulse')}
        >
          {isFull ? '已满，升级扩容' : '升级'}
        </Button>
      </div>

      {/* 升级确认弹窗 */}
      <ConfirmDialog
        open={showConfirm}
        title="升级狗窝"
        message={`消耗 ${dogHouse.upgrade_cost} ⭐ 升级狗窝到 Lv.${dogHouse.level + 1}，扩大宠物容量？`}
        confirmText="升级"
        onConfirm={handleUpgrade}
        onClose={() => setShowConfirm(false)}
      />
    </div>
  );
}
