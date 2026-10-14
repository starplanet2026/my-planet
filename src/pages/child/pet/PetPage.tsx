import { useState, useEffect, useCallback, useMemo } from 'react';
import { useFamilyStore } from '../../../store/familyStore';
import { useModeStore } from '../../../store/modeStore';
import { usePetUiStore } from '../../../store/petUiStore';
import { Loading } from '../../../components/common/Loading';
import { Modal } from '../../../components/common/Modal';
import { useToastStore } from '../../../store/toastStore';
import { cn } from '../../../lib/utils';
import { ShoppingBag, Backpack, Gamepad2, Store, Calendar, BookOpen, ImageIcon, PawPrint, HelpCircle, MessageCircle } from 'lucide-react';
import { fetchPets, checkPet, getDogHouse, fetchBackgrounds, updatePetInfo, evolvePet, sendPetToStudy, getStudyPets, claimStudyStarlight, fetchPetMessages, clearPetMessages, markPetMessagesRead } from '../../../api/pets';
import type { Pet, DogHouse, PetBackground, PetRarity, StudyPet, PetMessage } from '../../../api/types';
import { expNeeded } from '../../../api/types';
import { usePetTraits } from '../../../hooks/usePetTraits';
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
  const { traitMap } = usePetTraits();

  const [pets, setPets] = useState<Pet[]>([]);
  const [dogHouse, setDogHouse] = useState<DogHouse | null>(null);
  const [loading, setLoading] = useState(true);
  // activeModal 和 showStudy 使用全局 store，切换 tab 后回到本页可恢复弹窗
  const activeModal = usePetUiStore(s => s.activeModal);
  const setActiveModal = usePetUiStore(s => s.setActiveModal);
  const showStudy = usePetUiStore(s => s.showStudy);
  const setShowStudy = usePetUiStore(s => s.setShowStudy);
  const [activePet, setActivePet] = useState<Pet | null>(null);
  const [maxLevelPet, setMaxLevelPet] = useState<Pet | null>(null);
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
  const [unreadMsgCount, setUnreadMsgCount] = useState(0);
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
  // 隐藏的宠物 ID 集合（"回家"的宠物）；按用户独立存储，切换用户不互相覆盖
  const hiddenIdsKey = `pet-hidden-ids-${currentChildId ?? ''}`;
  const [hiddenPetIds, setHiddenPetIds] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(hiddenIdsKey);
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch { return new Set(); }
  });

  // 切换用户时重新读取对应用户的 hidden 集合；不再强制所有宠物回家，
  // 保留用户上次的"出来玩/回家"选择（localStorage 已持久化）
  useEffect(() => {
    try {
      const saved = localStorage.getItem(hiddenIdsKey);
      setHiddenPetIds(saved ? new Set(JSON.parse(saved)) : new Set());
    } catch { setHiddenPetIds(new Set()); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentChildId]);

  // 切换宠物"出来玩/回家"
  const togglePetVisible = (petId: string) => {
    setHiddenPetIds(prev => {
      const next = new Set(prev);
      if (next.has(petId)) next.delete(petId);
      else next.add(petId);
      localStorage.setItem(hiddenIdsKey, JSON.stringify([...next]));
      return next;
    });
  };

  // 一键回家：所有非进修宠物隐藏
  const hideAllPets = () => {
    setHiddenPetIds(prev => {
      const next = new Set(prev);
      pets.filter(p => !p.is_studying).forEach(p => next.add(p.id));
      localStorage.setItem(hiddenIdsKey, JSON.stringify([...next]));
      return next;
    });
  };

  // 一键出来玩：清空所有隐藏（进修宠物本就不在草地，无需处理）
  const showAllPets = () => {
    setHiddenPetIds(() => {
      const next = new Set<string>();
      localStorage.setItem(hiddenIdsKey, JSON.stringify([]));
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

  // 领取进修星光（不传 petId = 一键领取全部；传 petId = 领取该宠物）
  const handleClaimStudy = async (petId?: string) => {
    if (!child) return;
    try {
      const result = await claimStudyStarlight(child.id, petId);
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

  // 加载宠物消息（同时统计未读数）
  const loadPetMessages = useCallback(async () => {
    if (!child) return;
    setPetMessagesLoading(true);
    try {
      const data = await fetchPetMessages(child.id, 50, 0);
      setPetMessages(data);
      setUnreadMsgCount(data.filter(m => !m.read).length);
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
      setUnreadMsgCount(0);
      toast.success('消息已清空');
    } catch (e: any) {
      toast.error(e?.message ?? '清空失败');
    }
  };

  // 打开消息面板时加载并标记已读
  useEffect(() => {
    if (showPetMessages) {
      loadPetMessages();
      if (child) {
        markPetMessagesRead(child.id).then(() => setUnreadMsgCount(0)).catch(() => {});
      }
    }
  }, [showPetMessages, loadPetMessages, child?.id]);

  // 页面挂载时拉取未读数（用于消息按钮红点提醒）
  useEffect(() => {
    if (!child) return;
    fetchPetMessages(child.id, 50, 0)
      .then(data => setUnreadMsgCount(data.filter(m => !m.read).length))
      .catch(() => {});
  }, [child?.id]);

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
      // 托管养护由 pg_cron 每日0点（北京时间）自动执行，前端不再触发
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
      // check_pet RPC 返回的是 pets 表自身的 image_url（旧快照），
      // 用 fetchPets 关联到的商店最新形象图覆盖，保证家长改图后已购宠物同步更新
      // 同时恢复 dialogue_* 字段（来自 pet_shop_items 关联，check_pet 不带这些字段）
      const shopMetaById = new Map(petsData.map(p => [
        p.id,
        {
          image_url: p.image_url,
          dialogue_new_pet: p.dialogue_new_pet,
          dialogue_low_stats: p.dialogue_low_stats,
          dialogue_medium_stats: p.dialogue_medium_stats,
          dialogue_high_stats: p.dialogue_high_stats,
          dialogue_study: p.dialogue_study,
        },
      ]));
      checked = checked.map(p => {
        const meta = shopMetaById.get(p.id);
        return meta ? { ...p, ...meta } : p;
      });
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
      const shopMetaById = new Map(petsData.map(p => [
        p.id,
        {
          image_url: p.image_url,
          dialogue_new_pet: p.dialogue_new_pet,
          dialogue_low_stats: p.dialogue_low_stats,
          dialogue_medium_stats: p.dialogue_medium_stats,
          dialogue_high_stats: p.dialogue_high_stats,
          dialogue_study: p.dialogue_study,
        },
      ]));
      checked = checked.map(p => {
        const meta = shopMetaById.get(p.id);
        return meta ? { ...p, ...meta } : p;
      });
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
  // 进修中的宠物从草地移除（只能在「我的宠物」列表底部与宠物店进修列表查看/互动）
  const grasslandPets = useMemo(
    () => pets.filter(p => !hiddenPetIds.has(p.id) && !p.is_studying).slice(0, 10),
    [pets, hiddenPetIds],
  );

  // 「我的宠物」列表排序：进修中的宠物统一排到列表最下方
  const sortedPets = useMemo(
    () => [...pets].sort((a, b) => Number(!!a.is_studying) - Number(!!b.is_studying)),
    [pets],
  );

  if (loading) return <Loading />;

  // 弹窗打开时隐藏所有外层 icon
  const modalOpen = activeModal !== null || showAdopt || showStudy || showDex || showCheckin || showHelp || showBgSwitcher || showPetList || showBoarding || showPetMessages || !!maxLevelPet;

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
        onMaxLevelPetClick={(pet) => setMaxLevelPet(pet)}
        bgImage={bgImage}
        onPetUpdate={(updated) => setPets(prev => prev.map(p => p.id === updated.id ? { ...updated, image_url: p.image_url } : p))}
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
            className="relative flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/70 backdrop-blur-sm border border-white/60 text-green-600 hover:bg-white/90 shadow-sm transition-colors active:scale-95"
          >
            <MessageCircle className="w-4 h-4" />
            <span className="text-xs font-medium">消息</span>
            {unreadMsgCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold shadow">
                {unreadMsgCount > 99 ? '99+' : unreadMsgCount}
              </span>
            )}
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
        <Modal open onClose={() => setActiveModal(null)} title="我的宠物店" size="xl">
          {/* 顶部：宠物店建设进度（收窄为头部提示条） */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-100">
            <span className="text-lg leading-none">🏪</span>
            <p className="text-xs text-slate-500 leading-tight">
              集齐 10 只满级宠物即可解锁宠物店建设功能 · 当前满级宠物：
              <span className="font-bold text-slate-700">{pets.filter(p => p.level >= p.max_level).length}</span> / 10
            </p>
          </div>

          {/* 进修宠物列表 */}
          <div className="mt-3">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-bold text-slate-700">📚 进修中的宠物</h4>
              <button
                onClick={() => handleClaimStudy()}
                disabled={!studyPets.some(p => p.pending_star > 0)}
                className="px-3 py-1 rounded-lg bg-purple-500 text-white text-xs font-bold hover:bg-purple-600 active:scale-95 disabled:bg-slate-200 disabled:text-slate-400"
              >
                一键领取
              </button>
            </div>

            {studyLoading ? (
              <div className="text-center py-6 text-sm text-slate-400">加载中...</div>
            ) : studyPets.length === 0 ? (
              <div className="text-center py-6">
                <p className="text-sm text-slate-400">暂无进修宠物</p>
                <p className="text-xs text-slate-300 mt-1">满级宠物可送去进修，被动产出星光值</p>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3 max-h-[60vh] overflow-y-auto p-0.5">
                {studyPets.map(sp => {
                  const pending = Math.floor(sp.pending_star);
                  return (
                    <div
                      key={sp.pet_id}
                      className="relative rounded-2xl overflow-hidden shadow-md"
                      style={{ aspectRatio: '3 / 4' }}
                    >
                      {/* 背景：教室工位图（3:4 竖版） */}
                      <img
                        src="/assets/study-card-bg.webp"
                        alt=""
                        className="absolute inset-0 w-full h-full object-cover"
                        draggable={false}
                      />

                      {/* 顶部宠物名：纯文字，背景已自带椭圆框 */}
                      <p className="absolute top-[3.9%] inset-x-0 text-center font-bold text-amber-600 text-xs leading-tight truncate px-2">
                        {sp.name || '进修宠物'}
                      </p>

                      {/* 中间宠物形象（放大1.3倍，透明 PNG 居中，不带白底） */}
                      <div className="absolute left-1/2 top-[16%] bottom-[42%] w-full -translate-x-1/2 flex items-center justify-center pointer-events-none">
                        {sp.image_url ? (
                          <img
                            src={sp.image_url}
                            alt={sp.name || ''}
                            className="max-h-full max-w-[78%] object-contain drop-shadow-md scale-[1.3]"
                            draggable={false}
                          />
                        ) : (
                          <span className="text-4xl drop-shadow scale-[1.3]">{sp.emoji || '🐾'}</span>
                        )}
                      </div>

                      {/* 底部信息区：无底块，仅文字 + 按钮 */}
                      <div className="absolute bottom-0 inset-x-0 h-[42%] px-2 pt-0.5 pb-3 flex flex-col justify-between text-center">
                        <div className="flex-1 flex flex-col justify-center pt-2">
                          {/* 性别 / 稀有度 / 特质：统一沿用全站已有标签配色；三行以1.3倍行距向「已进修X天」靠拢 */}
                          <div className="flex items-center justify-center gap-1 flex-wrap leading-[1.3]">
                            <span className={cn(
                              'text-[10px] px-1.5 py-0.5 rounded-full font-medium',
                              sp.gender === 'male' ? 'bg-blue-100 text-blue-600' : sp.gender === 'female' ? 'bg-pink-100 text-pink-600' : 'bg-slate-100 text-slate-400'
                            )}>
                              {sp.gender === 'male' ? '♂ 公' : sp.gender === 'female' ? '♀ 母' : '未知'}
                            </span>
                            <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-medium', RARITY_BADGE[sp.rarity].cls)}>
                              {RARITY_BADGE[sp.rarity].label}
                            </span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-teal-50 text-teal-600 font-medium">
                              {sp.trait_name || '无特质'}
                            </span>
                          </div>
                          <p className="text-[10px] text-slate-500 leading-[1.3]">已进修 {sp.study_days} 天</p>
                          <p className="text-[10px] text-slate-500 leading-[1.3]">
                            日产 <span className="text-amber-500 font-bold">{sp.daily_star}⭐</span>
                            <span className="mx-1 text-slate-300">|</span>
                            总赚取 <span className="text-emerald-600 font-bold">{Math.floor(sp.total_star)}⭐</span>
                          </p>
                        </div>
                        <button
                          onClick={() => handleClaimStudy(sp.pet_id)}
                          disabled={pending <= 0}
                          className={cn(
                            'w-full py-1 rounded-full text-white text-[11px] font-bold shadow active:scale-95',
                            pending > 0 ? 'bg-purple-500 hover:bg-purple-600' : 'bg-amber-400'
                          )}
                        >
                          领取我的工资&nbsp;{pending}⭐
                        </button>
                      </div>
                    </div>
                  );
                })}
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
                      : msg.event_type === 'level_reward' ? '🎁'
                      : msg.event_type === 'coin_harvest' ? '💰'
                      : msg.event_type === 'sick' ? '🤒'
                      : msg.event_type === 'study_approved' ? '✅'
                      : msg.event_type === 'study_rejected' ? '❌'
                      : '🐾';
                    return (
                      <div key={msg.id} className={`flex items-start gap-2 p-2 rounded-lg ${msg.read ? 'bg-slate-50' : 'bg-amber-50 border border-amber-200'}`}>
                        <span className="text-lg flex-shrink-0">{icon}</span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-slate-700">{msg.message}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <p className="text-[10px] text-slate-400">
                              {new Date(msg.created_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                            </p>
                            {!msg.read && (
                              <span className="text-[10px] text-amber-600 font-medium">未读</span>
                            )}
                          </div>
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
              <p className="text-xs text-slate-400 text-center">
                共 {pets.length} 只宠物，"出来玩"的展示在草地上，可拖动改变位置
              </p>
              <div className="flex justify-center gap-2 mb-2">
                <button
                  onClick={showAllPets}
                  className="px-3 py-1.5 rounded-lg bg-green-500 text-white text-xs font-medium hover:bg-green-600 active:scale-95 transition whitespace-nowrap"
                >
                  🏡 一键出来玩
                </button>
                <button
                  onClick={hideAllPets}
                  className="px-3 py-1.5 rounded-lg bg-amber-100 text-amber-600 text-xs font-medium hover:bg-amber-200 active:scale-95 transition whitespace-nowrap"
                >
                  🏠 一键回家
                </button>
              </div>
              {sortedPets.map(pet => {
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
                      pet.is_studying
                        ? 'border-green-200 bg-green-50'
                        : hidden
                          ? 'border-slate-100 bg-slate-50 opacity-70'
                          : 'border-slate-100 bg-white hover:border-green-200'
                    )}
                  >
                    <div className="w-12 h-16 flex items-center justify-center rounded-lg overflow-hidden bg-amber-50">
                      {pet.image_url ? (
                        <img src={pet.image_url} alt={pet.name || pet.breed || ''} className="w-full h-full object-cover" />
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
                            <span className="font-bold text-slate-700 text-sm truncate">{pet.name || pet.breed}</span>
                            <span className={cn('text-[10px] px-1 py-0.5 rounded-full font-medium', RARITY_BADGE[rarity].cls)}>
                              {RARITY_BADGE[rarity].label}
                            </span>
                            <span className="text-[10px] px-1 py-0.5 rounded-full bg-amber-100 text-amber-600 font-medium">Lv.{pet.level}/{pet.max_level}</span>
                          </div>
                          <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-0.5 flex-wrap">
                            <span>{pet.is_studying ? '📚 进修中' : pet.is_sick ? '🤒 生病中' : '状态良好'}</span>
                            {pet.is_studying ? (
                              <span className="text-indigo-500">⭐ {rarity === 'common' ? 5 : rarity === 'rare' ? 20 : 50}/天（进修）</span>
                            ) : (
                              <span className="text-amber-500">💰 {pet.base_coin_per_day || 0}/天</span>
                            )}
                            <span
                              className={cn(
                                (pet.trait_id && traitMap[pet.trait_id]?.name)
                                  ? 'px-1.5 py-0.5 rounded-full bg-teal-50 text-teal-600'
                                  : 'text-slate-400'
                              )}
                              title={(pet.trait_id && traitMap[pet.trait_id]?.detail_text) || ''}
                            >
                              {(pet.trait_id && traitMap[pet.trait_id]?.name) || '无特质'}
                            </span>
                          </div>
                          {/* 经验条：满级时隐藏（Lv.x/x 已表达满级） */}
                          {!isMaxLevel && (
                            <div className="flex items-center gap-1.5 mt-1">
                              <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-gradient-to-r from-blue-400 to-emerald-400 rounded-full transition-all"
                                  style={{ width: `${Math.min(100, (pet.exp / need) * 100)}%` }}
                                />
                              </div>
                              <span className="text-[10px] font-medium text-slate-500">
                                {pet.exp}/{need}
                              </span>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                    {renamingPetId !== pet.id && (
                      <div className="flex flex-col gap-1">
                        {!pet.is_studying && (
                          <>
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
                            {isMaxLevel && (
                              <button
                                onClick={() => handleSendStudy(pet.id)}
                                className="px-3 py-1.5 rounded-lg bg-indigo-500 text-white text-xs font-medium hover:bg-indigo-600 active:scale-95 whitespace-nowrap"
                              >
                                📚 送去进修
                              </button>
                            )}
                          </>
                        )}
                        <button
                          onClick={() => { setRenamingPetId(pet.id); setNewName(pet.name || ''); }}
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

      {/* 满级宠物点击弹框：去进化 / 去进修 */}
      {maxLevelPet && (() => {
        const rarity: PetRarity = maxLevelPet.rarity ?? inferRarity(maxLevelPet.max_level);
        const canEvolve = rarity === 'common' || rarity === 'rare';
        const evolveCost = rarity === 'common' ? 150 : 400;
        const evolveTarget: 'rare' | 'epic' = rarity === 'common' ? 'rare' : 'epic';
        const dailyStar = rarity === 'common' ? 5 : rarity === 'rare' ? 20 : 50;
        return (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40" onClick={() => setMaxLevelPet(null)}>
            <div className="bg-white rounded-2xl p-5 w-80 text-center" onClick={e => e.stopPropagation()}>
              <div className="text-4xl mb-1">🎉</div>
              <h3 className="font-bold text-slate-800 text-lg leading-snug">主人我满级了，现在我可以：</h3>
              <div className="mt-4 space-y-2">
                {canEvolve && (
                  <button
                    onClick={async () => { await handleEvolve(maxLevelPet.id, evolveTarget); setMaxLevelPet(null); }}
                    disabled={evolvingPetId === maxLevelPet.id}
                    className="w-full py-3 rounded-xl bg-purple-500 text-white font-bold hover:bg-purple-600 active:scale-95 disabled:opacity-50"
                  >
                    {evolvingPetId === maxLevelPet.id ? '进化中...' : `去进化（${evolveCost}⭐）`}
                  </button>
                )}
                <button
                  onClick={async () => { await handleSendStudy(maxLevelPet.id); setMaxLevelPet(null); }}
                  className="w-full py-3 rounded-xl bg-indigo-500 text-white font-bold hover:bg-indigo-600 active:scale-95"
                >
                  去进修（{dailyStar}⭐/天）
                </button>
              </div>
              <button onClick={() => setMaxLevelPet(null)} className="mt-3 text-sm text-slate-400 hover:text-slate-600">稍后再说</button>
            </div>
          </div>
        );
      })()}

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
