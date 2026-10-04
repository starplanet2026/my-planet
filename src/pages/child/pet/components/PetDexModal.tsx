import { useState, useEffect } from 'react';
import { Modal } from '../../../../components/common/Modal';
import { Loading } from '../../../../components/common/Loading';
import { EmptyState } from '../../../../components/common/EmptyState';
import { useToastStore } from '../../../../store/toastStore';
import { usePetTraits } from '../../../../hooks/usePetTraits';
import { cn } from '../../../../lib/utils';
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
  const { traitMap } = usePetTraits();
  const [items, setItems] = useState<PetShopItem[]>([]);
  const [pets, setPets] = useState<Pet[]>([]);
  const [loading, setLoading] = useState(true);
  const [subFilter, setSubFilter] = useState<'all' | 'dog' | 'cat'>('all');

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

  // 稀有度排序权重: epic > rare > common
  const rarityRank: Record<PetRarity, number> = { epic: 3, rare: 2, common: 1 };

  // 筛选 + 排序: 史诗-稀有-普通, 每种稀有度下先狗后猫
  const visibleItems = items
    .filter(it => subFilter === 'all' ? true : it.subcategory === subFilter)
    .sort((a, b) => {
      const rDiff = rarityRank[b.rarity] - rarityRank[a.rarity];
      if (rDiff !== 0) return rDiff;
      // 先狗后猫
      const dogFirst = (s: PetShopItem) => (s.subcategory === 'dog' ? 0 : 1);
      return dogFirst(a) - dogFirst(b);
    });

  const filteredOwnedCount = visibleItems.filter(it => getOwnedPet(it.id)).length;

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
          {/* 子分类筛选 + 收集进度 */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              {([
                { key: 'all' as const, label: '全部', emoji: '🐾' },
                { key: 'dog' as const, label: '狗', emoji: '🐶' },
                { key: 'cat' as const, label: '猫', emoji: '🐱' },
              ]).map(t => (
                <button
                  key={t.key}
                  onClick={() => setSubFilter(t.key)}
                  className={cn(
                    'px-3 py-1 rounded-full text-xs font-medium transition-colors',
                    subFilter === t.key
                      ? 'bg-purple-500 text-white'
                      : 'bg-slate-100 text-slate-500 hover:bg-slate-200',
                  )}
                >
                  {t.emoji} {t.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1 rounded-xl bg-purple-50 px-3 py-1">
              <span className="text-lg font-bold text-purple-600">{filteredOwnedCount}</span>
              <span className="text-sm text-purple-400">/ {visibleItems.length}</span>
            </div>
          </div>

          {/* 宠物网格 - 一行5个，仅展示图片+品种名+稀有度+特质+是否拥有 */}
          <div className="grid grid-cols-5 gap-2">
            {visibleItems.map(item => {
              const ownedPet = getOwnedPet(item.id);
              const owned = !!ownedPet;
              const traitName = item.trait_id ? traitMap[item.trait_id]?.name : null;
              const hasTrait = !!traitName;
              return (
                <div
                  key={item.id}
                  className={cn(
                    'rounded-xl border-2 p-1.5 flex flex-col items-center gap-0.5 transition-all',
                    owned ? 'border-emerald-300 bg-white' : 'border-slate-100 bg-slate-50/60',
                  )}
                >
                  {/* 宠物图标 - 竖版3:4 */}
                  <div className="w-full aspect-[3/4] rounded-lg bg-slate-50 flex items-center justify-center overflow-hidden">
                    {item.image_url ? (
                      <img src={item.image_url} alt={item.breed || item.name || '宠物'} className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-xl">{item.emoji || '🐾'}</span>
                    )}
                  </div>

                  {/* 品种名 */}
                  <p className="text-[10px] font-medium text-slate-700 text-center truncate w-full">
                    {item.breed || item.name || '未命名'}
                  </p>

                  {/* 稀有度 + 特质 同一行 */}
                  <div className="flex items-center gap-1 w-full">
                    <span
                      className={cn(
                        'text-[8px] px-1 py-0.5 rounded-full font-medium shrink-0',
                        rarityStyle[item.rarity],
                      )}
                    >
                      {rarityLabel[item.rarity]}
                    </span>
                    <span
                      className={cn(
                        'text-[8px] truncate flex-1 text-center',
                        hasTrait ? 'text-teal-600' : 'text-slate-400',
                      )}
                    >
                      {traitName || '无特质'}
                    </span>
                  </div>

                  {/* 是否拥有 */}
                  <span
                    className={cn(
                      'text-[8px] px-1 py-0.5 rounded-full font-medium',
                      owned ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-400',
                    )}
                  >
                    {owned ? '已拥有' : '未拥有'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Modal>
  );
}
