import { useState, useEffect } from 'react';
import { Modal } from '../../../../components/common/Modal';
import { useToastStore } from '../../../../store/toastStore';
import { useFamilyStore } from '../../../../store/familyStore';
import { useModeStore } from '../../../../store/modeStore';
import { cn } from '../../../../lib/utils';
import { X } from 'lucide-react';
import { buyBoardingCard, boardPets, getBoardingStatus, fetchPets, checkPet } from '../../../../api/pets';
import type { Pet, BoardingStatus, BoardingCardType } from '../../../../api/types';

const CARDS: { type: BoardingCardType; name: string; days: number; price: number; emoji: string; desc: string }[] = [
  { type: 'daily', name: '托管日卡', days: 1, price: 1, emoji: '📅', desc: '有效期1天' },
  { type: 'weekly', name: '托管周卡', days: 7, price: 6, emoji: '📆', desc: '有效期7天' },
  { type: 'monthly', name: '托管月卡', days: 30, price: 25, emoji: '🗓️', desc: '有效期30天' },
];

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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);

  const loadData = async () => {
    if (!childId) return;
    setLoading(true);
    try {
      const [s, petList] = await Promise.all([
        getBoardingStatus(childId),
        fetchPets(childId),
      ]);
      const checked = await Promise.all(petList.map(p => checkPet(p.id)));
      setStatus(s);
      const nonStudy = checked.filter(p => !p.is_studying);
      setPets(nonStudy);
      const boarded = new Set(s.today_boarded_pet_ids || []);
      const defaultSel = new Set<string>();
      nonStudy.forEach(p => {
        if (!p.is_sick && !boarded.has(p.id)) defaultSel.add(p.id);
      });
      setSelectedIds(defaultSel);
    } catch (e: any) {
      toast.error(e?.message ?? '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, [childId]);

  const handleBuyCard = async (cardType: BoardingCardType) => {
    setActing(cardType);
    try {
      const result = await buyBoardingCard(childId, cardType);
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

  const toggleSelect = (petId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(petId)) next.delete(petId);
      else next.add(petId);
      return next;
    });
  };

  const handleBoard = async () => {
    if (selectedIds.size === 0) {
      toast.info('请先选择要托管的宠物');
      return;
    }
    setActing('board');
    try {
      const result = await boardPets(childId, [...selectedIds]);
      if (result.success) {
        toast.success(result.message || `已托管 ${result.boarded_count} 只宠物`);
        onBoarded();
        loadData();
      } else {
        toast.error(result.message || '托管失败');
      }
    } catch (e: any) {
      toast.error(e?.message ?? '托管失败');
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
            <div className="grid grid-cols-3 gap-2">
              {CARDS.map(card => (
                <button
                  key={card.type}
                  onClick={() => handleBuyCard(card.type)}
                  disabled={acting === card.type}
                  className={cn(
                    'rounded-xl border-2 border-slate-100 bg-white p-2 text-center transition-all hover:border-indigo-300 active:scale-95 disabled:opacity-50'
                  )}
                >
                  <div className="text-2xl mb-1">{card.emoji}</div>
                  <p className="text-xs font-bold text-slate-700">{card.name}</p>
                  <p className="text-[10px] text-slate-400">{card.desc}</p>
                  <p className="text-sm font-bold text-amber-500 mt-1">{card.price}⭐</p>
                </button>
              ))}
            </div>
          </div>

          {/* 选择托管宠物 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-bold text-slate-700">选择今日托管宠物</h4>
              <span className="text-xs text-slate-400">已选 {selectedIds.size} 只</span>
            </div>

            {pets.length === 0 ? (
              <div className="text-center py-6 text-sm text-slate-400">暂无宠物可托管</div>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {pets.map(pet => {
                  const boarded = boardedSet.has(pet.id);
                  const sick = pet.is_sick;
                  const selected = selectedIds.has(pet.id);
                  const disabled = boarded || sick;
                  return (
                    <div
                      key={pet.id}
                      onClick={() => !disabled && toggleSelect(pet.id)}
                      className={cn(
                        'flex items-center gap-3 p-2.5 rounded-xl border-2 transition-all',
                        disabled
                          ? 'border-slate-100 bg-slate-50 opacity-60 cursor-not-allowed'
                          : selected
                            ? 'border-indigo-400 bg-indigo-50 cursor-pointer'
                            : 'border-slate-100 bg-white hover:border-indigo-200 cursor-pointer'
                      )}
                    >
                      <div className="w-9 h-9 flex items-center justify-center rounded-lg bg-amber-50 overflow-hidden">
                        {pet.image_url ? (
                          <img src={pet.image_url} alt={pet.name} className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-lg">{pet.emoji || '🐾'}</span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-700 truncate">{pet.name}</p>
                        <p className="text-[10px] text-slate-400">
                          {boarded ? '✅ 今日已托管' : sick ? '🤒 生病中，无法托管' : `Lv.${pet.level} · ${pet.base_coin_per_day || 0}💰/天`}
                        </p>
                      </div>
                      {!disabled && (
                        <div className={cn(
                          'w-5 h-5 rounded-full border-2 flex items-center justify-center',
                          selected ? 'bg-indigo-500 border-indigo-500' : 'border-slate-300'
                        )}>
                          {selected && <span className="text-white text-[10px]">✓</span>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 托管按钮 */}
          <button
            onClick={handleBoard}
            disabled={!status?.has_active_card || selectedIds.size === 0 || acting === 'board'}
            className={cn(
              'w-full py-2.5 rounded-xl text-sm font-bold transition-colors active:scale-95',
              !status?.has_active_card
                ? 'bg-slate-100 text-slate-400'
                : 'bg-indigo-500 text-white hover:bg-indigo-600 disabled:opacity-50'
            )}
          >
            {acting === 'board' ? '托管中...' : !status?.has_active_card ? '请先购买托管卡' : `一键托管 ${selectedIds.size} 只宠物`}
          </button>

          <p className="text-[10px] text-slate-400 text-center">
            托管自动完成喂食/清洁/心情，获得50经验并发放当日金币
          </p>
        </div>
      )}
    </Modal>
  );
}
