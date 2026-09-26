import { useState, useEffect } from 'react';
import { Modal } from '../../../../components/common/Modal';
import { useToastStore } from '../../../../store/toastStore';
import { useFamilyStore } from '../../../../store/familyStore';
import { useModeStore } from '../../../../store/modeStore';
import { cn } from '../../../../lib/utils';
import {
  buyBoardingCard, setBoardingSelection, getBoardingStatus,
  fetchPets, checkPet, fetchPetShopItems, runBoardingCare,
} from '../../../../api/pets';
import type { Pet, BoardingStatus, PetShopItem } from '../../../../api/types';

export function PetBoardingModal({ onClose, onBoarded }: {
  onClose: () => void;
  onBoarded: () => void;
}) {
  const toast = useToastStore();
  const refreshMembers = useFamilyStore(s => s.refreshMembers);
  const currentChildId = useModeStore(s => s.currentChildId);
  const childId = currentChildId ?? '';

  const [status, setStatus] = useState<BoardingStatus | null>(null);
  const [pets, setPets] = useState<Pet[]>([]);
  const [cards, setCards] = useState<PetShopItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);

  const loadData = async () => {
    if (!childId) return;
    setLoading(true);
    try {
      const [s, petList, fosterCards] = await Promise.all([
        getBoardingStatus(childId),
        fetchPets(childId),
        fetchPetShopItems('supply', 'foster'),
      ]);
      const checked = await Promise.all(petList.map(p => checkPet(p.id)));
      setStatus(s);
      setCards(fosterCards);
      const nonStudy = checked.filter(p => !p.is_studying);
      setPets(nonStudy);
      // 用已保存的选择初始化
      setSelectedIds(new Set(s.selected_pet_ids || []));
    } catch (e: any) {
      toast.error(e?.message ?? '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // 懒加载兜底：触发今日托管养护（cron 每日0点也会执行）
    if (childId) runBoardingCare(childId).catch(() => {});
  }, [childId]);

  const handleBuyCard = async (itemId: string) => {
    setActing(itemId);
    try {
      const result = await buyBoardingCard(childId, itemId);
      if (result.success) {
        toast.success(result.message || '购买成功');
        refreshMembers();
        loadData();
      } else {
        toast.error(result.message || '购买失败');
      }
    } catch (e: any) {
      toast.error(e?.message ?? '购买失败');
    } finally {
      setActing(null);
    }
  };

  // 切换宠物托管状态：开启/取消，点击即保存到后端
  const handleToggleBoarding = async (petId: string) => {
    if (!status?.has_active_card) {
      toast.warning('请先购买托管卡');
      return;
    }
    const nextIds = new Set(selectedIds);
    const willEnable = !nextIds.has(petId);
    if (willEnable) nextIds.add(petId);
    else nextIds.delete(petId);
    setActing(petId);
    try {
      const result = await setBoardingSelection(childId, [...nextIds]);
      if (result.success) {
        setSelectedIds(nextIds);
        toast.success(willEnable ? (result.message || '已开启托管') : '已取消托管');
        onBoarded();
      } else {
        toast.error(result.message || '操作失败');
      }
    } catch (e: any) {
      toast.error(e?.message ?? '操作失败');
    } finally {
      setActing(null);
    }
  };

  const boardedSet = new Set(status?.today_boarded_pet_ids || []);

  return (
    <Modal open onClose={onClose} title="宠托师·托管" size="md">
      {loading ? (
        <div className="text-center py-10 text-sm text-slate-400">加载中...</div>
      ) : (
        <div className="space-y-4">
          {/* 托管卡状态 */}
          <div className="rounded-2xl bg-gradient-to-r from-indigo-50 to-purple-50 p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-slate-700">🏠 宠托师托管</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {status?.has_active_card
                    ? `有效托管卡至 ${status.card_end_date}`
                    : '暂无有效托管卡'}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-slate-400">今日已托管</p>
                <p className="text-lg font-bold text-indigo-600">{boardedSet.size} 只</p>
              </div>
            </div>
          </div>

          {/* 购买托管卡 */}
          <div>
            <h4 className="text-sm font-bold text-slate-700 mb-2">购买托管卡</h4>
            {cards.length === 0 ? (
              <div className="text-center py-4 text-xs text-slate-400">暂无托管卡，请联系家长添加</div>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {cards.map(card => (
                  <button
                    key={card.id}
                    onClick={() => handleBuyCard(card.id)}
                    disabled={acting === card.id}
                    className={cn(
                      'rounded-xl border-2 border-slate-100 bg-white p-2 text-center transition-all hover:border-indigo-300 active:scale-95 disabled:opacity-50'
                    )}
                  >
                    <div className="text-2xl mb-1">{card.emoji || '🏠'}</div>
                    <p className="text-xs font-bold text-slate-700 truncate">{card.name}</p>
                    <p className="text-[10px] text-slate-400">有效期{card.valid_days || 1}天</p>
                    <p className="text-sm font-bold text-amber-500 mt-1">{card.price_star}⭐</p>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 托管宠物列表：每只宠物右侧独立托管按钮 */}
          {pets.length === 0 ? (
            <div className="text-center py-6 text-sm text-slate-400">暂无宠物可托管</div>
          ) : (
            <div className="space-y-2 max-h-52 overflow-y-auto">
              {pets.map(pet => {
                const boarded = boardedSet.has(pet.id);
                const sick = pet.is_sick;
                const selected = selectedIds.has(pet.id);
                const isActing = acting === pet.id;
                return (
                  <div
                    key={pet.id}
                    className={cn(
                      'flex items-center gap-3 p-2.5 rounded-xl border-2 transition-all',
                      selected
                        ? 'border-indigo-400 bg-indigo-50'
                        : sick
                          ? 'border-slate-100 bg-slate-50 opacity-60'
                          : 'border-slate-100 bg-white'
                    )}
                  >
                    <div className="w-9 h-9 flex items-center justify-center rounded-lg bg-amber-50 overflow-hidden flex-shrink-0">
                      {pet.image_url ? (
                        <img src={pet.image_url} alt={pet.name} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-lg">{pet.emoji || '🐾'}</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-slate-700 truncate">{pet.name}</p>
                      <p className="text-[10px] text-slate-400">
                        {boarded ? '✅ 今日已托管' : sick ? '🤒 生病中，无法托管' : selected ? `Lv.${pet.level} · 🏠 托管中` : `Lv.${pet.level} · ${pet.base_coin_per_day || 0}💰/天`}
                      </p>
                    </div>
                    <button
                      onClick={() => !sick && !isActing && handleToggleBoarding(pet.id)}
                      disabled={sick || isActing}
                      className={cn(
                        'flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold transition-all active:scale-95',
                        selected
                          ? 'bg-indigo-500 text-white hover:bg-indigo-600'
                          : sick
                            ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                            : 'bg-amber-400 text-white hover:bg-amber-500 disabled:opacity-50'
                      )}
                    >
                      {isActing ? '处理中…' : selected ? '取消托管' : '托管'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <p className="text-[10px] text-slate-400 text-center leading-relaxed">
            托管卡为养护权限门票，购买不直接回满属性。<br />
            每日 0 点自动为勾选宠物养护：1星光=5属性点，星光不足则跳过、保留资格。<br />
            三项属性补满后发放该宠物每日金币奖励。
          </p>
        </div>
      )}
    </Modal>
  );
}
