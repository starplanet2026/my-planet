import { useState, useEffect, useRef, useCallback } from 'react';
import { cn } from '../../../../lib/utils';
import { useToastStore } from '../../../../store/toastStore';
import { useFamilyStore } from '../../../../store/familyStore';
import { useModeStore } from '../../../../store/modeStore';
import { playPetClick, playCoin, playDogBark } from '../../../../lib/audio';
import type { Pet, DogHouse, PetInventory, PetSubcategory, PetRarity } from '../../../../api/types';
import { expNeeded } from '../../../../api/types';
import {
  interactWithPet, claimPetCoins, fetchPetInventory, checkPet,
} from '../../../../api/pets';
import { PetLevelUpQuiz } from './PetLevelUpQuiz';

// 稀有度文字
function rarityLabel(rarity: string | undefined | null): string {
  if (rarity === 'rare') return '稀有';
  if (rarity === 'epic') return '史诗';
  return '普通';
}

// 稀有度配色（与图鉴、商店保持统一）
const RARITY_STYLE: Record<string, string> = {
  common: 'bg-slate-100 text-slate-500',
  rare: 'bg-blue-100 text-blue-600',
  epic: 'bg-purple-100 text-purple-600',
};

// 性别图标配色：雄性蓝、雌性粉
const GENDER_STYLE: Record<string, string> = {
  male: 'bg-blue-100 text-blue-600',
  female: 'bg-pink-100 text-pink-600',
};

// 心情状态：统一 emoji 和文案的对应关系
// 与 moodEmoji / petMessage 共用同一套阈值，确保表情和会话内容一致
function moodState(pet: Pet): { emoji: string; text: string } {
  if (pet.is_sick) {
    return { emoji: '😢', text: '我不舒服...快带我去看医生！' };
  }
  // 新领养宠物：体力/清洁/玩耍均为0，显示欢迎文案
  const h = coalesce0(pet.hunger);
  const c = coalesce0(pet.clean);
  const hp = coalesce0(pet.happiness);
  if (h === 0 && c === 0 && hp === 0) {
    return { emoji: '🐶', text: '快来和我互动吧，小主人' };
  }
  const avg = (h + c + hp + coalesce0(pet.health)) / 4;
  if (avg > 80) return { emoji: '🤩', text: '主人我好开心呀！💕' };
  if (avg > 60) return { emoji: '😊', text: '今天也是元气满满的一天~' };
  if (avg > 30) return { emoji: '😐', text: '还行，但还可以更好~' };
  if (avg > 10) return { emoji: '😟', text: '需要照顾啦...' };
  return { emoji: '😫', text: '我快不行了...快来救我！' };
}

function coalesce0(v: number | null | undefined): number {
  return typeof v === 'number' ? v : 0;
}

// 对话框文案
function petMessage(pet: Pet): string | null {
  return moodState(pet).text;
}

// 互动按钮配置
const ACTIONS = [
  { key: 'feed', label: '喂食', statLabel: '体力值', icon: '🍖', stat: 'hunger' as const, barColor: 'bg-orange-400', btnColor: 'bg-orange-100 hover:bg-orange-200 text-orange-600' },
  { key: 'clean', label: '清洁', statLabel: '清洁度', icon: '🧼', stat: 'clean' as const, barColor: 'bg-sky-400', btnColor: 'bg-sky-100 hover:bg-sky-200 text-sky-600' },
  { key: 'play', label: '玩耍', statLabel: '心情值', icon: '🎾', stat: 'happiness' as const, barColor: 'bg-pink-400', btnColor: 'bg-pink-100 hover:bg-pink-200 text-pink-600' },
  { key: 'heal', label: '就医', statLabel: '健康度', icon: '💊', stat: 'health' as const, barColor: 'bg-emerald-400', btnColor: 'bg-emerald-100 hover:bg-emerald-200 text-emerald-600' },
] as const;

const ACTION_SUBCAT: Record<string, PetSubcategory> = {
  feed: 'food', clean: 'clean', play: 'toy', heal: 'medicine',
};

// 宠物默认出现位置：底部菜单栏上方一点点，水平居中
const DEFAULT_PET_POSITION = { x: 50, y: 68 };

