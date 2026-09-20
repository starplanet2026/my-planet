import { useState, useEffect, useCallback } from 'react';
import { useFamilyStore } from '../../../store/familyStore';
import { useModeStore } from '../../../store/modeStore';
import { Loading } from '../../../components/common/Loading';
import { Modal } from '../../../components/common/Modal';
import { useToastStore } from '../../../store/toastStore';
import { cn } from '../../../lib/utils';
import { ShoppingBag, Backpack, Gamepad2, Store, Calendar, BookOpen, ImageIcon, PawPrint, HelpCircle, MessageCircle } from 'lucide-react';
import { fetchPets, checkPet, getDogHouse, fetchBackgrounds, updatePetInfo, evolvePet } from '../../../api/pets';
import type { Pet, DogHouse, PetBackground, PetRarity } from '../../../api/types';
import { PetGrassland } from './components/PetGrassland';
import { TopActionBar } from './components/TopActionBar';
import { PetShopModal } from './components/PetShopModal';
import { PetInventoryModal } from './components/PetInventoryModal';
import { PetCheckinModal } from './components/PetCheckinModal';
import { PetDexModal } from './components/PetDexModal';
import { WordMatchGame } from './components/WordMatchGame';
import { AdoptPetModal } from './components/AdoptPetModal';
import { StudyCompanionModal } from './components/StudyCompanionModal';

// 稀有度徽章配置
const RARITY_BADGE: Record<PetRarity, { label: string; cls: string }> = {
  common: { label: '普通', cls: 'bg-slate-100 text-slate-500' },
  rare: { label: '稀有', cls: 'bg-blue-100 text-blue-600' },
  epic: { label: '史诗', cls: 'bg-purple-100 text-purple-600' },
};

// 根据满级推断稀有度（common=3, rare=5, epic=7）—— 兜底，优先使用 pet.rarity
function inferRarity(maxLevel: number): PetRarity {
  if (maxLevel >= 7) return 'epic';
  if (maxLevel >= 5) return 'rare';
  return 'common';
}

// 经验值需求：L1=100, L2=150, L3=200, L4=350, L5=500, L6=700, L7=900
function expNeeded(level: number): number {
  const table: Record<number, number> = { 1: 100, 2: 150, 3: 200, 4: 350, 5: 500, 6: 700, 7: 900 };
  return table[level] || 900;
}

type PetModal = 'shop' | 'inventory' | 'game' | 'store' | null;

