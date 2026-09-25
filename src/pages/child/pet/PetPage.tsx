import { useState, useEffect, useCallback, useMemo } from 'react';
import { useFamilyStore } from '../../../store/familyStore';
import { useModeStore } from '../../../store/modeStore';
import { usePetUiStore } from '../../../store/petUiStore';
import { Loading } from '../../../components/common/Loading';
import { Modal } from '../../../components/common/Modal';
import { useToastStore } from '../../../store/toastStore';
import { cn } from '../../../lib/utils';
import { ShoppingBag, Backpack, Gamepad2, Store, Calendar, BookOpen, ImageIcon, PawPrint, HelpCircle, MessageCircle } from 'lucide-react';
import { fetchPets, checkPet, getDogHouse, fetchBackgrounds, updatePetInfo, evolvePet, sendPetToStudy, getStudyPets, claimStudyStarlight, fetchPetMessages, clearPetMessages } from '../../../api/pets';
import type { Pet, DogHouse, PetBackground, PetRarity, StudyPet, PetMessage } from '../../../api/types';
import { expNeeded, TRAIT_DESC } from '../../../api/types';
import { PetGrassland } from './components/PetGrassland';
import { TopActionBar } from './components/TopActionBar';
import { PetShopModal } from './components/PetShopModal';
import { PetInventoryModal } from './components/PetInventoryModal';
import { PetCheckinModal } from './components/PetCheckinModal';
import { PetDexModal } from './components/PetDexModal';
import { WordMatchGame } from './components/WordMatchGame';
import { AdoptPetModal } from './components/AdoptPetModal';
import { StudyCompanionModal } from './components/StudyCompanionModal';
import { PetBoardingModal } from './components/PetBoardingModal';
import { AudioToggleButton } from './components/AudioToggleButton';

// 稀有度徽章配置
const RARITY_BADGE: Record<PetRarity, { label: string; cls: string }> = {
  common: { label: '普通', cls: 'bg-slate-100 text-slate-500' },
  rare: { label: '稀有', cls: 'bg-blue-100 text-blue-600' },
  epic: { label: '史诗', cls: 'bg-purple-100 text-purple-600' },
};

