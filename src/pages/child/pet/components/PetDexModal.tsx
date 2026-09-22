import { useState, useEffect } from 'react';
import { Modal } from '../../../../components/common/Modal';
import { Loading } from '../../../../components/common/Loading';
import { EmptyState } from '../../../../components/common/EmptyState';
import { useToastStore } from '../../../../store/toastStore';
import { cn } from '../../../../lib/utils';
import { Star, Crown, Coins } from 'lucide-react';
import { fetchPetShopItems, fetchPets } from '../../../../api/pets';
import type { PetShopItem, Pet, PetRarity } from '../../../../api/types';

// 稀有度配色
const rarityStyle: Record<PetRarity, string> = {
  common: 'bg-slate-100 text-slate-500',
  rare: 'bg-blue-100 text-blue-600',
  epic: 'bg-purple-100 text-purple-600',
};

const rarityLabel: Record<PetRarity, string> = {
  common: '普通',
  rare: '稀有',
  epic: '史诗',
};

export function PetDexModal({ familyId, memberId, onClose }: {
  familyId: string;
  memberId: string;
  onClose: () => void;
}) {
  const toast = useToastStore();
  const [items, setItems] = useState<PetShopItem[]>([]);
  const [pets, setPets] = useState<Pet[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, [familyId, memberId]);

  const load = async () => {
    setLoading(true);
    try {
      const [itemsData, petsData] = await Promise.all([
        fetchPetShopItems('pet'),
        fetchPets(memberId),
      ]);
      setItems(itemsData);
      setPets(petsData);
    } catch (e: any) {
      toast.error(e?.message ?? '加载图鉴失败');
    } finally {
      setLoading(false);
    }
  };

  // 通过 shop_item_id 关联判断是否已领养
  const getOwnedPet = (itemId: string): Pet | undefined =>
    pets.find(p => p.shop_item_id === itemId);

  // 已领养且达到满级
  const isMaxLevel = (itemId: string): boolean => {
    const pet = getOwnedPet(itemId);
    return !!pet && pet.level >= pet.max_level;
  };

  // 统计：已收集 / 总数
  const ownedCount = items.filter(it => getOwnedPet(it.id)).length;

  return (
    <Modal open onClose={onClose} title="宠物图鉴" size="lg">
      {loading ? (
        <Loading text="加载图鉴..." />
      ) : items.length === 0 ? (
        <EmptyState
          icon="🐾"
          title="暂无可领养宠物"
          description="去商店添加更多宠物吧"
        />
      ) : (
        <div className="space-y-4">
          {/* 收集进度 */}
          <div className="flex items-center justify-between rounded-xl bg-purple-50 px-4 py-2">
            <span className="text-sm text-purple-600">收集进度</span>
            <div className="flex items-center gap-1">
              <span className="text-lg font-bold text-purple-600">{ownedCount}</span>
              <span className="text-sm text-purple-400">/ {items.length}</span>
            </div>
          </div>

          {/* 宠物网格 */}
          <div className="grid grid-cols-3 gap-3">
            {items.map(item => {
              const ownedPet = getOwnedPet(item.id);
              const owned = !!ownedPet;
              const maxLevel = isMaxLevel(item.id);
              return (
                <div
                  key={item.id}
                  className={cn(
                    'rounded-2xl border-2 p-3 flex flex-col items-center gap-1.5 transition-all',
                    owned ? 'border-emerald-200 bg-white' : 'border-slate-100 bg-slate-50/60',
                  )}
                >
                  {/* 宠物图标 */}
                  <div className="w-full aspect-[3/4] rounded-2xl bg-slate-50 flex items-center justify-center overflow-hidden">
                    {item.image_url ? (
                      <img src={item.image_url} alt={item.name ?? '宠物'} className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-3xl">{item.emoji || '🐾'}</span>
                    )}
                  </div>

                  {/* 名字 */}
                  <p className="text-sm font-medium text-slate-700 text-center truncate w-full">
                    {item.name ?? '未命名'}
                  </p>

                  {/* 基础产金 */}
                  <div className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-yellow-50">
                    <Coins className="w-3 h-3 text-yellow-600" />
                    <span className="text-[10px] font-bold text-yellow-600">
                      {item.base_coin_per_day}/天
                    </span>
                  </div>

                  {/* 等级 */}
                  {owned && ownedPet && (
                    <div className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-amber-100">
                      <Star className="w-3 h-3 text-amber-500" />
                      <span className="text-[10px] font-bold text-amber-600">
                        Lv.{ownedPet.level}
                      </span>
                    </div>
                  )}

                  {/* 状态标签 */}
                  <div className="flex flex-wrap items-center justify-center gap-1 mt-0.5">
                    <span
                      className={cn(
                        'text-[10px] px-2 py-0.5 rounded-full font-medium',
                        owned ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-500',
                      )}
                    >
                      {owned ? '已拥有' : '未解锁'}
                    </span>
                    {maxLevel && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] px-2 py-0.5 rounded-full font-medium bg-amber-100 text-amber-600">
                        <Crown className="w-3 h-3" />
                        满级
                      </span>
                    )}
                    <span
                      className={cn(
                        'text-[10px] px-1.5 py-0.5 rounded-full font-medium',
                        rarityStyle[item.rarity],
                      )}
                    >
                      {rarityLabel[item.rarity]}
                    </span>
                  </div>
                </div>
              );
            })}

            {/* 锁定预告卡 */}
            <div
              className={cn(
                'rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/60 p-3 flex flex-col items-center justify-center gap-1.5 text-center',
                'opacity-70 select-none'
              )}
              aria-disabled="true"
            >
              <div className="text-3xl">🔒</div>
              <p className="text-[11px] font-medium text-slate-500 leading-tight">
                领养满 2 只宠物后解锁更多萌宠
              </p>
              <p className="text-[10px] text-slate-400">
                当前: {Math.min(pets.length, 2)}/2
              </p>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