export function PetGrassland({ pets, dogHouse, bgImage, onPetUpdate, positionResetPetId, onPositionResetDone }: {
  pets: Pet[];
  dogHouse: DogHouse | null;
  onPetClick?: (pet: Pet) => void;
  onDogHouseUpgraded?: () => void;
  bgImage?: string;
  onPetUpdate?: (updated: Pet) => void;
  positionResetPetId?: string | null;
  onPositionResetDone?: () => void;
}) {
  const toast = useToastStore();
  const refreshMembers = useFamilyStore(s => s.refreshMembers);
  const currentChildId = useModeStore(s => s.currentChildId);
  const childId = currentChildId ?? '';

  const [interactingPetId, setInteractingPetId] = useState<string | null>(null);
  const [petStates, setPetStates] = useState<Record<string, Pet>>({});
  const [inventory, setInventory] = useState<PetInventory[]>([]);
  const [acting, setActing] = useState<string | null>(null);
  const [levelUpPet, setLevelUpPet] = useState<Pet | null>(null);
  const [collapsedChats, setCollapsedChats] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('pet-collapsed-chats') || '[]')); } catch { return new Set(); }
  });
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>(() => {
    try { return JSON.parse(localStorage.getItem('pet-positions') || '{}'); } catch { return {}; }
  });
  const dragRef = useRef<{ petId: string; startX: number; startY: number; moved: boolean } | null>(null);

  // 初始化宠物状态：直接使用 props 数据
  useEffect(() => {
    console.log('[PetGrassland] pets prop updated:', pets.map(p => ({ id: p.id, name: p.name, hunger: p.hunger, clean: p.clean, happiness: p.happiness })));
    const map: Record<string, Pet> = {};
    pets.forEach(p => { map[p.id] = p; });
    setPetStates(map);
    const fixed: Record<string, { x: number; y: number }> = {};
    pets.forEach((p) => {
      const cur = positions[p.id];
      if (cur) {
        fixed[p.id] = {
          x: Math.max(5, Math.min(95, cur.x)),
          y: Math.max(10, Math.min(70, cur.y)),
        };
      } else {
        // 首次领养 / 无历史位置：底部菜单栏上方居中
        fixed[p.id] = { ...DEFAULT_PET_POSITION };
      }
    });
    setPositions(fixed);
    // 问题2: 购买用品后刷新背包
    loadInventory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pets]);

  // 加载背包
  const loadInventory = useCallback(async () => {
    try {
      setInventory(await fetchPetInventory(childId));
    } catch (e) {
      // 静默
    }
  }, [childId]);

  useEffect(() => { loadInventory(); }, [loadInventory]);

  // 保存位置
  useEffect(() => {
    localStorage.setItem('pet-positions', JSON.stringify(positions));
  }, [positions]);

  // "出来玩" 时重置指定宠物位置到底部居中默认位置
  useEffect(() => {
    if (!positionResetPetId) return;
    setPositions(prev => ({
      ...prev,
      [positionResetPetId]: { ...DEFAULT_PET_POSITION },
    }));
    onPositionResetDone?.();
  }, [positionResetPetId, onPositionResetDone]);

  // 保存折叠状态
  useEffect(() => {
    localStorage.setItem('pet-collapsed-chats', JSON.stringify([...collapsedChats]));
  }, [collapsedChats]);

  const toggleChat = (petId: string) => {
    setCollapsedChats(prev => {
      const next = new Set(prev);
      if (next.has(petId)) next.delete(petId);
      else next.add(petId);
      return next;
    });
  };

  const getItem = (action: string): PetInventory | undefined => {
    const sub = ACTION_SUBCAT[action];
    return inventory.find(i => i.subcategory === sub && i.quantity > 0);
  };

  const handleInteract = async (action: string, petId: string) => {
    const pet = petStates[petId];
    if (!pet) return;
    if (action === 'heal' && !pet.is_sick) {
      toast.info('宠物没有生病');
      return;
    }
    // 问题6: 属性满值时拦截，提示友好文案
    const actionCfg = ACTIONS.find(a => a.key === action);
    if (actionCfg) {
      const statVal = pet[actionCfg.stat] ?? 0;
      console.log('[handleInteract]', { action, petId, petName: pet.name, stat: actionCfg.stat, statVal });
      if (statVal >= 100) {
        const fullMsg: Record<string, string> = {
          feed: '我已经饱啦 🍖',
          clean: '我很干净啦 🧼',
          play: '我很开心啦 🎾',
          heal: '我很健康啦 💊',
        };
        toast.info(fullMsg[action] || '该属性已满');
        return;
      }
    }
    const item = getItem(action);
    if (!item) {
      toast.error('背包无此物品，去商店购买');
      return;
    }
    setActing(action);
    try {
      const oldStat = actionCfg ? (pet[actionCfg.stat] ?? 0) : 0;
      const oldExp = pet.exp ?? 0;
      const oldCoin = pet.coin_balance ?? 0;
      const oldLevel = pet.level ?? 1;
      const updated = await interactWithPet(childId, pet.id, action, item.item_id);
      const newCoin = updated.coin_balance ?? 0;
      const coinEarned = Math.max(0, newCoin - oldCoin);
      const expEarned = Math.max(0, (updated.exp ?? 0) - oldExp);
      const isLevelUp = (updated.level ?? 1) > oldLevel;

      // 升级/状态条满时播放小狗叫声（预留：素材确认后生效）
      if (isLevelUp || (updated.pending_levelup && !pet.pending_levelup)) {
        playDogBark();
      }

      if (updated.pending_levelup && !pet.pending_levelup) {
        toast.success('经验已满！点击宠物上方的「升级挑战」完成升级');
      } else if (actionCfg) {
        const newStat = updated[actionCfg.stat] ?? 0;
        const recovery = Math.max(0, Math.round(newStat - oldStat));
        if (recovery > 0) {
          if (newStat >= 100 && expEarned > 0) {
            toast.success(`${actionCfg.statLabel}恢复+${recovery}，经验+${expEarned}`);
          } else if (newStat >= 100 && expEarned === 0) {
            toast.success(`${actionCfg.statLabel}恢复+${recovery}（今日经验已满）`);
          } else {
            toast.success(`${actionCfg.statLabel}恢复+${recovery}`);
          }
        } else if (newStat === oldStat) {
          toast.info('该属性已满');
        } else {
          toast.success('互动成功');
        }
      } else {
        toast.success('互动成功');
      }
      // 金币奖励提示：四项全满时触发"今日收获"
      if (coinEarned > 0) {
        toast.success(`🎉 今日收获 金币+${coinEarned}`);
      }
      refreshMembers();
      setPetStates(prev => ({ ...prev, [pet.id]: updated }));
      // 问题3: 同步到父组件，避免父组件 re-render 时覆盖本地状态
      onPetUpdate?.(updated);
      loadInventory();
    } catch (e: any) {
      toast.error(e?.message ?? '操作失败');
    } finally {
      setActing(null);
    }
  };

  const handleLevelUpClick = (pet: Pet) => {
    setLevelUpPet(pet);
  };

  const handleLevelUpDone = (updated: Pet) => {
    refreshMembers();
    setPetStates(prev => ({ ...prev, [updated.id]: updated }));
    onPetUpdate?.(updated);
  };

  const handleClaim = async (petId: string) => {
    const pet = petStates[petId];
    if (!pet || pet.coin_balance < 1) return;
    setActing('claim');
    try {
      const result = await claimPetCoins(childId, pet.id);
      if (result.success) {
        playCoin(); // 金币音效
        toast.success(result.message);
        refreshMembers();
        const updated = await checkPet(pet.id);
        setPetStates(prev => ({ ...prev, [pet.id]: updated }));
      } else {
        toast.error(result.message);
      }
    } catch (e: any) {
      toast.error(e?.message ?? '领取失败');
    } finally {
      setActing(null);
    }
  };

  // 拖拽
  const onPointerDown = (e: React.PointerEvent, petId: string) => {
    dragRef.current = {
      petId,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const { petId, startX, startY } = dragRef.current;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
    dragRef.current.moved = true;

    const container = e.currentTarget.closest('[data-grassland]') as HTMLElement;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const newX = ((e.clientX - rect.left) / rect.width) * 100;
    const newY = ((e.clientY - rect.top) / rect.height) * 100;

    setPositions(prev => ({
      ...prev,
      [petId]: {
        x: Math.max(5, Math.min(95, newX)),
        y: Math.max(10, Math.min(70, newY)),
      },
    }));
  };

  const onPointerUp = () => {
    if (!dragRef.current) return;
    const { petId, moved } = dragRef.current;
    if (!moved) {
      // 点击：切换互动面板 + 互动音效
      playPetClick();
      setInteractingPetId(prev => prev === petId ? null : petId);
    }
    dragRef.current = null;
  };

  return (
    <div
      data-grassland
      className="fixed inset-0 overflow-hidden"
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      style={{
        background: bgImage && bgImage !== 'default'
          ? undefined
          : 'linear-gradient(to bottom, #FEFCE8 0%, #FEFCE8 60%, #D4A574 60%, #D4A574 62%, #F59E0B 62%, #F59E0B 100%)',
      }}
    >
      {/* 背景图片 */}
      {bgImage && bgImage !== 'default' && (
        <img src={bgImage} alt="" className="absolute inset-0 w-full h-full object-cover z-0" />
      )}

      {/* 宠物们 */}
      {Object.values(petStates).map(pet => {
        const pos = positions[pet.id] || { ...DEFAULT_PET_POSITION };
        const isInteracting = interactingPetId === pet.id;
        return (
          <div
            key={pet.id}
            className="absolute z-10 flex flex-col items-center"
            style={{ left: `${pos.x}%`, top: `${pos.y}%`, transform: 'translate(-50%, -50%)', touchAction: 'none' }}
          >
            {/* 升级挑战悬浮按钮：经验满 + 未满级时显示 */}
            {(pet.pending_levelup || pet.exp >= expNeeded(pet.level, pet.rarity as PetRarity)) && pet.level < pet.max_level && (
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); handleLevelUpClick(pet); }}
                className="mb-1 px-2 py-1 rounded-full bg-gradient-to-r from-amber-400 to-orange-500 text-white text-[10px] font-bold shadow-lg hover:scale-105 transition-transform animate-bounce-soft flex items-center gap-1"
              >
                <span className="text-xs">⚔️</span>
                升级挑战
              </button>
            )}
            {/* 互动面板：4 个独立版块横排，每个版块上方血条+下方按钮 */}
            {isInteracting && (
              <div className="mb-2 flex items-start gap-2">
                {ACTIONS.map(action => {
                  const item = getItem(action.key);
                  const disabled = !!acting || (action.key === 'heal' && !pet.is_sick);
                  const statVal = pet[action.stat];
                  const pct = Math.max(0, Math.min(100, statVal));
                  const barColor = pct > 60 ? action.barColor : pct > 30 ? 'bg-yellow-400' : 'bg-red-400';
                  return (
                    <div key={action.key} className="flex flex-col items-center gap-1 w-[52px]">
                      {/* 状态名 */}
                      <span className="text-[8px] font-medium text-slate-500">{action.statLabel}</span>
                      {/* 血条 */}
                      <div className="w-full h-1.5 bg-slate-200/80 rounded-full overflow-hidden">
                        <div className={cn('h-full rounded-full transition-all', barColor)} style={{ width: `${pct}%` }} />
                      </div>
                      {/* 数值 */}
                      <span className="text-[8px] font-bold text-slate-500">{Math.round(statVal)}</span>
                      {/* 按钮 */}
                      <button
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => { e.stopPropagation(); handleInteract(action.key, pet.id); }}
                        disabled={disabled}
                        className={cn(
                          'w-full flex flex-col items-center gap-0.5 py-1 rounded-lg text-[9px] font-medium transition-colors',
                          disabled ? 'bg-slate-100 text-slate-300' : action.btnColor,
                        )}
                      >
                        <span className="text-sm">{action.icon}</span>
                        {action.label}
                        <span className="text-[7px] opacity-60">
                          {item ? `x${item.quantity}` : '空'}
                        </span>
                      </button>
                    </div>
                  );
                })}
                {/* 领取金币版块 */}
                {pet.coin_balance >= 1 && (
                  <div className="flex flex-col items-center gap-1 w-[52px]">
                    <span className="text-[8px] font-medium text-amber-600">金币</span>
                    <div className="w-full h-1.5 bg-amber-200/50 rounded-full" />
                    <span className="text-[8px] font-bold text-amber-600">{Math.floor(pet.coin_balance)}</span>
                    <button
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => { e.stopPropagation(); handleClaim(pet.id); }}
                      disabled={acting === 'claim'}
                      className="w-full flex flex-col items-center gap-0.5 py-1 rounded-lg bg-amber-400 text-white text-[9px] font-bold disabled:opacity-50"
                    >
                      <span className="text-sm">💰</span>
                      领取
                    </button>
                  </div>
                )}
              </div>
            )}

            <div
              onPointerDown={(e) => onPointerDown(e, pet.id)}
              className="flex flex-col items-center cursor-pointer select-none relative"
            >
              {/* 信息板块（内外层页面完全一致） */}
              <div className="mb-1 flex flex-col items-center gap-0.5">
                {/* 上一行：等级数字（左）+ 经验条（缩短）+ 经验数值 */}
                <div className="flex items-center gap-1">
                  <span className="text-[9px] font-bold px-1 py-0.5 rounded-full bg-emerald-100 text-emerald-600 whitespace-nowrap">
                    Lv.{pet.level}
                  </span>
                  {pet.level < pet.max_level ? (
                    <>
                      <div className="w-10 h-1.5 bg-slate-200/80 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-blue-400 to-emerald-400 rounded-full transition-all"
                          style={{ width: `${Math.min(100, (pet.exp / expNeeded(pet.level, pet.rarity as PetRarity)) * 100)}%` }}
                        />
                      </div>
                      <span className="text-[8px] font-medium text-slate-500 whitespace-nowrap">
                        {pet.exp}/{expNeeded(pet.level, pet.rarity as PetRarity)}
                      </span>
                    </>
                  ) : (
                    <span className="text-[8px] font-bold text-amber-500">已满级</span>
                  )}
                </div>
                {/* 下一行（紧贴宠物头顶）：【稀有度小图标】【名字】【性别小图标】 */}
                <div className="flex items-center justify-center gap-1">
                  <span className={cn('px-1.5 py-0.5 rounded-full text-[9px] font-bold', RARITY_STYLE[pet.rarity ?? 'common'])}>
                    {rarityLabel(pet.rarity)}
                  </span>
                  <span className="text-xs font-bold text-slate-700 truncate max-w-[70px]">{pet.name}</span>
                  {pet.gender && (
                    <span className={cn(
                      'w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold',
                      GENDER_STYLE[pet.gender]
                    )}>
                      {pet.gender === 'male' ? '♂' : '♀'}
                    </span>
                  )}
                </div>
              </div>

              {/* 宠物形象 + 会话框（会话框常驻显示，位于宠物头部右侧） */}
              <div className="relative">
                {pet.image_url ? (
                  <img
                    src={pet.image_url}
                    alt=""
                    draggable={false}
                    className="w-[98px] h-[119px] sm:w-[126px] sm:h-[154px] md:w-[168px] md:h-[196px] object-contain drop-shadow-lg"
                  />
                ) : (
                  <span className="text-5xl sm:text-6xl md:text-7xl drop-shadow-lg">{pet.emoji || '🐾'}</span>
                )}
                {/* 会话框：宠物头部右侧，内外层常驻显示（全局右侧偏移25px） */}
                {petMessage(pet) && (
                  <div className="absolute top-0 left-full -ml-[25px]">
                    {collapsedChats.has(pet.id) ? (
                      <button
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => { e.stopPropagation(); toggleChat(pet.id); }}
                        className="text-lg drop-shadow-md hover:scale-110 transition-transform"
                      >
                        💬
                      </button>
                    ) : (
                      <div
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => { e.stopPropagation(); toggleChat(pet.id); }}
                        className="max-w-[90px] cursor-pointer relative"
                      >
                        <div className="bg-white/95 backdrop-blur-sm rounded-xl px-2 py-1 shadow-md text-[9px] text-slate-600 leading-tight border border-slate-100">
                          {petMessage(pet)}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* 金币提示 */}
              {pet.coin_balance >= 1 && (
                <div className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-amber-100/90 mt-0.5">
                  <span className="text-[10px]">💰</span>
                  <span className="text-[10px] font-bold text-amber-600">{Math.floor(pet.coin_balance)}</span>
                </div>
              )}
            </div>
          </div>
        );
      })}

      {/* 底部草地 */}
      <div className="absolute bottom-0 left-0 right-0 h-8 bg-green-500/40 z-0" />

      {/* 升级挑战弹窗 */}
      {levelUpPet && (
        <PetLevelUpQuiz
          pet={levelUpPet}
          memberId={childId}
          onClose={() => setLevelUpPet(null)}
          onLevelUp={handleLevelUpDone}
        />
      )}
    </div>
  );
}
