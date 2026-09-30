import { useState, useEffect } from 'react';
import { useToastStore } from '../../../../store/toastStore';
import { useFamilyStore } from '../../../../store/familyStore';
import { useModeStore } from '../../../../store/modeStore';
import { cn } from '../../../../lib/utils';
import { X } from 'lucide-react';
import { interactWithPet, checkPet, claimPetCoins, fetchPetInventory, healSevereIllness, getSevereIllnessCost } from '../../../../api/pets';
import type { Pet, PetInventory, PetSubcategory, TRAIT_DESC } from '../../../../api/types';

const ACTION_SUBCAT: Record<string, PetSubcategory> = {
  feed: 'food',
  clean: 'clean',
  play: 'toy',
};

// 根据宠物病症动态返回 heal 所需药品子分类
function getHealSubcategory(pet: Pet): PetSubcategory | null {
  if (pet.has_stomach_issue) return 'stomach_medicine';
  if (pet.has_skin_issue) return 'deworming_medicine';
  return null;
}

const SECTIONS = [
  { key: 'feed', stat: 'hunger' as const, max: 100, label: '体力', icon: '🍖', color: 'bg-orange-400', btnLabel: '喂食', btnColor: 'bg-orange-100 hover:bg-orange-200 text-orange-600' },
  { key: 'clean', stat: 'clean' as const, max: 100, label: '清洁', icon: '🧼', color: 'bg-sky-400', btnLabel: '清洁', btnColor: 'bg-sky-100 hover:bg-sky-200 text-sky-600' },
  { key: 'play', stat: 'happiness' as const, max: 300, label: '心情', icon: '💖', color: 'bg-pink-400', btnLabel: '玩耍', btnColor: 'bg-pink-100 hover:bg-pink-200 text-pink-600' },
  { key: 'heal', stat: 'health' as const, max: 100, label: '健康', icon: '💊', color: 'bg-emerald-400', btnLabel: '喂药', btnColor: 'bg-emerald-100 hover:bg-emerald-200 text-emerald-600' },
] as const;

function StatBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
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
  const family = useFamilyStore(s => s.family);
  const currentChildId = useModeStore(s => s.currentChildId);
  const childId = currentChildId ?? '';

  const [currentPet, setCurrentPet] = useState(pet);
  const [inventory, setInventory] = useState<PetInventory[]>([]);
  const [acting, setActing] = useState<string | null>(null);
  const [severeCost, setSevereCost] = useState(20);
  const [showSevereConfirm, setShowSevereConfirm] = useState(false);

  const loadInventory = async () => {
    try {
      const data = await fetchPetInventory(childId);
      setInventory(data);
    } catch (e: any) {
      console.error('加载背包失败', e);
    }
  };

  useEffect(() => { loadInventory(); }, [childId]);

  // 加载重病就医消耗
  useEffect(() => {
    if (family?.id) {
      getSevereIllnessCost(family.id).then(setSevereCost).catch(() => {});
    }
  }, [family?.id]);

  const getItem = (action: string): PetInventory | undefined => {
    let sub: PetSubcategory | undefined = ACTION_SUBCAT[action];
    if (action === 'heal') {
      sub = getHealSubcategory(currentPet) ?? undefined;
    }
    if (!sub) return undefined;
    return inventory.find(i => i.subcategory === sub && i.quantity > 0);
  };

  const handleInteract = async (action: string) => {
    // Bug1 修复：生病时禁止非 heal 互动
    if (currentPet.is_sick && action !== 'heal') {
      toast.info('宠物生病了，请先治愈');
      return;
    }
    // 重病时 heal 提示需就医
    if (action === 'heal' && currentPet.has_severe_illness) {
      setShowSevereConfirm(true);
      return;
    }
    if (action === 'heal' && !currentPet.is_sick) {
      toast.info('宠物没有生病');
      return;
    }
    const item = getItem(action);
    if (!item) {
      if (action === 'heal') {
        toast.error('背包无对应药品，去商店购买');
      } else {
        toast.error('背包无此物品，去商店购买');
      }
      return;
    }
    setActing(action);
    try {
      const prevCoin = currentPet.coin_balance || 0;
      const prevHealth = currentPet.health || 0;
      const updated = await interactWithPet(childId, currentPet.id, action, item.item_id);
      // 检查 heal 是否成功（health 恢复到 100）
      if (action === 'heal') {
        if ((updated.health || 0) >= 100 && prevHealth < 100) {
          toast.success('药品有效！宠物已恢复健康 🎉');
        } else {
          toast.info('药品无效，请使用对应药品');
        }
      } else if ((updated.coin_balance || 0) > prevCoin) {
        toast.success('获得今日金币 💰');
      } else if (updated.level > currentPet.level) {
        toast.success(`升级！现在 Lv.${updated.level}`);
      } else if (action === 'play') {
        toast.success(`玩耍成功，心情+${Math.round(updated.happiness - currentPet.happiness)}，当前${Math.round(updated.happiness)}/300`);
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

  // 重病就医：去宠物医院
  const handleHealSevere = async () => {
    setShowSevereConfirm(false);
    setActing('heal_severe');
    try {
      const result = await healSevereIllness(childId, currentPet.id);
      if (result.success) {
        toast.success(`治疗成功！花费 ${severeCost} 星光值，宠物已恢复健康 🎉`);
        refreshMembers();
        const updated = await checkPet(currentPet.id);
        setCurrentPet(updated);
        onUpdated(updated);
      } else {
        toast.error(result.message || '治疗失败');
      }
    } catch (e: any) {
      toast.error(e?.message ?? '治疗失败');
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
        {/* 头部：名字 + 等级 + 特质 + 关闭 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-slate-800 text-base">{currentPet.name}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-600 font-medium">Lv.{currentPet.level}</span>
            {currentPet.trait && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-600 font-medium"
                title={TRAIT_DESC[currentPet.trait] || ''}
              >
                🌟 {currentPet.trait}
              </span>
            )}
          </div>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-slate-100 text-slate-400">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 疾病提示 */}
        {(currentPet.has_stomach_issue || currentPet.has_skin_issue || currentPet.has_severe_illness) && (
          <div className="space-y-1">
            {currentPet.has_stomach_issue && (
              <div className="text-xs text-orange-600 bg-orange-50 px-2 py-1 rounded-lg">
                🤢 主人，我肠胃不适了，快来帮我买肠胃药
              </div>
            )}
            {currentPet.has_skin_issue && (
              <div className="text-xs text-teal-600 bg-teal-50 px-2 py-1 rounded-lg">
                🐛 主人，我身上有虫了，快来帮我买驱虫药
              </div>
            )}
            {currentPet.has_severe_illness && (
              <div className="text-xs text-red-600 bg-red-50 px-2 py-1 rounded-lg flex items-center justify-between">
                <span>🏥 主人，我生重病了，快带我去医院吧</span>
                <button
                  onClick={() => setShowSevereConfirm(true)}
                  disabled={acting === 'heal_severe'}
                  className="px-2 py-0.5 rounded bg-red-500 text-white text-[10px] font-bold disabled:opacity-50 active:scale-95"
                >
                  就医 ({severeCost}⭐)
                </button>
              </div>
            )}
          </div>
        )}

        {/* 4 板块：每板块上方血条 + 下方按钮 */}
        <div className="grid grid-cols-2 gap-3">
          {SECTIONS.map(section => {
            const item = getItem(section.key);
            const statValue = currentPet[section.stat];
            const isSick = currentPet.is_sick;
            const isSevere = currentPet.has_severe_illness;
            // Bug1 修复：生病时禁用非 heal 按钮；重病时 heal 也禁用（需就医）
            const disabled = !!acting
              || (isSick && section.key !== 'heal')
              || (section.key === 'heal' && !isSick)
              || (section.key === 'heal' && isSevere);
            const playDisabled = section.key === 'play' && statValue >= section.max;
            return (
              <div
                key={section.key}
                className={cn(
                  'rounded-2xl p-3 space-y-2 border-2 transition-colors',
                  (disabled || playDisabled)
                    ? 'border-slate-100 bg-slate-50'
                    : 'border-slate-100 bg-white'
                )}
              >
                {/* 标签 + 数值 */}
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1 text-xs font-medium text-slate-600">
                    <span>{section.icon}</span>
                    {section.label}
                    {section.key === 'play' && (
                      <span className="text-[9px] text-slate-400">({Math.round(statValue)}/300)</span>
                    )}
                  </span>
                  <span className="text-xs font-bold text-slate-500">{Math.round(statValue)}</span>
                </div>
                {/* 血条 */}
                <StatBar value={statValue} max={section.max} color={section.color} />
                {/* 按钮 */}
                <button
                  onClick={() => handleInteract(section.key)}
                  disabled={disabled || playDisabled}
                  className={cn(
                    'w-full py-2 rounded-xl text-xs font-bold transition-colors active:scale-95',
                    (disabled || playDisabled) ? 'bg-slate-100 text-slate-300' : section.btnColor,
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

        {/* 心情提示 */}
        <p className="text-[10px] text-slate-400 text-center">
          体力/清洁/心情各满100即可领取当日金币。心情达100/200/300各+10经验（共30），托管可一次性补满至300。
        </p>

        {/* 领取金币 */}
        {currentPet.coin_balance >= 1 && (
          <button
            onClick={async () => {
              if (currentPet.is_sick) {
                toast.info('宠物生病了，请先治愈');
                return;
              }
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
            disabled={acting === 'claim' || currentPet.is_sick}
            className="w-full py-2 rounded-xl bg-amber-400 text-white text-sm font-bold disabled:opacity-50 active:scale-95"
          >
            {acting === 'claim' ? '领取中...' : `💰 领取 ${Math.floor(currentPet.coin_balance)} 金币`}
          </button>
        )}
      </div>

      {/* 重病就医确认弹窗 */}
      {showSevereConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50" onClick={() => setShowSevereConfirm(false)}>
          <div
            className="bg-white rounded-3xl shadow-2xl w-[80vw] max-w-xs p-5 space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="text-center space-y-2">
              <div className="text-3xl">🏥</div>
              <h3 className="font-bold text-slate-800 text-base">宠物重病就医</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                宠物生重病了，吃药没用，是否花费 <span className="text-amber-600 font-bold">{severeCost}</span> 星光值送宠物去医院？
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowSevereConfirm(false)}
                className="flex-1 py-2 rounded-xl bg-slate-100 text-slate-600 text-sm font-bold active:scale-95"
              >
                取消
              </button>
              <button
                onClick={handleHealSevere}
                disabled={acting === 'heal_severe'}
                className="flex-1 py-2 rounded-xl bg-red-500 text-white text-sm font-bold disabled:opacity-50 active:scale-95"
              >
                {acting === 'heal_severe' ? '治疗中...' : `确认就医 (${severeCost}⭐)`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