export function PetPage() {
  const family = useFamilyStore(s => s.family);
  const members = useFamilyStore(s => s.members);
  const refreshMembers = useFamilyStore(s => s.refreshMembers);
  const currentChildId = useModeStore(s => s.currentChildId);
  const child = members.find(m => m.id === currentChildId && m.role === 'child') ?? members.find(m => m.role === 'child');
  const toast = useToastStore();

  const [pets, setPets] = useState<Pet[]>([]);
  const [dogHouse, setDogHouse] = useState<DogHouse | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeModal, setActiveModal] = useState<PetModal>(null);
  const [activePet, setActivePet] = useState<Pet | null>(null);
  const [showCheckin, setShowCheckin] = useState(false);
  const [showDex, setShowDex] = useState(false);
  const [showAdopt, setShowAdopt] = useState(false);
  const [showStudy, setShowStudy] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showPetList, setShowPetList] = useState(false);
  const [evolvingPetId, setEvolvingPetId] = useState<string | null>(null);
  const [renamingPetId, setRenamingPetId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [showBgSwitcher, setShowBgSwitcher] = useState(false);
  const [bgImage, setBgImage] = useState(() => localStorage.getItem('pet-bg') || 'default');
  const [backgrounds, setBackgrounds] = useState<PetBackground[]>([]);
  const [bgLoading, setBgLoading] = useState(false);
  // 隐藏的宠物 ID 集合（"回家"的宠物）；从 localStorage 恢复
  const [hiddenPetIds, setHiddenPetIds] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('pet-hidden-ids');
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch { return new Set(); }
  });

  // 切换宠物"出来玩/回家"
  const togglePetVisible = (petId: string) => {
    setHiddenPetIds(prev => {
      const next = new Set(prev);
      if (next.has(petId)) next.delete(petId);
      else next.add(petId);
      localStorage.setItem('pet-hidden-ids', JSON.stringify([...next]));
      return next;
    });
  };

  // 进化宠物
  const handleEvolve = async (petId: string, target: 'rare' | 'epic') => {
    if (evolvingPetId) return;
    setEvolvingPetId(petId);
    try {
      const result = await evolvePet(petId, target);
      if (result.success) {
        toast.success(result.message || '进化成功');
        await refreshData();
        await refreshMembers();
      } else {
        toast.error(result.message || '进化失败');
      }
    } catch (e: any) {
      toast.error(e?.message ?? '进化失败');
    } finally {
      setEvolvingPetId(null);
    }
  };

  // 懒加载背景列表：仅在打开切换弹窗时加载，避免大 base64 阻塞首屏
  const loadBackgrounds = useCallback(async () => {
    if (!family) return;
    setBgLoading(true);
    try {
      const list = await fetchBackgrounds(family.id);
      setBackgrounds(list);
    } catch (e: any) {
      toast.error(e?.message ?? '加载背景失败');
    } finally {
      setBgLoading(false);
    }
  }, [family?.id]);

  const openBgSwitcher = () => {
    setShowBgSwitcher(true);
    loadBackgrounds();
  };

  const loadData = useCallback(async () => {
    if (!child) return;
    setLoading(true);
    try {
      const [petsData, houseData] = await Promise.all([
        fetchPets(child.id),
        getDogHouse(child.id),
      ]);
      // 结算每只宠物状态
      const checked = await Promise.all(petsData.map(p => checkPet(p.id)));
      setPets(checked);
      setDogHouse(houseData);
    } catch (e: any) {
      toast.error(e?.message ?? '加载失败');
    } finally {
      setLoading(false);
    }
  }, [child?.id]);

  // 轻量刷新：不 toggle loading，避免 unmount 弹窗
  const refreshData = useCallback(async () => {
    if (!child) return;
    try {
      const [petsData, houseData] = await Promise.all([
        fetchPets(child.id),
        getDogHouse(child.id),
      ]);
      const checked = await Promise.all(petsData.map(p => checkPet(p.id)));
      setPets(checked);
      setDogHouse(houseData);
    } catch (e: any) {
      // 静默失败
    }
  }, [child?.id]);

  useEffect(() => { loadData(); }, [loadData]);

  if (loading) return <Loading />;

  // 弹窗打开时隐藏所有外层 icon
  const modalOpen = activeModal !== null || showAdopt || showStudy || showDex || showCheckin || showHelp || showBgSwitcher || showPetList;

  const navButtons: { id: PetModal; icon: React.ReactNode }[] = [
    { id: 'shop', icon: <img src="/assets/menu-shop.png" alt="商店" className="w-[88px] h-[88px] object-contain drop-shadow-lg transition-transform active:scale-95" /> },
    { id: 'inventory', icon: <img src="/assets/menu-inventory.png" alt="背包" className="w-[88px] h-[88px] object-contain drop-shadow-lg transition-transform active:scale-95" /> },
    { id: 'game', icon: <img src="/assets/menu-game.png" alt="游戏" className="w-[88px] h-[88px] object-contain drop-shadow-lg transition-transform active:scale-95" /> },
    { id: 'store', icon: <img src="/assets/menu-store.png" alt="宠物店" className="w-[88px] h-[88px] object-contain drop-shadow-lg transition-transform active:scale-95" /> },
  ];

  // 草地展示"出来玩"的宠物，最多 10 只（可拖动）
  const grasslandPets = pets.filter(p => !hiddenPetIds.has(p.id)).slice(0, 10);

  return (
    <div className="relative min-h-screen">
      {/* 背景全屏：草地常驻渲染（最多10只可拖拽） */}
      <PetGrassland
        pets={grasslandPets}
        dogHouse={dogHouse}
        onPetClick={(pet) => setActivePet(pet)}
        bgImage={bgImage}
      />

      {/* 左上角功能按钮组：图鉴 / 我的宠物 / 签到（弹窗时隐藏，往中间靠） */}
      {!modalOpen && (
        <div className="fixed top-20 left-4 sm:left-6 md:left-10 z-30 flex flex-col gap-2">
          <button
            onClick={() => setShowDex(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/70 backdrop-blur-sm border border-white/60 text-green-600 hover:bg-white/90 shadow-sm transition-colors active:scale-95"
          >
            <BookOpen className="w-4 h-4" />
            <span className="text-xs font-medium">图鉴</span>
          </button>
          <button
            onClick={() => setShowPetList(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/70 backdrop-blur-sm border border-white/60 text-green-600 hover:bg-white/90 shadow-sm transition-colors active:scale-95"
          >
            <PawPrint className="w-4 h-4" />
            <span className="text-xs font-medium">我的宠物</span>
          </button>
          <button
            onClick={() => setShowCheckin(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/70 backdrop-blur-sm border border-white/60 text-green-600 hover:bg-white/90 shadow-sm transition-colors active:scale-95"
          >
            <Calendar className="w-4 h-4" />
            <span className="text-xs font-medium">签到</span>
          </button>
        </div>
      )}

      {/* 右上角功能按钮组：切换背景 / 帮助 / 消息（弹窗时隐藏，往中间靠） */}
      {!modalOpen && (
        <div className="fixed top-20 right-4 sm:right-6 md:right-10 z-30 flex flex-col gap-2">
          <button
            onClick={openBgSwitcher}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/70 backdrop-blur-sm border border-white/60 text-green-600 hover:bg-white/90 shadow-sm transition-colors active:scale-95"
          >
            <ImageIcon className="w-4 h-4" />
            <span className="text-xs font-medium">背景</span>
          </button>
          <button
            onClick={() => setShowHelp(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/70 backdrop-blur-sm border border-white/60 text-green-600 hover:bg-white/90 shadow-sm transition-colors active:scale-95"
          >
            <HelpCircle className="w-4 h-4" />
            <span className="text-xs font-medium">帮助</span>
          </button>
          <button
            onClick={() => toast.info('暂无新消息')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/70 backdrop-blur-sm border border-white/60 text-green-600 hover:bg-white/90 shadow-sm transition-colors active:scale-95"
          >
            <MessageCircle className="w-4 h-4" />
            <span className="text-xs font-medium">消息</span>
          </button>
        </div>
      )}

      {/* 顶部中央两个功能按钮（弹窗时隐藏） */}
      {!modalOpen && (
        pets.length === 0 && (
          <div
            className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20 cursor-pointer active:scale-95 transition-transform"
            onClick={() => setShowAdopt(true)}
          >
            <span className="inline-block px-6 py-3 rounded-full bg-white/90 backdrop-blur-sm shadow-lg text-[22px] font-bold text-green-600 animate-pulse whitespace-nowrap">
              快来点击领养你的第一只宠物吧 ✨
            </span>
          </div>
        )
      )}
      {!modalOpen && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-30 flex gap-4">
          <button
            onClick={() => setShowAdopt(true)}
            className="flex flex-col items-center gap-1 px-5 py-2.5 rounded-2xl bg-white/80 backdrop-blur-sm border-2 border-green-200 text-green-600 hover:bg-white hover:border-green-400 shadow-md transition-all active:scale-95"
          >
            <PawPrint className="w-8 h-8" />
            <span className="text-sm font-bold">领养新宠</span>
          </button>
          <button
            onClick={() => setShowStudy(true)}
            className="flex flex-col items-center gap-1 px-5 py-2.5 rounded-2xl bg-white/80 backdrop-blur-sm border-2 border-green-200 text-green-600 hover:bg-white hover:border-green-400 shadow-md transition-all active:scale-95"
          >
            <BookOpen className="w-8 h-8" />
            <span className="text-sm font-bold">陪伴学习</span>
          </button>
        </div>
      )}

      {/* 底部 4 弹窗入口按钮（弹窗时隐藏，上移避开全局 Tab Bar） */}
      {!modalOpen && (
        <nav className="fixed bottom-32 left-0 right-0 z-30 px-4">
          <div className="max-w-md mx-auto">
            <div className="grid grid-cols-4 py-1">
              {navButtons.map(({ id, icon }) => (
                <button
                  key={id}
                  onClick={() => setActiveModal(id)}
                  className="flex flex-col items-center justify-center transition-all"
                >
                  {icon}
                </button>
              ))}
            </div>
          </div>
        </nav>
      )}

      {/* 商店/背包/游戏/宠物店 弹窗：自带 X 关闭 */}
      {activeModal === 'shop' && (
        <PetShopModal
          familyId={family?.id ?? ''}
          childId={child?.id ?? ''}
          onClose={() => setActiveModal(null)}
          onBought={() => { refreshData(); refreshMembers(); }}
        />
      )}
      {activeModal === 'inventory' && (
        <PetInventoryModal
          memberId={child?.id ?? ''}
          onClose={() => setActiveModal(null)}
          onUsed={() => refreshData()}
        />
      )}
      {activeModal === 'game' && (
        <Modal open onClose={() => setActiveModal(null)} title="萌宠闯关 · 赢星光值" size="xl">
          <WordMatchGame
            familyId={family?.id ?? ''}
            memberId={child?.id ?? ''}
            onReward={() => refreshMembers()}
          />
        </Modal>
      )}
      {activeModal === 'store' && (
        <Modal open onClose={() => setActiveModal(null)} title="我的宠物店" size="md">
          <div className="text-center py-10">
            <div className="text-6xl mb-4">🏪</div>
            <h3 className="text-xl font-bold text-slate-700 mb-2">我的宠物店</h3>
            <p className="text-sm text-slate-400 max-w-xs mx-auto">
              集齐 10 只满级宠物即可解锁宠物店建设功能
            </p>
            <p className="text-xs text-slate-300 mt-4">
              当前满级宠物：{pets.filter(p => p.level >= p.max_level).length} / 10
            </p>
          </div>
        </Modal>
      )}

      {/* 我的宠物弹窗：查看已领养宠物列表 + 出来玩/回家 */}
      {showPetList && (
        <Modal open onClose={() => setShowPetList(false)} title="我的宠物" size="md">
          {pets.length === 0 ? (
            <div className="text-center py-10">
              <div className="text-5xl mb-3">🐾</div>
              <p className="text-sm text-slate-500">还没有领养宠物</p>
              <p className="text-xs text-slate-400 mt-1">去商店领养一只吧</p>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-slate-400 text-center mb-2">
                共 {pets.length} 只宠物，"出来玩"的展示在草地上，可拖动改变位置
              </p>
              {pets.map(pet => {
                const hidden = hiddenPetIds.has(pet.id);
                const rarity: PetRarity = pet.rarity ?? inferRarity(pet.max_level);
                const isMaxLevel = pet.level >= pet.max_level;
                const canEvolve = isMaxLevel && (rarity === 'common' || rarity === 'rare');
                const evolveCost = rarity === 'common' ? 150 : 400;
                const evolveTarget: 'rare' | 'epic' = rarity === 'common' ? 'rare' : 'epic';
                const evolveLabel = rarity === 'common' ? '进化为稀有' : '进化为史诗';
                const need = expNeeded(pet.level);
                return (
                  <div
                    key={pet.id}
                    className={cn(
                      'flex items-center gap-3 p-2.5 rounded-xl border-2 transition-all',
                      hidden ? 'border-slate-100 bg-slate-50 opacity-70' : 'border-slate-100 bg-white hover:border-green-200'
                    )}
                  >
                    <div className="w-12 h-16 flex items-center justify-center rounded-lg overflow-hidden bg-amber-50">
                      {pet.image_url ? (
                        <img src={pet.image_url} alt={pet.name} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-2xl">{pet.emoji || '🐾'}</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      {renamingPetId === pet.id ? (
                        <div className="flex items-center gap-1">
                          <input
                            value={newName}
                            onChange={e => setNewName(e.target.value)}
                            className="flex-1 min-w-0 px-2 py-1 rounded-lg border border-green-300 text-sm"
                            placeholder="新名字"
                            maxLength={10}
                          />
                          <button
                            onClick={async () => {
                              if (!newName.trim()) return;
                              try {
                                await updatePetInfo(pet.id, child?.id ?? '', newName.trim(), null);
                                toast.success('改名成功');
                                setRenamingPetId(null);
                                refreshData();
                              } catch (e: any) {
                                toast.error(e?.message ?? '改名失败');
                              }
                            }}
                            className="px-2 py-1 rounded-lg bg-green-500 text-white text-xs font-medium"
                          >
                            确认
                          </button>
                          <button
                            onClick={() => setRenamingPetId(null)}
                            className="px-2 py-1 rounded-lg bg-slate-100 text-slate-500 text-xs"
                          >
                            取消
                          </button>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-bold text-slate-700 text-sm truncate">{pet.name}</span>
                            <span className={cn('text-[10px] px-1 py-0.5 rounded-full font-medium', RARITY_BADGE[rarity].cls)}>
                              {RARITY_BADGE[rarity].label}
                            </span>
                            <span className="text-[10px] px-1 py-0.5 rounded-full bg-amber-100 text-amber-600 font-medium">Lv.{pet.level}/{pet.max_level}</span>
                          </div>
                          <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-0.5">
                            <span>{pet.is_sick ? '🤒 生病中' : '状态良好'}</span>
                            <span className="text-amber-500">💰 {pet.base_coin_per_day || 0}/天</span>
                          </div>
                          {/* 经验条 */}
                          <div className="flex items-center gap-1.5 mt-1">
                            {isMaxLevel ? (
                              <span className="text-[10px] font-bold text-amber-500">已满级 Lv.{pet.max_level}</span>
                            ) : (
                              <>
                                <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-gradient-to-r from-blue-400 to-emerald-400 rounded-full transition-all"
                                    style={{ width: `${Math.min(100, (pet.exp / need) * 100)}%` }}
                                  />
                                </div>
                                <span className="text-[10px] font-medium text-slate-500">
                                  {pet.exp}/{need}
                                </span>
                              </>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                    {renamingPetId !== pet.id && (
                      <div className="flex flex-col gap-1">
                        <button
                          onClick={() => togglePetVisible(pet.id)}
                          className={cn(
                            'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                            hidden
                              ? 'bg-green-500 text-white hover:bg-green-600 active:scale-95'
                              : 'bg-amber-100 text-amber-600 hover:bg-amber-200 active:scale-95'
                          )}
                        >
                          {hidden ? '出来玩' : '回家'}
                        </button>
                        {canEvolve && (
                          <button
                            onClick={() => handleEvolve(pet.id, evolveTarget)}
                            disabled={evolvingPetId === pet.id}
                            className="px-3 py-1.5 rounded-lg bg-purple-500 text-white text-xs font-medium hover:bg-purple-600 active:scale-95 disabled:opacity-50 whitespace-nowrap"
                          >
                            {evolvingPetId === pet.id ? '进化中...' : `✨ ${evolveLabel} (${evolveCost}⭐)`}
                          </button>
                        )}
                        <button
                          onClick={() => { setRenamingPetId(pet.id); setNewName(pet.name); }}
                          className="px-3 py-1 rounded-lg bg-slate-100 text-slate-500 text-xs hover:bg-slate-200"
                        >
                          改名
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Modal>
      )}

      {/* 弹窗 */}
      {showCheckin && (
        <PetCheckinModal
          memberId={child?.id ?? ''}
          onClose={() => setShowCheckin(false)}
          onCheckin={() => refreshMembers()}
        />
      )}

      {showDex && (
        <PetDexModal
          familyId={family?.id ?? ''}
          memberId={child?.id ?? ''}
          onClose={() => setShowDex(false)}
        />
      )}

      {/* 领养新宠弹窗 */}
      {showAdopt && (
        <AdoptPetModal
          onClose={() => setShowAdopt(false)}
          onGoShop={() => { setShowAdopt(false); setActiveModal('shop'); }}
          onAdopted={() => refreshData()}
          onGoGame={() => { setShowAdopt(false); setActiveModal('game'); }}
        />
      )}

      {/* 陪伴学习弹窗 */}
      {showStudy && (
        <StudyCompanionModal
          pets={pets}
          onClose={() => setShowStudy(false)}
          onCompleted={() => refreshData()}
        />
      )}

      {/* 帮助弹窗 */}
      {showHelp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowHelp(false)}>
          <div className="bg-white rounded-2xl p-5 w-80 max-h-[80vh] overflow-y-auto space-y-3" onClick={e => e.stopPropagation()}>
            <h3 className="text-center font-bold text-slate-800 text-lg">🐾 萌宠星球玩法</h3>
            <div className="space-y-3 text-sm text-slate-600">
              <div>
                <p className="font-bold text-slate-700 mb-1">🏠 草地</p>
                <p>你的宠物住在草地上。点击宠物可以喂食、清洁、玩耍、治疗，消耗对应物品提升状态。</p>
              </div>
              <div>
                <p className="font-bold text-slate-700 mb-1">🛍️ 商店</p>
                <p>用星光值或金币购买宠物和用品（食品、清洁用品、玩具、药品）。</p>
              </div>
              <div>
                <p className="font-bold text-slate-700 mb-1">🎒 背包</p>
                <p>查看已购买的物品，按分类展示。</p>
              </div>
              <div>
                <p className="font-bold text-slate-700 mb-1">🎮 游戏</p>
                <p>玩单词消消乐，答对获得星光值奖励。</p>
              </div>
              <div>
                <p className="font-bold text-slate-700 mb-1">🏠 狗窝</p>
                <p>在商店「用品-狗屋」购买狗屋用品可立即扩容，每只狗屋 +2 容量。宠物达到满级后可产出金币。</p>
              </div>
              <div>
                <p className="font-bold text-slate-700 mb-1">🐾 我的宠物</p>
                <p>查看已领养的宠物，选择哪只展示在草地上。</p>
              </div>
              <div>
                <p className="font-bold text-slate-700 mb-1">📅 签到</p>
                <p>每天签到获得星光值，连续签到5天额外奖励。</p>
              </div>
              <div>
                <p className="font-bold text-slate-700 mb-1">📖 图鉴</p>
                <p>查看所有宠物的收集状态。</p>
              </div>
            </div>
            <div className="border-t border-slate-100 pt-3 text-center">
              <p className="text-xs text-slate-400">遇到问题？联系客服：</p>
              <p className="text-sm font-medium text-slate-600 mt-1">📧 support@myplanet.app</p>
            </div>
            <button
              onClick={() => setShowHelp(false)}
              className="w-full py-2 rounded-lg bg-slate-100 text-slate-500 text-sm font-medium"
            >
              关闭
            </button>
          </div>
        </div>
      )}

      {/* 背景切换弹窗 */}
      {showBgSwitcher && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowBgSwitcher(false)}>
          <div className="bg-white rounded-2xl p-5 w-80 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h3 className="text-center font-bold text-slate-800 text-lg mb-4">🖼️ 切换背景</h3>
            <p className="text-xs text-slate-400 mb-3 text-center">家长可在后台「背景管理」上传更多背景</p>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => {
                  setBgImage('default');
                  localStorage.setItem('pet-bg', 'default');
                  setShowBgSwitcher(false);
                  toast.success('已切换背景');
                }}
                className={cn(
                  'rounded-xl border-2 overflow-hidden transition-all',
                  bgImage === 'default' ? 'border-green-400 ring-2 ring-green-200' : 'border-slate-200 hover:border-green-200'
                )}
              >
                <div
                  className="w-full aspect-video"
                  style={{ background: 'linear-gradient(to bottom, #FEFCE8 0%, #FEFCE8 60%, #D4A574 60%, #D4A574 62%, #F59E0B 62%, #F59E0B 100%)' }}
                />
                <p className="text-xs font-medium text-slate-600 py-1.5">默认空间</p>
              </button>
              {bgLoading && (
                <div className="col-span-2 text-center text-xs text-slate-400 py-4">加载中...</div>
              )}
              {backgrounds.map(bg => (
                <button
                  key={bg.id}
                  onClick={() => {
                    setBgImage(bg.image_data);
                    localStorage.setItem('pet-bg', bg.image_data);
                    setShowBgSwitcher(false);
                    toast.success('已切换背景');
                  }}
                  className={cn(
                    'rounded-xl border-2 overflow-hidden transition-all',
                    bgImage === bg.image_data ? 'border-green-400 ring-2 ring-green-200' : 'border-slate-200 hover:border-green-200'
                  )}
                >
                  <img src={bg.image_data} alt={bg.name} className="w-full aspect-video object-cover" />
                  <p className="text-xs font-medium text-slate-600 py-1.5 truncate">{bg.name}</p>
                </button>
              ))}
              {!bgLoading && backgrounds.length === 0 && (
                <p className="col-span-2 text-center text-xs text-slate-400 py-2">
                  暂无自定义背景，请到后台上传
                </p>
              )}
            </div>
            <button
              onClick={() => setShowBgSwitcher(false)}
              className="w-full mt-4 py-2 rounded-lg bg-slate-100 text-slate-500 text-sm font-medium"
            >
              关闭
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
