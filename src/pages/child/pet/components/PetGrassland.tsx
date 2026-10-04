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
  fetchPetPositions, savePetPosition,
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
// 会话文案优先使用品种定制会话（来自 pet_shop_items 的 5 个场景），不再用通用模板
function moodState(pet: Pet): { emoji: string; text: string } {
  // 生病提示：功能性健康告警，不属于 5 个会话场景，保留引导用户买药
  if (pet.has_severe_illness) {
    return { emoji: '🤢', text: '主人，我生重病了，快带我去医院吧' };
  }
  if (pet.has_stomach_issue) {
    return { emoji: '😖', text: '主人，我肠胃不适了，快来帮我买肠胃药' };
  }
  if (pet.has_skin_issue) {
    return { emoji: '😣', text: '主人，我身上有虫了，快来帮我买驱虫药' };
  }
  if (pet.is_sick) {
    return { emoji: '😢', text: '我不舒服...快带我去看医生！' };
  }
  const h = coalesce0(pet.hunger);
  const c = coalesce0(pet.clean);
  const hp = coalesce0(pet.happiness);
  // 新领养宠物：体力/清洁/玩耍均为0 → 新宠到家场景
  if (h === 0 && c === 0 && hp === 0) {
    return { emoji: '🐶', text: pet.dialogue_new_pet ?? '' };
  }
  const avg = (h + c + hp + coalesce0(pet.health)) / 4;
  if (avg > 80) return { emoji: '🤩', text: pet.dialogue_high_stats ?? '' };
  if (avg > 30) return { emoji: '😊', text: pet.dialogue_medium_stats ?? '' };
  return { emoji: '😟', text: pet.dialogue_low_stats ?? '' };
}

function coalesce0(v: number | null | undefined): number {
  return typeof v === 'number' ? v : 0;
}

// RPC 返回的宠物对象不带 pet_shop_items 关联字段（dialogue_*、最新 image_url），
// 更新本地状态时需要从已有状态中保留这些字段，否则会话气泡会消失
function mergeShopMeta(updated: Pet, existing?: Pet): Pet {
  return {
    ...updated,
    image_url: existing?.image_url ?? updated.image_url,
    dialogue_new_pet: existing?.dialogue_new_pet ?? updated.dialogue_new_pet,
    dialogue_low_stats: existing?.dialogue_low_stats ?? updated.dialogue_low_stats,
    dialogue_medium_stats: existing?.dialogue_medium_stats ?? updated.dialogue_medium_stats,
    dialogue_high_stats: existing?.dialogue_high_stats ?? updated.dialogue_high_stats,
    dialogue_study: existing?.dialogue_study ?? updated.dialogue_study,
  };
}

// 对话框文案
function petMessage(pet: Pet): string | null {
  return moodState(pet).text;
}

// 互动按钮配置
const ACTIONS = [
  { key: 'feed', label: '喂食', statLabel: '体力值', icon: '🍖', stat: 'hunger' as const, max: 100, barColor: 'bg-orange-400', btnColor: 'bg-orange-100 hover:bg-orange-200 text-orange-600' },
  { key: 'clean', label: '清洁', statLabel: '清洁度', icon: '🧼', stat: 'clean' as const, max: 100, barColor: 'bg-sky-400', btnColor: 'bg-sky-100 hover:bg-sky-200 text-sky-600' },
  { key: 'play', label: '玩耍', statLabel: '心情值', icon: '🎾', stat: 'happiness' as const, max: 300, barColor: 'bg-pink-400', btnColor: 'bg-pink-100 hover:bg-pink-200 text-pink-600' },
  { key: 'heal', label: '就医', statLabel: '健康度', icon: '💊', stat: 'health' as const, max: 100, barColor: 'bg-emerald-400', btnColor: 'bg-emerald-100 hover:bg-emerald-200 text-emerald-600' },
] as const;

const ACTION_SUBCAT: Record<string, PetSubcategory> = {
  feed: 'food', clean: 'clean', play: 'toy',
};

// 根据宠物病症动态返回 heal 所需药品子分类
function getHealSubcategory(pet: Pet): PetSubcategory | null {
  if (pet.has_stomach_issue) return 'stomach_medicine';
  if (pet.has_skin_issue) return 'deworming_medicine';
  return null;
}

// 宠物默认出现位置：底部菜单栏上方居中（仅新宠首次出现时使用）
const DEFAULT_PET_POSITION = { x: 50, y: 55 };

