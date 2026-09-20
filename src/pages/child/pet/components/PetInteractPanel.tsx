import { useState, useEffect } from 'react';
import { useToastStore } from '../../../../store/toastStore';
import { useFamilyStore } from '../../../../store/familyStore';
import { useModeStore } from '../../../../store/modeStore';
import { cn } from '../../../../lib/utils';
import { X } from 'lucide-react';
import { interactWithPet, checkPet, claimPetCoins, fetchPetInventory } from '../../../../api/pets';
import type { Pet, PetInventory, PetSubcategory } from '../../../../api/types';

const ACTION_SUBCAT: Record<string, PetSubcategory> = {
  feed: 'food',
  clean: 'clean',
  play: 'toy',
  heal: 'medicine',
};

const SECTIONS = [
  { key: 'feed', stat: 'hunger' as const, label: '体力', icon: '🍖', color: 'bg-orange-400', btnLabel: '喂食', btnColor: 'bg-orange-100 hover:bg-orange-200 text-orange-600' },
  { key: 'clean', stat: 'clean' as const, label: '清洁', icon: '🧼', color: 'bg-sky-400', btnLabel: '清洁', btnColor: 'bg-sky-100 hover:bg-sky-200 text-sky-600' },
  { key: 'play', stat: 'happiness' as const, label: '心情', icon: '💖', color: 'bg-pink-400', btnLabel: '玩耍', btnColor: 'bg-pink-100 hover:bg-pink-200 text-pink-600' },
  { key: 'heal', stat: 'health' as const, label: '健康', icon: '💊', color: 'bg-emerald-400', btnLabel: '就医', btnColor: 'bg-emerald-100 hover:bg-emerald-200 text-emerald-600' },
] as const;

function StatBar({ value, color }: { value: number; color: string }) {
  const pct = Math.max(0, Math.min(100, value));
  const barColor = pct > 60 ? color : pct > 30 ? 'bg-yellow-400' : 'bg-red-400';
  return (
    <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
      <div className={cn('h-full rounded-full transition-all', barColor)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function PetInteractPanel({ pet, onClose, onUpdated }: {
  pet: Pet;
  onClose: () => void;
  onUpdated: (pet: Pet) => void;
}) {
  const toast = useToastStore();
  const refreshMembers = useFamilyStore(s => s.refreshMembers);
  const currentChildId = useModeStore(s => s.currentChildId);
  const childId = currentChildId ?? '';

  const [currentPet, setCurrentPet] = useState(pet);
  const [inventory, setInventory] = useState<PetInventory[]>([]);
  const [acting, setActing] = useState<string | null>(null);

  const loadInventory = async () => {
    try {
      const data = await fetchPetInventory(childId);
      setInventory(data);
    } catch (e: any) {
      console.error('加载背包失败', e);
    }
  };

  useEffect(() => { loadInventory(); }, [childId]);

  const getItem = (action: string): PetInventory | undefined => {
    const sub = ACTION_SUBCAT[action];
    return inventory.find(i => i.subcategory === sub && i.quantity > 0);
  };

  const handleInteract = async (action: string) => {
    const item = getItem(action);
    if (!item) {
      toast.error('背包无此物品，去商店购买');
      return;
    }
    setActing(action);
    try {
      // interact_with_pet 现在返回更新后的宠物完整行（含 exp / level）
      const updated = await interactWithPet(childId, currentPet.id, action, item.item_id);
      if (updated.level > currentPet.level) {
        toast.success(`升级！现在 Lv.${updated.level}`);
      } else {
        toast.success('互动成功');
      }
      refreshMembers();
      setCurrentPet(updated);
      onUpdated(updated);
      loadInventory();
    } catch (e: any) {
      toast.error(e?.message ?? '操作失败');
    } finally {
      setActing(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div
        className="bg-white rounded-3xl shadow-2xl w-[90vw] max-w-sm p-4 space-y-3"
        onClick={e => e.stopPropagation()}
      >
        {/* 头部：名字 + 等级 + 关闭 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-800 text-base">{currentPet.name}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-600 font-medium">Lv.{currentPet.level}</span>
          </div>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-slate-100 text-slate-400">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 4 板块：每板块上方血条 + 下方按钮 */}
        <div className="grid grid-cols-2 gap-3">
          {SECTIONS.map(section => {
            const item = getItem(section.key);
            const statValue = currentPet[section.stat];
            const disabled = !!acting || (section.key === 'heal' && !currentPet.is_sick);
            return (
              <div
                key={section.key}
                className={cn(
                  'rounded-2xl p-3 space-y-2 border-2 transition-colors',
                  disabled && section.key === 'heal' && !currentPet.is_sick
                    ? 'border-slate-100 bg-slate-50'
                    : 'border-slate-100 bg-white'
                )}
              >
                {/* 标签 + 数值 */}
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1 text-xs font-medium text-slate-600">
                    <span>{section.icon}</span>
                    {section.label}
                  </span>
                  <span className="text-xs font-bold text-slate-500">{Math.round(statValue)}</span>
                </div>
                {/* 血条 */}
                <StatBar value={statValue} color={section.color} />
                {/* 按钮 */}
                <button
                  onClick={() => handleInteract(section.key)}
                  disabled={disabled}
                  className={cn(
                    'w-full py-2 rounded-xl text-xs font-bold transition-colors active:scale-95',
                    disabled ? 'bg-slate-100 text-slate-300' : section.btnColor,
                  )}
                >
                  {acting === section.key ? '...' : section.btnLabel}
                  <span className="ml-1 text-[10px] opacity-60">
                    {item ? `x${item.quantity}` : '空'}
                  </span>
                </button>
              </div>
            );
          })}
        </div>

        {/* 领取金币 */}
        {currentPet.coin_balance >= 1 && (
          <button
            onClick={async () => {
              setActing('claim');
              try {
                const result = await claimPetCoins(childId, currentPet.id);
                if (result.success) {
                  toast.success(result.message);
                  refreshMembers();
                  const updated = await checkPet(currentPet.id);
                  setCurrentPet(updated);
                  onUpdated(updated);
                } else {
                  toast.error(result.message);
                }
              } catch (e: any) {
                toast.error(e?.message ?? '领取失败');
              } finally {
                setActing(null);
              }
            }}
            disabled={acting === 'claim'}
            className="w-full py-2 rounded-xl bg-amber-400 text-white text-sm font-bold disabled:opacity-50 active:scale-95"
          >
            {acting === 'claim' ? '领取中...' : `💰 领取 ${Math.floor(currentPet.coin_balance)} 金币`}
          </button>
        )}
      </div>
    </div>
  );
}