// 根据满级推断稀有度（兜底，优先使用 pet.rarity）
function inferRarity(maxLevel: number): PetRarity {
  if (maxLevel >= 25) return 'epic';
  if (maxLevel >= 20) return 'rare';
  return 'common';
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
  // activeModal 和 showStudy 使用全局 store，切换 tab 后回到本页可恢复弹窗
  const activeModal = usePetUiStore(s => s.activeModal);
  const setActiveModal = usePetUiStore(s => s.setActiveModal);
  const showStudy = usePetUiStore(s => s.showStudy);
  const setShowStudy = usePetUiStore(s => s.setShowStudy);
  const [activePet, setActivePet] = useState<Pet | null>(null);
  const [showCheckin, setShowCheckin] = useState(false);
  const [showDex, setShowDex] = useState(false);
  const [showAdopt, setShowAdopt] = useState(false);
  const [shopJumpDoghouse, setShopJumpDoghouse] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showPetList, setShowPetList] = useState(false);
  const [showBoarding, setShowBoarding] = useState(false);
  const [showPetMessages, setShowPetMessages] = useState(false);
  const [petMessages, setPetMessages] = useState<PetMessage[]>([]);
  const [petMessagesLoading, setPetMessagesLoading] = useState(false);
  const [evolvingPetId, setEvolvingPetId] = useState<string | null>(null);
  const [renamingPetId, setRenamingPetId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [showBgSwitcher, setShowBgSwitcher] = useState(false);
  const [bgImage, setBgImage] = useState(() => localStorage.getItem('pet-bg') || 'default');
  const [backgrounds, setBackgrounds] = useState<PetBackground[]>([]);
  const [bgLoading, setBgLoading] = useState(false);
  // 进修宠物列表（我的宠物店弹窗）
  const [studyPets, setStudyPets] = useState<StudyPet[]>([]);
  const [studyLoading, setStudyLoading] = useState(false);
  // 隐藏的宠物 ID 集合（"回家"的宠物）；从 localStorage 恢复
  const [hiddenPetIds, setHiddenPetIds] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('pet-hidden-ids');
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch { return new Set(); }
  });

  // 出来玩时重置位置的信号（传递给 PetGrassland）
  const [positionResetPetId, setPositionResetPetId] = useState<string | null>(null);

  // 切换宠物"出来玩/回家"
  const togglePetVisible = (petId: string) => {
    const wasHidden = hiddenPetIds.has(petId);
    setHiddenPetIds(prev => {
      const next = new Set(prev);
      if (next.has(petId)) next.delete(petId);
      else next.add(petId);
      localStorage.setItem('pet-hidden-ids', JSON.stringify([...next]));
      return next;
    });
    // 出来玩：重置宠物位置到底部菜单栏上方居中
    if (wasHidden) {
      setPositionResetPetId(petId);
    }
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

  // 送去进修
  const handleSendStudy = async (petId: string) => {
    if (!child) return;
    try {
      const result = await sendPetToStudy(child.id, petId);
      if (result.success) {
        toast.success(result.message || '已送去进修');
        await refreshData();
      } else {
        toast.error(result.message || '操作失败');
      }
    } catch (e: any) {
      toast.error(e?.message ?? '操作失败');
    }
  };

  // 加载进修宠物列表
  const loadStudyPets = useCallback(async () => {
    if (!child) return;
    setStudyLoading(true);
    try {
      const data = await getStudyPets(child.id);
      setStudyPets(data);
    } catch (e: any) {
      toast.error(e?.message ?? '加载失败');
    } finally {
      setStudyLoading(false);
    }
  }, [child?.id]);

  // 领取进修星光
  const handleClaimStudy = async () => {
    if (!child) return;
    try {
      const result = await claimStudyStarlight(child.id);
      if (result.success) {
        toast.success(result.message || '领取成功');
        await refreshMembers();
        await loadStudyPets();
      } else {
        toast.info(result.message || '暂无可领取星光');
      }
    } catch (e: any) {
      toast.error(e?.message ?? '领取失败');
    }
  };

  // 加载宠物消息
  const loadPetMessages = useCallback(async () => {
    if (!child) return;
    setPetMessagesLoading(true);
    try {
      const data = await fetchPetMessages(child.id, 50, 0);
      setPetMessages(data);
    } catch {
      setPetMessages([]);
    } finally {
      setPetMessagesLoading(false);
    }
  }, [child?.id]);

  const handleClearPetMessages = async () => {
    if (!child) return;
    try {
      await clearPetMessages(child.id);
      setPetMessages([]);
      toast.success('消息已清空');
    } catch (e: any) {
      toast.error(e?.message ?? '清空失败');
    }
  };

  // 打开消息面板时加载
  useEffect(() => {
    if (showPetMessages) loadPetMessages();
  }, [showPetMessages, loadPetMessages]);

  // 懒加载背景列表：仅在打开切换弹窗时加载，避免大 base64 阻塞首屏
  const loadBackgrounds = useCallback(async () => {
    if (!family) return;
    setBgLoading(true);
    try {
      const list = await fetchBackgrounds();
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
      // Try checkPet for daily decay, but fall back to raw data if it fails
      let checked = petsData;
      try {
        checked = await Promise.all(petsData.map(p => checkPet(p.id)));
        console.log('[PetPage] checkPet success:', checked.map(p => ({ name: p.name, hunger: p.hunger, clean: p.clean, happiness: p.happiness })));
      } catch (checkErr: any) {
        console.error('[PetPage] checkPet failed, using raw data:', checkErr);
      }
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
      let checked = petsData;
      try {
        checked = await Promise.all(petsData.map(p => checkPet(p.id)));
      } catch {
        // fall back to raw data
      }
      setPets(checked);
      setDogHouse(houseData);
    } catch (e: any) {
      // 静默失败
    }
  }, [child?.id]);

  useEffect(() => { loadData(); }, [loadData]);

  // 打开宠物店弹窗时加载进修宠物列表
  useEffect(() => {
    if (activeModal === 'store') {
      loadStudyPets();
    }
  }, [activeModal, loadStudyPets]);

  // 草地展示"出来玩"的宠物，最多 10 只（可拖动）
  // 使用 useMemo 防止不必要的引用变化导致 PetGrassland 重渲染覆盖状态
  // 注意：useMemo 必须在 early return 之前调用，否则违反 Hooks 规则导致白屏
  const grasslandPets = useMemo(() => pets.filter(p => !hiddenPetIds.has(p.id)).slice(0, 10), [pets, hiddenPetIds]);

  if (loading) return <Loading />;

  // 弹窗打开时隐藏所有外层 icon
  const modalOpen = activeModal !== null || showAdopt || showStudy || showDex || showCheckin || showHelp || showBgSwitcher || showPetList || showBoarding || showPetMessages;

  const base = import.meta.env.BASE_URL;
  // 菜单图标：使用圆角矩形裁剪 + object-cover 去除 jpg 白边
  // 移动端缩小（56px）让 4 个按钮更靠近；桌面端保持 72px
  const navIconCls = 'w-14 h-14 sm:w-[72px] sm:h-[72px] object-cover rounded-2xl drop-shadow-lg transition-transform active:scale-95';
  const navButtons: { id: PetModal; icon: React.ReactNode }[] = [
    { id: 'shop', icon: <img src={`${base}assets/menu-shop.jpg`} alt="商店" className={navIconCls} /> },
    { id: 'inventory', icon: <img src={`${base}assets/menu-inventory.jpg`} alt="背包" className={navIconCls} /> },
    { id: 'game', icon: <img src={`${base}assets/menu-game.jpg`} alt="游戏" className={navIconCls} /> },
    { id: 'store', icon: <img src={`${base}assets/menu-store.jpg`} alt="宠物店" className={navIconCls} /> },
  ];

  return (
    <div className="relative min-h-screen">
      {/* 背景全屏：草地常驻渲染（最多10只可拖拽） */}
      <PetGrassland
        pets={grasslandPets}
        dogHouse={dogHouse}
        onPetClick={(pet) => setActivePet(pet)}
        bgImage={bgImage}
        onPetUpdate={(updated) => setPets(prev => prev.map(p => p.id === updated.id ? updated : p))}
        positionResetPetId={positionResetPetId}
        onPositionResetDone={() => setPositionResetPetId(null)}
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
          {pets.length >= 3 && (
            <button
              onClick={() => setShowBoarding(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/70 backdrop-blur-sm border border-white/60 text-indigo-600 hover:bg-white/90 shadow-sm transition-colors active:scale-95"
            >
              <Store className="w-4 h-4" />
              <span className="text-xs font-medium">托管</span>
            </button>
          )}
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
            onClick={() => setShowPetMessages(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/70 backdrop-blur-sm border border-white/60 text-green-600 hover:bg-white/90 shadow-sm transition-colors active:scale-95"
          >
            <MessageCircle className="w-4 h-4" />
            <span className="text-xs font-medium">消息</span>
          </button>
          <AudioToggleButton />
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
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-30 flex gap-2 sm:gap-4">
          <button
            onClick={() => setShowAdopt(true)}
            className="flex flex-col items-center gap-0.5 sm:gap-1 px-3 py-1.5 sm:px-5 sm:py-2.5 rounded-xl sm:rounded-2xl bg-white/80 backdrop-blur-sm border-2 border-green-200 text-green-600 hover:bg-white hover:border-green-400 shadow-md transition-all active:scale-95"
          >
            <PawPrint className="w-6 h-6 sm:w-8 sm:h-8" />
            <span className="text-xs sm:text-sm font-bold">领养新宠</span>
          </button>
          <button
            onClick={() => setShowStudy(true)}
            className="flex flex-col items-center gap-0.5 sm:gap-1 px-3 py-1.5 sm:px-5 sm:py-2.5 rounded-xl sm:rounded-2xl bg-white/80 backdrop-blur-sm border-2 border-green-200 text-green-600 hover:bg-white hover:border-green-400 shadow-md transition-all active:scale-95"
          >
            <BookOpen className="w-6 h-6 sm:w-8 sm:h-8" />
            <span className="text-xs sm:text-sm font-bold">陪伴学习</span>
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
          dogHouseLevel={dogHouse?.level ?? 0}
          jumpDoghouse={shopJumpDoghouse}
          onJumpDone={() => setShopJumpDoghouse(false)}
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
          {/* 顶部：宠物店建设进度 */}
          <div className="text-center py-4 border-b border-slate-100">
            <div className="text-5xl mb-2">🏪</div>
            <p className="text-sm text-slate-500">集齐 10 只满级宠物即可解锁宠物店建设功能</p>
            <p className="text-xs text-slate-400 mt-1">
              当前满级宠物：{pets.filter(p => p.level >= p.max_level).length} / 10
            </p>
          </div>

          {/* 进修宠物列表 */}
          <div className="py-3">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-bold text-slate-700">📚 进修中的宠物</h4>
              {studyPets.some(p => p.pending_star > 0) && (
                <button
                  onClick={handleClaimStudy}
                  className="px-3 py-1 rounded-lg bg-amber-400 text-white text-xs font-bold hover:bg-amber-500 active:scale-95"
                >
                  领取星光
                </button>
              )}
            </div>

            {studyLoading ? (
              <div className="text-center py-6 text-sm text-slate-400">加载中...</div>
            ) : studyPets.length === 0 ? (
              <div className="text-center py-6">
                <p className="text-sm text-slate-400">暂无进修宠物</p>
                <p className="text-xs text-slate-300 mt-1">满级宠物可送去进修，被动产出星光值</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {studyPets.map(sp => (
                  <div key={sp.pet_id} className="flex items-center gap-3 p-2.5 rounded-xl border border-slate-100 bg-white">
                    <div className="w-10 h-10 flex items-center justify-center rounded-lg bg-amber-50 overflow-hidden">
                      {sp.image_url ? (
                        <img src={sp.image_url} alt={sp.name} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-xl">{sp.emoji || '🐾'}</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-sm text-slate-700 truncate">{sp.name}</span>
                        <span className={cn('text-[9px] px-1 py-0.5 rounded-full font-medium', RARITY_BADGE[sp.rarity].cls)}>
                          {RARITY_BADGE[sp.rarity].label}
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-400">进修 {sp.study_days} 天 · {sp.daily_star}⭐/天</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-bold text-amber-500">累计 {Math.floor(sp.total_star)}⭐</p>
                      {sp.pending_star > 0 && (
                        <p className="text-[10px] text-emerald-500">待领 {Math.floor(sp.pending_star)}⭐</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* 托管弹窗 */}
      {showBoarding && (
        <PetBoardingModal
          onClose={() => setShowBoarding(false)}
          onBoarded={() => { refreshData(); refreshMembers(); }}
        />
      )}

      {/* 宠物消息面板 */}
      {showPetMessages && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowPetMessages(false)}>
          <div className="bg-white rounded-2xl p-4 w-80 max-h-[70vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-slate-800 text-lg">🐾 宠物消息</h3>
              <div className="flex items-center gap-2">
                {petMessages.length > 0 && (
                  <button
                    onClick={handleClearPetMessages}
                    className="text-xs text-slate-400 hover:text-red-500"
                  >
                    清空消息
                  </button>
                )}
                <button onClick={() => setShowPetMessages(false)} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {petMessagesLoading ? (
                <div className="text-center py-8 text-sm text-slate-400">加载中...</div>
              ) : petMessages.length === 0 ? (
                <div className="text-center py-8">
                  <div className="text-4xl mb-2">📭</div>
                  <p className="text-sm text-slate-400">暂无消息</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {petMessages.map(msg => {
                    const icon = msg.event_type === 'level_up' ? '⬆️'
                      : msg.event_type === 'coin_harvest' ? '💰'
                      : msg.event_type === 'sick' ? '🤒'
                      : '🐾';
                    return (
                      <div key={msg.id} className="flex items-start gap-2 p-2 rounded-lg bg-slate-50">
                        <span className="text-lg flex-shrink-0">{icon}</span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-slate-700">{msg.message}</p>
                          <p className="text-[10px] text-slate-400 mt-0.5">
                            {new Date(msg.created_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
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
                const need = expNeeded(pet.level, rarity);
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
                          <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-0.5 flex-wrap">
                            <span>{pet.is_sick ? '🤒 生病中' : '状态良好'}</span>
                            <span className="text-amber-500">💰 {pet.base_coin_per_day || 0}/天</span>
                            {pet.trait && (
                              <span className="text-emerald-600 bg-emerald-50 px-1 rounded" title={TRAIT_DESC[pet.trait] || ''}>
                                🌟 {pet.trait}
                              </span>
                            )}
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
                        {isMaxLevel && !pet.is_studying && (
                          <button
                            onClick={() => handleSendStudy(pet.id)}
                            className="px-3 py-1.5 rounded-lg bg-indigo-500 text-white text-xs font-medium hover:bg-indigo-600 active:scale-95 whitespace-nowrap"
                          >
                            📚 送去进修
                          </button>
                        )}
                        {pet.is_studying && (
                          <span className="px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-500 text-xs font-medium whitespace-nowrap">
                            📚 进修中
                          </span>
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
          onGoShop={() => { setShowAdopt(false); setShopJumpDoghouse(true); setActiveModal('shop'); }}
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
                <p>在商店「用品-住所」购买住所用品可立即扩容，每只住所 +2 容量。宠物达到满级后可产出金币。</p>
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