export function PetGrassland({ pets, dogHouse, bgImage, onPetUpdate }: {
  pets: Pet[];
  dogHouse: DogHouse | null;
  onPetClick?: (pet: Pet) => void;
  onDogHouseUpgraded?: () => void;
  bgImage?: string;
  onPetUpdate?: (updated: Pet) => void;
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
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  // positionsRef：实时镜像最新坐标，避免 onPointerUp 读到闭包旧值导致保存旧坐标
  const positionsRef = useRef<Record<string, { x: number; y: number }>>({});
  const dragRef = useRef<{ petId: string; startX: number; startY: number; moved: boolean } | null>(null);
  // 标记是否已从数据库加载过坐标，避免加载前用默认位置覆盖已保存坐标
  const [positionsLoaded, setPositionsLoaded] = useState(false);
  // 宠物图层顺序：数组末尾 = 最上层。双击宠物将其置顶。
  // 按用户独立存储，切换用户不互相覆盖
  const layerOrderKey = `pet-layer-order-${childId}`;
  const [layerOrder, setLayerOrder] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(layerOrderKey) || '[]'); } catch { return []; }
  });

  // 切换用户时重新读取对应用户的图层顺序
  useEffect(() => {
    try { setLayerOrder(JSON.parse(localStorage.getItem(layerOrderKey) || '[]')); } catch { setLayerOrder([]); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [childId]);

  // 持久化图层顺序
  useEffect(() => {
    localStorage.setItem(layerOrderKey, JSON.stringify(layerOrder));
  }, [layerOrder, layerOrderKey]);

  // 双击宠物：将其置顶（移到数组末尾 = 最高 z-index）
  const bringToFront = (petId: string) => {
    setLayerOrder(prev => {
      const filtered = prev.filter(id => id !== petId);
      filtered.push(petId);
      return filtered;
    });
    playPetClick();
  };

  // 计算某只宠物的 z-index：数组末尾 = 最上层
  const petZIndex = (petId: string) => {
    const idx = layerOrder.indexOf(petId);
    if (idx === -1) return 10; // 未排序的宠物默认 z-10
    return 10 + idx;
  };

  // 同步宠物状态（仅更新 petStates，不触碰坐标）
  useEffect(() => {
    const map: Record<string, Pet> = {};
    pets.forEach(p => { map[p.id] = p; });
    setPetStates(map);
  }, [pets]);

  // 从数据库加载坐标：仅在 childId 变化时执行一次，避免每次 pets 变化都重新拉取导致竞态
  useEffect(() => {
    setPositionsLoaded(false);
    if (!childId) { setPositionsLoaded(true); return; }
    let cancelled = false;
    fetchPetPositions(childId).then(saved => {
      if (cancelled) return;
      setPositions(prev => {
        const next = { ...prev };
        Object.entries(saved).forEach(([petId, pos]) => {
          next[petId] = {
            x: Math.max(5, Math.min(95, pos.x)),
            y: Math.max(10, Math.min(70, pos.y)),
          };
        });
        positionsRef.current = next;
        return next;
      });
    }).catch((e) => {
      console.error('[fetchPetPositions] 失败:', e);
    }).finally(() => {
      if (!cancelled) setPositionsLoaded(true);
    });
    return () => { cancelled = true; };
  }, [childId]);

  // 为没有保存坐标的宠物分配错开的默认位置（网格排布，避免全部重叠在中间）
  // 仅在数据库坐标加载完成后执行
  useEffect(() => {
    if (!positionsLoaded) return;
    setPositions(prev => {
      let changed = false;
      const next = { ...prev };
      pets.forEach((p, idx) => {
        if (!next[p.id]) {
          const col = idx % 5;
          const row = Math.floor(idx / 5);
          next[p.id] = {
            x: Math.max(5, Math.min(95, 20 + col * 15)),
            y: Math.max(10, Math.min(70, 45 + row * 10)),
          };
          changed = true;
        }
      });
      if (changed) positionsRef.current = next;
      return changed ? next : prev;
    });
  }, [pets, positionsLoaded]);

  // 加载背包
  const loadInventory = useCallback(async () => {
    try {
      setInventory(await fetchPetInventory(childId));
    } catch (e) {
      // 静默
    }
  }, [childId]);

  useEffect(() => { loadInventory(); }, [loadInventory]);

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

  const getItem = (action: string, pet?: Pet): PetInventory | undefined => {
    let sub: PetSubcategory | undefined = ACTION_SUBCAT[action];
    if (action === 'heal' && pet) {
      sub = getHealSubcategory(pet) ?? undefined;
    }
    if (!sub) return undefined;
    return inventory.find(i => i.subcategory === sub && i.quantity > 0);
  };

  const handleInteract = async (action: string, petId: string) => {
    const pet = petStates[petId];
    if (!pet) return;
    if (action === 'heal' && !pet.is_sick) {
      toast.info('宠物没有生病');
      return;
    }
    // Bug1 修复：生病时禁止非 heal 互动
    if (pet.is_sick && action !== 'heal') {
      toast.info('宠物生病了，请先治愈');
      return;
    }
    // 重病时 heal 按钮提示需就医
    if (action === 'heal' && pet.has_severe_illness) {
      toast.info('宠物生重病了，吃药没用，请使用就医功能送医院');
      return;
    }
    // 问题6: 属性满值时拦截，提示友好文案
    const actionCfg = ACTIONS.find(a => a.key === action);
    if (actionCfg) {
      const statVal = pet[actionCfg.stat] ?? 0;
      console.log('[handleInteract]', { action, petId, petName: pet.name || pet.breed, stat: actionCfg.stat, statVal });
      if (statVal >= actionCfg.max) {
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
    const item = getItem(action, pet);
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
      setPetStates(prev => ({ ...prev, [pet.id]: mergeShopMeta(updated, prev[pet.id]) }));
      // 问题3: 同步到父组件，避免父组件 re-render 时覆盖本地状态
      onPetUpdate?.(mergeShopMeta(updated, pet));
      loadInventory();
    } catch (e: any) {
      toast.error(e?.message ?? '操作失败');
    } finally {
      setActing(null);
    }
  };

  const handleLevelUpClick = (pet: Pet) => {
    if (pet.is_sick) {
      toast.info('宠物生病了，请先治愈');
      return;
    }
    setLevelUpPet(pet);
  };

  const handleLevelUpDone = (updated: Pet) => {
    refreshMembers();
    setPetStates(prev => ({ ...prev, [updated.id]: mergeShopMeta(updated, prev[updated.id]) }));
    onPetUpdate?.(mergeShopMeta(updated, petStates[updated.id]));
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
        setPetStates(prev => ({ ...prev, [pet.id]: mergeShopMeta(updated, prev[pet.id]) }));
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

    setPositions(prev => {
      const next = {
        ...prev,
        [petId]: {
          x: Math.max(5, Math.min(95, newX)),
          y: Math.max(10, Math.min(70, newY)),
        },
      };
      positionsRef.current = next;
      return next;
    });
  };

  const onPointerUp = () => {
    if (!dragRef.current) return;
    const { petId, moved } = dragRef.current;
    if (moved) {
      // 拖拽结束：从 ref 读最新坐标并保存到数据库
      const pos = positionsRef.current[petId];
      if (pos && childId) {
        savePetPosition(childId, petId, pos.x, pos.y).catch((e) => {
          console.error('[savePetPosition] 保存失败:', e);
          toast.error(`宠物位置保存失败：${e?.message || '未知错误'}`);
        });
      }
    } else {
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
            className="absolute flex flex-col items-center"
            style={{ left: `${pos.x}%`, top: `${pos.y}%`, transform: 'translate(-50%, -50%)', touchAction: 'none', zIndex: petZIndex(pet.id) }}
            onDoubleClick={(e) => { e.stopPropagation(); bringToFront(pet.id); }}
          >
            {/* 升级挑战悬浮按钮：经验满 + 未满级 + 未生病时显示 */}
            {(pet.pending_levelup || pet.exp >= expNeeded(pet.level, pet.rarity as PetRarity)) && pet.level < pet.max_level && !pet.is_sick && (
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
                  const item = getItem(action.key, pet);
                  // Bug1 修复：生病时禁用非 heal 按钮；重病时 heal 也禁用（需就医）
                  const disabled = !!acting
                    || (pet.is_sick && action.key !== 'heal')
                    || (action.key === 'heal' && !pet.is_sick)
                    || (action.key === 'heal' && pet.has_severe_illness);
                  const statVal = pet[action.stat];
                  const pct = Math.max(0, Math.min(100, (statVal / action.max) * 100));
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
                  <span className="text-xs font-bold text-slate-700 truncate max-w-[70px]">{pet.name || pet.breed}</span>
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
                  <div className="absolute top-[25px] left-full -ml-[25px]">
                    {collapsedChats.has(pet.id) ? (
                      <button
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => { e.stopPropagation(); toggleChat(pet.id); }}
                        className="text-lg drop-shadow-md hover:scale-110 transition-transform pet-chat-icon-pulse"
                      >
                        💬
                      </button>
                    ) : (
                      <div
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => { e.stopPropagation(); toggleChat(pet.id); }}
                        className="max-w-[200px] cursor-pointer relative"
                      >
                        <div className="bg-white/95 backdrop-blur-sm rounded-xl px-2 py-1 shadow-md text-[10px] text-slate-600 leading-tight border border-slate-100 whitespace-nowrap pet-bubble-breathe">
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
