import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useFamilyStore } from '../../store/familyStore';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Input, Textarea } from '../../components/common/Input';
import { Modal } from '../../components/common/Modal';
import { EmptyState } from '../../components/common/EmptyState';
import { Loading } from '../../components/common/Loading';
import { Avatar } from '../../components/common/Avatar';
import { useToastStore } from '../../store/toastStore';
import { usePetTraits } from '../../hooks/usePetTraits';
import { ROUTES } from '../../lib/constants';
import { cn } from '../../lib/utils';
import {
  Plus, Trash2, ArrowLeft, Dog, ShoppingBag, Star, Upload,
  Image as ImageIcon, Pencil, Package, CheckSquare, Square, Send, Power,
  GripVertical, Dices,
} from 'lucide-react';
import {
  fetchPetShopItems, createPetShopItem, deletePetShopItem, updatePetShopItem,
  batchUpdatePetShopStatus, batchDeletePetShopItems,
  fetchAllPets, deletePet,
  fetchBackgrounds, createBackground, deleteBackground,
  migrateBase64ToStorage,
  fetchGachaConfig, updateGachaConfig,
  getSevereIllnessCost, updateSevereIllnessCost,
} from '../../api/pets';
import type {
  PetShopItem, PetShopItemType, PetSubcategory, PetRarity, Pet,
  PetBackground,
} from '../../api/types';
import { uploadImageToStorage, type ImageCategory } from '../../lib/storage';

// 一级分类配置：宠物 / 用品
const TYPE_CONFIG: Record<PetShopItemType, { label: string; icon: React.ReactNode; color: string }> = {
  pet: { label: '宠物', icon: <Dog className="w-5 h-5" />, color: 'from-amber-400 to-orange-500' },
  supply: { label: '用品', icon: <ShoppingBag className="w-5 h-5" />, color: 'from-purple-400 to-indigo-500' },
};

// 宠物子分类（狗 / 猫）
const PET_SUBS = [
  { id: 'dog' as const, label: '狗', emoji: '🐶' },
  { id: 'cat' as const, label: '猫', emoji: '🐱' },
];

// 用品子分类（食品 / 清洁 / 玩具 / 肠胃药 / 驱虫药 / 寄养 / 住所）
const SUPPLY_SUBS = [
  { id: 'food' as const, label: '食品', emojis: ['🍖', '🥩', '🍗', '🐟', '🥛', '🍪', '🥫'] },
  { id: 'clean' as const, label: '清洁', emojis: ['🧼', '🚿', '🛁', '🧴'] },
  { id: 'toy' as const, label: '玩具', emojis: ['🎾', '🧸', '🎈', '🎮', '🪀', '🎁', '🎯'] },
  { id: 'stomach_medicine' as const, label: '肠胃药', emojis: ['💊', '🧪', '🩺'] },
  { id: 'deworming_medicine' as const, label: '驱虫药', emojis: ['💉', '🧴', '🪲'] },
  { id: 'foster' as const, label: '寄养', emojis: ['🏠', '🏨', '🛏️'] },
  { id: 'doghouse' as const, label: '住所', emojis: ['🏡', '🏠', '🛖'] },
];

// 子分类标签文案
const SUB_LABEL: Record<string, string> = {
  dog: '狗', cat: '猫', food: '食品', clean: '清洁', toy: '玩具',
  stomach_medicine: '肠胃药', deworming_medicine: '驱虫药', medicine: '药品',
  foster: '寄养', doghouse: '住所',
};

// 稀有度配置
const RARITY_CONFIG: Record<PetRarity, { label: string; color: string }> = {
  common: { label: '普通', color: 'bg-slate-100 text-slate-500' },
  rare: { label: '稀有', color: 'bg-blue-100 text-blue-600' },
  epic: { label: '史诗', color: 'bg-purple-100 text-purple-600' },
};

// 宠物各子分类的 emoji 备选
const PET_EMOJIS: Record<'dog' | 'cat', string[]> = {
  dog: ['🐶', '🐕', '🦮', '🐩', '🦴'],
  cat: ['🐱', '🐈', '😺', '😻', '🐾'],
};

// 商品分类筛选：全部 / 宠物 / 食物 / 清洁 / 玩具 / 肠胃药 / 驱虫药 / 寄养 / 住所
type CategoryFilter = 'all' | 'pet' | 'food' | 'clean' | 'toy' | 'stomach_medicine' | 'deworming_medicine' | 'foster' | 'doghouse';
const CATEGORY_OPTIONS: { id: CategoryFilter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'pet', label: '宠物' },
  { id: 'food', label: '食物' },
  { id: 'clean', label: '清洁' },
  { id: 'toy', label: '玩具' },
  { id: 'stomach_medicine', label: '肠胃药' },
  { id: 'deworming_medicine', label: '驱虫药' },
  { id: 'foster', label: '寄养' },
  { id: 'doghouse', label: '住所' },
];

// 顶部 tab：商品管理 / 用户数据 / 背景管理 / 抽卡管理
type PageTab = 'shop' | 'user' | 'bg' | 'gacha';
const PAGE_TABS: { id: PageTab; label: string; icon: React.ReactNode }[] = [
  { id: 'shop', label: '商品管理', icon: <Package className="w-4 h-4" /> },
  { id: 'user', label: '用户数据', icon: <Dog className="w-4 h-4" /> },
  { id: 'bg', label: '背景管理', icon: <ImageIcon className="w-4 h-4" /> },
  { id: 'gacha', label: '抽卡管理', icon: <Dices className="w-4 h-4" /> },
];

// 根据 type + subcategory 获取 emoji 备选列表
function getEmojiOptions(type: PetShopItemType, subcategory: PetSubcategory | null): string[] {
  if (type === 'pet' && subcategory) {
    return PET_EMOJIS[subcategory as 'dog' | 'cat'] ?? ['🐾'];
  }
  if (type === 'supply') {
    const sub = SUPPLY_SUBS.find(s => s.id === subcategory);
    return sub ? sub.emojis : [];
  }
  return [];
}

// 根据类型获取默认子分类
function defaultSubcategory(type: PetShopItemType): PetSubcategory {
  return type === 'pet' ? 'dog' : 'food';
}

// 重病就医消耗星光值配置组件
function SevereIllnessCostConfig({ familyId }: { familyId: string }) {
  const toast = useToastStore();
  const [cost, setCost] = useState(20);
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState('20');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!familyId) return;
    getSevereIllnessCost(familyId)
      .then(v => { setCost(v); setInputValue(String(v)); })
      .catch(() => {});
  }, [familyId]);

  const handleSave = async () => {
    const v = parseInt(inputValue, 10);
    if (isNaN(v) || v < 1) {
      toast.error('请输入有效数字（≥1）');
      return;
    }
    setSaving(true);
    try {
      await updateSevereIllnessCost(familyId, v);
      setCost(v);
      setEditing(false);
      toast.success('重病就医消耗已更新');
    } catch (e: any) {
      toast.error(e?.message ?? '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-3 p-3 bg-red-50 rounded-xl border border-red-200 mb-4">
      <span className="text-sm font-medium text-red-700">🏥 重病就医消耗</span>
      {editing ? (
        <>
          <Input
            type="number"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            className="w-24"
            disabled={saving}
          />
          <span className="text-xs text-slate-500">星光值</span>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? '保存中...' : '保存'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setInputValue(String(cost)); }} disabled={saving}>
            取消
          </Button>
        </>
      ) : (
        <>
          <span className="text-sm font-bold text-red-600">{cost}</span>
          <span className="text-xs text-slate-500">星光值/次</span>
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>修改</Button>
        </>
      )}
    </div>
  );
}

export function PetManagePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const family = useFamilyStore(s => s.family);
  const toast = useToastStore();

  // 支持 ?tab=shop|user|bg|gacha 深链接，从首页按钮直达对应内层
  const initialTab: PageTab = (searchParams.get('tab') as PageTab) || 'shop';
  const [activeTab, setActiveTab] = useState<PageTab>(initialTab);
  const [items, setItems] = useState<PetShopItem[]>([]);
  const [userPets, setUserPets] = useState<Pet[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editingItem, setEditingItem] = useState<PetShopItem | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [deleteConfirm, setDeleteConfirm] = useState<{ petId: string; petName: string; memberName: string } | null>(null);

  const loadItems = async () => {
    if (!family) return;
    setLoading(true);
    try {
      setItems(await fetchPetShopItems(undefined, undefined, true));
    } catch (e: any) {
      toast.error(e?.message ?? '加载商品失败');
    } finally {
      setLoading(false);
    }
  };

  const loadUserData = async () => {
    if (!family) return;
    setLoading(true);
    try {
      setUserPets(await fetchAllPets(family.id));
    } catch (e: any) {
      toast.error(e?.message ?? '加载用户数据失败');
    } finally {
      setLoading(false);
    }
  };

  const handleDeletePet = (petId: string, petName: string, memberName: string) => {
    setDeleteConfirm({ petId, petName, memberName });
  };

  const confirmDeletePet = async () => {
    if (!deleteConfirm) return;
    const { petId, petName } = deleteConfirm;
    try {
      await deletePet(petId);
      toast.success(`已删除宠物「${petName}」`);
      // 仅刷新当前用户宠物列表，保留当前选中的孩子
      loadUserData();
    } catch (e: any) {
      toast.error(e?.message ?? '删除失败');
    } finally {
      setDeleteConfirm(null);
    }
  };

  useEffect(() => {
    if (family?.id) {
      loadItems();
    }
  }, [family?.id]);

  useEffect(() => {
    if (family?.id && activeTab === 'user') {
      loadUserData();
    }
  }, [family?.id, activeTab]);

  const handleDeleteItem = async (id: string) => {
    try {
      await deletePetShopItem(id);
      toast.success('已删除');
      loadItems();
    } catch (e: any) {
      toast.error(e?.message ?? '删除失败');
    }
  };

  const handleToggleStatus = async (item: PetShopItem) => {
    try {
      await updatePetShopItem(item.id, { status: item.status === 'active' ? 'inactive' : 'active' });
      toast.success(item.status === 'active' ? '已下架' : '已上架');
      loadItems();
    } catch (e: any) {
      toast.error(e?.message ?? '操作失败');
    }
  };

  // 批量选择
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleSelectAll = () => {
    if (items.length > 0 && items.every(i => selectedIds.has(i.id))) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(items.map(i => i.id)));
    }
  };
  const handleBatchPublish = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    try {
      await batchUpdatePetShopStatus(ids, 'active');
      toast.success(`已上架 ${ids.length} 个商品`);
      setSelectedIds(new Set());
      loadItems();
    } catch (e: any) {
      toast.error(e?.message ?? '批量上架失败');
    }
  };
  const handleBatchOffline = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    try {
      await batchUpdatePetShopStatus(ids, 'inactive');
      toast.success(`已下架 ${ids.length} 个商品`);
      setSelectedIds(new Set());
      loadItems();
    } catch (e: any) {
      toast.error(e?.message ?? '批量下架失败');
    }
  };
  const handleBatchDelete = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    try {
      await batchDeletePetShopItems(ids);
      toast.success(`已删除 ${ids.length} 个商品`);
      setSelectedIds(new Set());
      loadItems();
    } catch (e: any) {
      toast.error(e?.message ?? '批量删除失败');
    }
  };

  if (loading) return <Loading />;

  // 按 type 分组商品，并根据分类筛选过滤
  const sortFn = (a: PetShopItem, b: PetShopItem) =>
    (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1);
  const showPetGroup = categoryFilter === 'all' || categoryFilter === 'pet';
  const showSupplyGroup = categoryFilter === 'all' || categoryFilter !== 'pet';
  const petItems = showPetGroup
    ? items.filter(i => i.type === 'pet').sort(sortFn)
    : [];
  const supplyItems = showSupplyGroup
    ? items
        .filter(i => i.type === 'supply')
        .filter(i => categoryFilter === 'all' || i.subcategory === categoryFilter)
        .sort(sortFn)
    : [];

  return (
    <div className="max-w-4xl mx-auto">
      {/* 顶部标题栏 */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate(ROUTES.PARENT_DASHBOARD)} className="p-2 hover:bg-slate-100 rounded-lg">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-2xl font-bold text-slate-800">萌宠星球管理</h1>
      </div>

      {/* 顶部 tab 切换：商品管理 / 单词管理 */}
      <div className="flex gap-2 mb-4">
        {PAGE_TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={cn(
              'flex-1 inline-flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-colors',
              activeTab === t.id
                ? 'bg-star-400 text-white shadow-sm'
                : 'bg-star-50 text-slate-600 hover:bg-star-100'
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* 商品管理 tab */}
      {activeTab === 'shop' && (
        <>
          {/* 重病就医消耗配置 */}
          <SevereIllnessCostConfig familyId={family?.id ?? ''} />

          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <p className="text-sm text-slate-500">上架宠物和用品，孩子用星光值购买</p>
              {items.length > 0 && (
                <button onClick={toggleSelectAll} className="text-xs text-slate-500 hover:text-star-600 flex items-center gap-1">
                  {items.every(i => selectedIds.has(i.id))
                    ? <CheckSquare className="w-4 h-4 text-star-500" />
                    : <Square className="w-4 h-4" />}
                  全选
                </button>
              )}
            </div>
            <Button onClick={() => setShowCreate(true)}>
              <Plus className="w-4 h-4" /> 新建商品
            </Button>
          </div>

          {/* 批量操作工具栏 */}
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-2 p-3 bg-star-50 rounded-xl border border-star-200 mb-4">
              <span className="text-sm font-medium text-star-700">已选 {selectedIds.size} 项</span>
              <button onClick={() => setSelectedIds(new Set())} className="text-xs text-slate-500 hover:text-slate-700 ml-1">取消</button>
              <div className="ml-auto flex gap-2">
                <Button variant="ghost" size="sm" onClick={handleBatchPublish}>
                  <Send className="w-4 h-4" /> 批量上架
                </Button>
                <Button variant="ghost" size="sm" onClick={handleBatchOffline}>
                  <Power className="w-4 h-4" /> 批量下架
                </Button>
                <Button variant="ghost" size="sm" danger onClick={handleBatchDelete}>
                  <Trash2 className="w-4 h-4" /> 批量删除
                </Button>
              </div>
            </div>
          )}

          {/* 分类筛选 */}
          {items.length > 0 && (
            <div className="flex gap-2 overflow-x-auto pb-2 mb-2">
              {CATEGORY_OPTIONS.map(opt => {
                const count = opt.id === 'all'
                  ? items.length
                  : opt.id === 'pet'
                  ? items.filter(i => i.type === 'pet').length
                  : items.filter(i => i.type === 'supply' && i.subcategory === opt.id).length;
                return (
                  <button
                    key={opt.id}
                    onClick={() => setCategoryFilter(opt.id)}
                    className={cn(
                      'px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors',
                      categoryFilter === opt.id
                        ? 'bg-star-400 text-white shadow-sm'
                        : 'bg-star-50 text-slate-600 hover:bg-star-100'
                    )}
                  >
                    {opt.label}
                    {count > 0 && (
                      <span className={cn(
                        'ml-1',
                        categoryFilter === opt.id ? 'text-white/80' : 'text-slate-400'
                      )}>
                        ({count})
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {items.length === 0 ? (
            <EmptyState icon="🐾" title="暂无商品" description="点击右上角新建商品" />
          ) : petItems.length === 0 && supplyItems.length === 0 ? (
            <EmptyState icon="🔍" title="该分类下暂无商品" description="切换其他分类或新建商品" />
          ) : (
            <div className="space-y-6">
              {/* 宠物分组 */}
              {petItems.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Dog className="w-4 h-4 text-amber-500" />
                    <h2 className="text-sm font-semibold text-slate-700">宠物（{petItems.length}）</h2>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {petItems.map(item => (
                      <ItemCard
                        key={item.id}
                        item={item}
                        onEdit={() => setEditingItem(item)}
                        onToggle={() => handleToggleStatus(item)}
                        onDelete={() => handleDeleteItem(item.id)}
                        selected={selectedIds.has(item.id)}
                        onToggleSelect={() => toggleSelect(item.id)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* 用品分组 */}
              {supplyItems.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <ShoppingBag className="w-4 h-4 text-purple-500" />
                    <h2 className="text-sm font-semibold text-slate-700">用品（{supplyItems.length}）</h2>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {supplyItems.map(item => (
                      <ItemCard
                        key={item.id}
                        item={item}
                        onEdit={() => setEditingItem(item)}
                        onToggle={() => handleToggleStatus(item)}
                        onDelete={() => handleDeleteItem(item.id)}
                        selected={selectedIds.has(item.id)}
                        onToggleSelect={() => toggleSelect(item.id)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* 用户数据 tab */}
      {activeTab === 'user' && (
        <UserDataTab
          pets={userPets}
          loading={loading}
          onDeletePet={handleDeletePet}
        />
      )}

      {/* 背景管理 tab */}
      {activeTab === 'bg' && <BackgroundTab />}

      {/* 抽卡管理 tab */}
      {activeTab === 'gacha' && <GachaConfigTab />}

      {showCreate && (
        <CreateItemModal onClose={() => setShowCreate(false)} onCreated={loadItems} />
      )}
      {editingItem && (
        <EditItemModal item={editingItem} onClose={() => setEditingItem(null)} onUpdated={loadItems} />
      )}
      {deleteConfirm && (
        <Modal open onClose={() => setDeleteConfirm(null)} title="确认删除" size="sm">
          <p className="text-sm text-slate-600 leading-relaxed">
            {deleteConfirm.petName
              ? `确认删除【${deleteConfirm.memberName}】的宠物【${deleteConfirm.petName}】吗？`
              : `确认删除${deleteConfirm.memberName}的宠物吗？`}
          </p>
          <div className="flex gap-2 mt-5">
            <Button variant="ghost" onClick={() => setDeleteConfirm(null)} className="flex-1">取消</Button>
            <Button danger onClick={confirmDeletePet} className="flex-1">确认删除</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ====== 商品卡片 ======
function ItemCard({
  item, onEdit, onToggle, onDelete, selected, onToggleSelect,
}: {
  item: PetShopItem;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const cfg = TYPE_CONFIG[item.type];
  const toast = useToastStore();
  const [starPrice, setStarPrice] = useState(item.price_star);
  const [recovery, setRecovery] = useState(item.recovery_value ?? 0);
  const [validDays, setValidDays] = useState(item.valid_days ?? 1);
  const [saving, setSaving] = useState(false);
  const isFoster = item.type === 'supply' && item.subcategory === 'foster';

  // 用品外层直接修改价格（寄养还可改有效天数）
  const handleQuickSave = async () => {
    setSaving(true);
    try {
      const patch: any = {
        price_star: starPrice,
        price_coin: 0,
      };
      if (isFoster) {
        patch.valid_days = validDays;
      } else {
        patch.recovery_value = recovery;
      }
      await updatePetShopItem(item.id, patch);
      toast.success('已保存');
    } catch (e: any) {
      toast.error(e?.message ?? '保存失败');
      setStarPrice(item.price_star);
      setRecovery(item.recovery_value ?? 0);
      setValidDays(item.valid_days ?? 1);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className={cn('p-4', selected && 'border-star-300 bg-star-50')}>
      <div className="flex items-start gap-3">
        {onToggleSelect && (
          <button onClick={(e) => { e.stopPropagation(); onToggleSelect(); }} className="mt-1 flex-shrink-0">
            {selected
              ? <CheckSquare className="w-5 h-5 text-star-500" />
              : <Square className="w-5 h-5 text-slate-300" />}
          </button>
        )}
        <div className={cn(
          'w-[60px] h-[80px] rounded-2xl overflow-hidden bg-gradient-to-br flex items-center justify-center text-white text-2xl flex-shrink-0',
          cfg.color
        )}>
          {item.image_url ? (
            <img src={item.image_url} alt={item.name || '宠物'} className="w-full h-full object-cover" />
          ) : (
            item.emoji || cfg.icon
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-bold text-slate-800">
              {item.breed || item.name || (item.type === 'pet' ? '宠物' : '未命名')}
            </h3>
            {/* subcategory 标签 */}
            {item.subcategory && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
                {SUB_LABEL[item.subcategory] ?? item.subcategory}
              </span>
            )}
            {item.type === 'pet' && (
              <span className={cn('text-xs px-1.5 py-0.5 rounded', RARITY_CONFIG[item.rarity].color)}>
                {RARITY_CONFIG[item.rarity].label}
              </span>
            )}
          </div>
          {item.description && (
            <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">{item.description}</p>
          )}
          {/* 宠物显示价格和产金 */}
          {item.type === 'pet' && (
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              {item.price_star > 0 ? (
                <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-600 inline-flex items-center gap-0.5">
                  <Star className="w-3 h-3" />{item.price_star}
                </span>
              ) : (
                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-600">免费</span>
              )}
              <span className="text-xs text-slate-400">产金{item.base_coin_per_day}/天</span>
            </div>
          )}
          {/* 用品外层直接编辑星光值（寄养还可改有效天数） */}
          {item.type === 'supply' && item.subcategory !== 'doghouse' && (
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <label className="flex items-center gap-1 text-xs text-slate-500">
                <Star className="w-3 h-3 text-purple-500" />
                <input
                  type="number"
                  min={0}
                  value={starPrice}
                  onChange={e => setStarPrice(Math.max(0, parseInt(e.target.value) || 0))}
                  disabled={saving}
                  className="w-12 text-center text-sm font-bold rounded border border-slate-200 px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-purple-300"
                />
              </label>
              {isFoster ? (
                <label className="flex items-center gap-1 text-xs text-slate-500">
                  <span className="text-slate-400">天数</span>
                  <input
                    type="number"
                    min={1}
                    value={validDays}
                    onChange={e => setValidDays(Math.max(1, parseInt(e.target.value) || 1))}
                    disabled={saving}
                    className="w-12 text-center text-sm font-bold rounded border border-slate-200 px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-green-300"
                  />
                </label>
              ) : (
                <label className="flex items-center gap-1 text-xs text-slate-500">
                  <span className="text-slate-400">恢复</span>
                  <input
                    type="number"
                    min={0}
                    step={10}
                    value={recovery}
                    onChange={e => setRecovery(Math.max(0, parseInt(e.target.value) || 0))}
                    disabled={saving}
                    className="w-12 text-center text-sm font-bold rounded border border-slate-200 px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-green-300"
                  />
                </label>
              )}
              <button
                onClick={handleQuickSave}
                disabled={saving || (starPrice === item.price_star && (isFoster ? validDays === (item.valid_days ?? 1) : recovery === item.recovery_value))}
                className="px-2 py-0.5 rounded text-xs font-bold bg-purple-500 text-white hover:bg-purple-600 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {saving ? '保存中' : '保存'}
              </button>
              {item.status === 'inactive' && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-400">已下架</span>
              )}
            </div>
          )}
          {/* 住所只显示容量 */}
          {item.type === 'supply' && item.subcategory === 'doghouse' && (
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <span className="text-xs text-slate-400">
                容纳{item.recovery_value === 1 ? 1 : item.recovery_value === 5 ? 5 : 10}只小狗
              </span>
              {item.price_star > 0 && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-600 inline-flex items-center gap-0.5">
                  <Star className="w-3 h-3" />{item.price_star}
                </span>
              )}
              {item.status === 'inactive' && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-400">已下架</span>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="flex gap-2 mt-3">
        <Button variant="ghost" size="sm" onClick={onEdit}>
          <Pencil className="w-4 h-4" /> 编辑
        </Button>
        <Button variant="ghost" size="sm" onClick={onToggle}>
          {item.status === 'active' ? '下架' : '上架'}
        </Button>
        <Button variant="ghost" size="sm" danger onClick={onDelete}>
          <Trash2 className="w-4 h-4" /> 删除
        </Button>
      </div>
    </Card>
  );
}

// ====== 用户数据 tab ======
function UserDataTab({
  pets, loading, onDeletePet,
}: {
  pets: Pet[];
  loading: boolean;
  onDeletePet: (id: string, name: string, memberName: string) => void;
}) {
  const members = useFamilyStore(s => s.members);
  const children = members.filter(m => m.role === 'child');
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedChildId && children.length > 0) setSelectedChildId(children[0].id);
  }, [selectedChildId, children.length]);

  const selectedChild = children.find(c => c.id === selectedChildId);

  // 问题14: 按选中的孩子过滤宠物列表，区分不同孩子的宠物
  const filteredPets = selectedChildId
    ? pets.filter(p => p.member_id === selectedChildId)
    : pets;

  if (loading) return <Loading />;
  return (
    <div className="space-y-6">
      {/* 用户筛选 */}
      {children.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {children.map(c => (
            <button
              key={c.id}
              onClick={() => setSelectedChildId(c.id)}
              className={cn(
                'px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors',
                selectedChildId === c.id
                  ? 'bg-purple-400 text-white shadow-sm'
                  : 'bg-purple-50 text-purple-600 hover:bg-purple-100'
              )}
            >
              <Avatar emoji={c.avatar_emoji} size="sm" /> {c.name}
            </button>
          ))}
        </div>
      )}

      {/* 用户宠物 */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Dog className="w-4 h-4 text-amber-500" />
          <h2 className="text-sm font-semibold text-slate-700">
            孩子领养的宠物（{filteredPets.length}）
          </h2>
        </div>
        {filteredPets.length === 0 ? (
          <EmptyState icon="🐾" title="暂无宠物" description="孩子还没有领养宠物" />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredPets.map(pet => (
              <Card key={pet.id} className="p-4">
                <div className="flex items-start gap-3">
                  <div className="w-[60px] h-[80px] rounded-2xl overflow-hidden bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white text-2xl flex-shrink-0">
                    {pet.image_url ? (
                      <img src={pet.image_url} alt={pet.breed || pet.name} className="w-full h-full object-cover" />
                    ) : (
                      pet.emoji || '🐶'
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-slate-800">{pet.breed || pet.name}</h3>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">Lv.{pet.level}</span>
                      {pet.gender && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-pink-100 text-pink-600">
                          {pet.gender === 'male' ? '♂公' : '♀母'}
                        </span>
                      )}
                      <span className="text-xs text-slate-400">产金{pet.base_coin_per_day}/天</span>
                    </div>
                    <div className="flex gap-1 mt-1 text-xs text-slate-400">
                      <span>饱腹{pet.hunger}</span>
                      <span>清洁{pet.cleanliness}</span>
                      <span>心情{pet.mood}</span>
                    </div>
                  </div>
                </div>
                <div className="flex gap-2 mt-3">
                  <Button variant="ghost" size="sm" danger onClick={() => onDeletePet(pet.id, pet.breed || pet.name, selectedChild?.name ?? '')}>
                    <Trash2 className="w-4 h-4" /> 删除
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ====== 图片上传 hook（CreateItemModal / EditItemModal 共用） ======
function useImageUpload(initialUrl: string, toast: ReturnType<typeof useToastStore>, familyId: string, category: ImageCategory = 'shop') {
  const fileRef = useRef<HTMLInputElement>(null);
  const [imageUrl, setImageUrl] = useState(initialUrl);
  const [uploading, setUploading] = useState(false);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error('图片需小于 10MB');
      return;
    }
    setUploading(true);
    try {
      // 压缩为 Blob
      const blob = await compressImageToBlob(file, 1280, 0.8);
      // 上传到 Storage
      const url = await uploadImageToStorage(blob, familyId, category);
      setImageUrl(url);
      toast.success('图片已上传');
    } catch (e: any) {
      toast.error(e?.message ?? '上传失败');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return { fileRef, imageUrl, setImageUrl, handleImageUpload, uploading };
}

// ====== 新建商品弹窗 ======
function CreateItemModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const family = useFamilyStore(s => s.family);
  const toast = useToastStore();
  const { traits } = usePetTraits();
  const { fileRef, imageUrl, setImageUrl, handleImageUpload, uploading: imgUploading } = useImageUpload('', toast, family!.id, 'shop');

  const [type, setType] = useState<PetShopItemType>('pet');
  const [subcategory, setSubcategory] = useState<PetSubcategory>('dog');
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('🐶');
  const [gender, setGender] = useState<'male' | 'female'>('male');
  const [description, setDescription] = useState('');
  const [priceStar, setPriceStar] = useState(0);
  const [breed, setBreed] = useState('');
  const [baseCoinPerDay, setBaseCoinPerDay] = useState(1);
  const [rarity, setRarity] = useState<PetRarity>('common');
  const [maxLevel, setMaxLevel] = useState(3);
  // 这些字段不再随稀有度自动生成，保留默认值写入数据库，后续可在编辑弹窗调整
  const maxBloodBar = 90;
  const upgradeCoinReward = 5;
  const upgradePercent = 5;
  const dailyDecayBase = 4;
  const [traitId, setTraitId] = useState<string | null>(null);
  const [doghouseLevel, setDoghouseLevel] = useState<number>(1);
  const [recoveryValue, setRecoveryValue] = useState<number>(20);
  const [validDays, setValidDays] = useState<number>(1);
  const [saving, setSaving] = useState(false);

  const emojiOptions = getEmojiOptions(type, subcategory);

  // 切换类型时重置子分类与 emoji
  const switchType = (t: PetShopItemType) => {
    setType(t);
    const sub = defaultSubcategory(t);
    setSubcategory(sub);
    const opts = getEmojiOptions(t, sub);
    setEmoji(opts[0] ?? '');
  };

  // 切换子分类时重置 emoji
  const switchSub = (sub: PetSubcategory) => {
    setSubcategory(sub);
    const opts = getEmojiOptions(type, sub);
    setEmoji(opts[0] ?? '');
  };

  const handleSave = async () => {
    if (!family) return;
    if (!subcategory) {
      toast.warning('请选择子分类');
      return;
    }
    if (type === 'supply' && !name.trim()) {
      toast.error('请输入名称');
      return;
    }
    setSaving(true);
    try {
      await createPetShopItem({
        type,
        subcategory,
        name: type === 'supply' ? name.trim() || null : null,
        emoji: imageUrl ? undefined : emoji,
        image_url: imageUrl || undefined,
        description: description.trim() || undefined,
        price_star: priceStar,
        breed: type === 'pet' ? breed.trim() || undefined : undefined,
        base_coin_per_day: type === 'pet' ? baseCoinPerDay : undefined,
        rarity: type === 'pet' ? rarity : undefined,
        gender: type === 'pet' ? gender : undefined,
        doghouse_level: (type === 'supply' && subcategory === 'doghouse') ? doghouseLevel : undefined,
        recovery_value: type === 'supply' ? recoveryValue : undefined,
        valid_days: (type === 'supply' && subcategory === 'foster') ? validDays : undefined,
        max_level: type === 'pet' ? maxLevel : undefined,
        max_blood_bar: type === 'pet' ? maxBloodBar : undefined,
        upgrade_coin_reward: type === 'pet' ? upgradeCoinReward : undefined,
        upgrade_percent: type === 'pet' ? upgradePercent : undefined,
        daily_decay_base: type === 'pet' ? dailyDecayBase : undefined,
        trait_id: type === 'pet' ? traitId : undefined,
      });
      toast.success('已添加');
      onCreated();
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? '添加失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="新建商品" size="md">
      <div className="space-y-4">
        {/* 一级类型选择（2 按钮） */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">类型</label>
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(TYPE_CONFIG) as PetShopItemType[]).map(t => {
              const cfg = TYPE_CONFIG[t];
              return (
                <button
                  key={t}
                  onClick={() => switchType(t)}
                  className={cn(
                    'p-2 rounded-xl border-2 text-center transition-colors',
                    type === t ? 'border-star-400 bg-star-50' : 'border-slate-200'
                  )}
                >
                  <div className={cn(
                    'w-8 h-8 mx-auto rounded-lg bg-gradient-to-br flex items-center justify-center text-white mb-1',
                    cfg.color
                  )}>
                    {cfg.icon}
                  </div>
                  <span className="text-xs">{cfg.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 子分类选择 */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">子分类</label>
          <div className="flex gap-2 flex-wrap">
            {(type === 'pet' ? PET_SUBS : SUPPLY_SUBS).map(s => (
              <button
                key={s.id}
                onClick={() => switchSub(s.id)}
                className={cn(
                  'px-3 py-1.5 rounded-full text-xs font-medium transition-colors',
                  subcategory === s.id
                    ? 'bg-amber-400 text-white shadow-sm'
                    : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                )}
              >
                {'emoji' in s ? s.emoji : ''} {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* 住所等级选择：仅当用品+住所分类时显示 */}
        {type === 'supply' && subcategory === 'doghouse' && (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">住所等级（对应容纳数量）</label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { lv: 1, label: '茅草屋', cap: '容纳 1 只' },
                { lv: 2, label: '温馨住所', cap: '容纳 5 只' },
                { lv: 3, label: '豪华住所', cap: '容纳 10 只' },
              ].map(opt => (
                <button
                  key={opt.lv}
                  onClick={() => setDoghouseLevel(opt.lv)}
                  className={cn(
                    'p-2 rounded-xl border-2 text-center transition-colors',
                    doghouseLevel === opt.lv ? 'border-amber-400 bg-amber-50' : 'border-slate-200'
                  )}
                >
                  <div className="text-xs font-bold text-slate-700">{opt.label}</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">{opt.cap}</div>
                </button>
              ))}
            </div>
            <p className="text-[10px] text-slate-400 mt-1">用户必须按等级 1→2→3 顺序购买</p>
          </div>
        )}

        {/* 图片上传 */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">商品图片</label>
          <div className="flex items-center gap-3">
            <div className="w-[75px] h-[100px] rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden">
              {imageUrl ? (
                <img src={imageUrl} alt="预览" className="w-full h-full object-cover" />
              ) : emoji ? (
                <span className="text-3xl">{emoji}</span>
              ) : (
                <ImageIcon className="w-6 h-6 text-slate-300" />
              )}
            </div>
            <div className="flex-1 space-y-2">
              <input ref={fileRef} type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
              <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()} loading={imgUploading}>
                <Upload className="w-4 h-4" /> 上传图片
              </Button>
              {!imageUrl && emojiOptions.length > 0 && (
                <button
                  onClick={() => setEmoji('')}
                  className="block text-xs text-slate-400 hover:text-slate-600"
                >
                  不用图片，用 emoji 代替
                </button>
              )}
              {imageUrl && (
                <button
                  onClick={() => {
                    setImageUrl('');
                    setEmoji(emojiOptions[0] ?? '');
                  }}
                  className="block text-xs text-red-400 hover:text-red-500"
                >
                  移除图片
                </button>
              )}
            </div>
          </div>
          {/* emoji 备选（未上传图片时显示，根据子分类动态变化） */}
          {!imageUrl && emojiOptions.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {emojiOptions.map(e => (
                <button
                  key={e}
                  onClick={() => setEmoji(e)}
                  className={cn(
                    'w-9 h-9 rounded-lg text-lg flex items-center justify-center',
                    emoji === e ? 'bg-star-100 ring-2 ring-star-400' : 'bg-slate-50'
                  )}
                >
                  {e}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 宠物专属字段：品种 / 稀有度 / 性别 / 特质 / 产金 */}
        {type === 'pet' && (
          <>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">品种</label>
              <Input value={breed} onChange={e => setBreed(e.target.value)} placeholder="如：金毛" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">稀有度</label>
                <div className="flex gap-2">
                  {(Object.keys(RARITY_CONFIG) as PetRarity[]).map(r => (
                    <button
                      key={r}
                      onClick={() => setRarity(r)}
                      className={cn(
                        'flex-1 py-2 rounded-lg text-sm',
                        rarity === r ? RARITY_CONFIG[r].color : 'bg-slate-100 text-slate-400'
                      )}
                    >
                      {RARITY_CONFIG[r].label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">性别</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setGender('male')}
                    className={cn(
                      'flex-1 py-2 rounded-lg text-sm',
                      gender === 'male' ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-400'
                    )}
                  >
                    ♂ 男孩
                  </button>
                  <button
                    onClick={() => setGender('female')}
                    className={cn(
                      'flex-1 py-2 rounded-lg text-sm',
                      gender === 'female' ? 'bg-pink-100 text-pink-600' : 'bg-slate-100 text-slate-400'
                    )}
                  >
                    ♀ 女孩
                  </button>
                </div>
              </div>
            </div>
            {/* 特质选择 */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">特质</label>
              <select
                value={traitId ?? ''}
                onChange={e => setTraitId(e.target.value || null)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-star-300"
              >
                <option value="">不指定（无特质）</option>
                {traits.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.name}{t.shop_card_text ? ` · ${t.shop_card_text}` : ''}
                  </option>
                ))}
              </select>
              {traitId && traits.find(t => t.id === traitId)?.detail_text && (
                <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                  {traits.find(t => t.id === traitId)?.detail_text}
                </p>
              )}
            </div>
            {/* 基础产金（手动设置，不再随稀有度自动生成） */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">日产金/天</label>
                <Input
                  type="number"
                  min={0}
                  step="0.5"
                  value={baseCoinPerDay}
                  onChange={e => setBaseCoinPerDay(Number(e.target.value))}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">满级</label>
                <Input
                  type="number"
                  min={1}
                  value={maxLevel}
                  onChange={e => setMaxLevel(Number(e.target.value))}
                />
              </div>
            </div>
          </>
        )}

        {/* 名称（用品专属，宠物用品种字段） */}
        {type === 'supply' && (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">名称</label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="如：高级狗粮、逗猫棒" />
          </div>
        )}

        {/* 星光值价格（所有购买用星光值） */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">星光值价格</label>
          <Input
            type="number"
            min={0}
            value={priceStar}
            onChange={e => setPriceStar(Number(e.target.value))}
          />
        </div>

        {/* 用品恢复值（非住所用品） */}
        {type === 'supply' && subcategory !== 'doghouse' && subcategory !== 'foster' && (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              恢复值（使用时恢复对应血条值）
            </label>
            <Input
              type="number"
              min={1}
              max={100}
              value={recoveryValue}
              onChange={e => setRecoveryValue(Number(e.target.value))}
            />
          </div>
        )}

        {/* 托管卡有效天数（寄养用品） */}
        {type === 'supply' && subcategory === 'foster' && (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">有效天数</label>
            <Input
              type="number"
              min={1}
              value={validDays}
              onChange={e => setValidDays(Math.max(1, Number(e.target.value) || 1))}
            />
          </div>
        )}

        {/* 描述（可选） */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">描述（可选）</label>
          <Textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="商品描述"
            rows={2}
          />
        </div>

        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose} className="flex-1">取消</Button>
          <Button onClick={handleSave} loading={saving} className="flex-1">添加</Button>
        </div>
      </div>
    </Modal>
  );
}

// ====== 编辑商品弹窗 ======
function EditItemModal({
  item, onClose, onUpdated,
}: {
  item: PetShopItem;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const toast = useToastStore();
  const family = useFamilyStore(s => s.family);
  const { traits } = usePetTraits();
  const { fileRef, imageUrl, setImageUrl, handleImageUpload, uploading: imgUploading } = useImageUpload(item.image_url || '', toast, family?.id || '', 'shop');

  const [subcategory, setSubcategory] = useState<PetSubcategory>(
    item.subcategory ?? defaultSubcategory(item.type)
  );
  const [name, setName] = useState(item.name || '');
  const [emoji, setEmoji] = useState(item.emoji || '');
  const [gender, setGender] = useState<'male' | 'female'>(item.gender || 'male');
  const [description, setDescription] = useState(item.description || '');
  const [priceStar, setPriceStar] = useState(item.price_star);
  const [breed, setBreed] = useState(item.breed || '');
  const [baseCoinPerDay, setBaseCoinPerDay] = useState(item.base_coin_per_day);
  const [rarity, setRarity] = useState<PetRarity>(item.rarity);
  const [traitId, setTraitId] = useState<string | null>(item.trait_id ?? null);
  const [recoveryValue, setRecoveryValue] = useState<number>(item.recovery_value ?? 20);
  const [validDays, setValidDays] = useState<number>(item.valid_days ?? 1);
  const [saving, setSaving] = useState(false);

  const emojiOptions = getEmojiOptions(item.type, subcategory);

  const switchSub = (sub: PetSubcategory) => {
    setSubcategory(sub);
    const opts = getEmojiOptions(item.type, sub);
    if (opts.length > 0 && !opts.includes(emoji)) {
      setEmoji(opts[0]);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updatePetShopItem(item.id, {
        subcategory,
        name: item.type === 'supply' ? name.trim() || null : null,
        emoji: imageUrl ? null : emoji,
        image_url: imageUrl || null,
        description: description.trim() || null,
        price_star: priceStar,
        breed: item.type === 'pet' ? breed.trim() || null : null,
        base_coin_per_day: item.type === 'pet' ? baseCoinPerDay : undefined,
        rarity: item.type === 'pet' ? rarity : undefined,
        gender: item.type === 'pet' ? gender : undefined,
        trait_id: item.type === 'pet' ? traitId : undefined,
        recovery_value: item.type === 'supply' ? recoveryValue : undefined,
        valid_days: (item.type === 'supply' && subcategory === 'foster') ? validDays : undefined,
      });
      toast.success('已更新');
      onUpdated();
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? '更新失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="编辑商品" size="md">
      <div className="space-y-4">
        {/* 子分类（编辑时也可调整） */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">子分类</label>
          <div className="flex gap-2 flex-wrap">
            {(item.type === 'pet' ? PET_SUBS : SUPPLY_SUBS).map(s => (
              <button
                key={s.id}
                onClick={() => switchSub(s.id)}
                className={cn(
                  'px-3 py-1.5 rounded-full text-xs font-medium transition-colors',
                  subcategory === s.id
                    ? 'bg-amber-400 text-white shadow-sm'
                    : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                )}
              >
                {'emoji' in s ? s.emoji : ''} {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* 图片 */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">商品图片</label>
          <div className="flex items-center gap-3">
            <div className="w-[75px] h-[100px] rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden">
              {imageUrl ? (
                <img src={imageUrl} alt="预览" className="w-full h-full object-cover" />
              ) : emoji ? (
                <span className="text-3xl">{emoji}</span>
              ) : (
                <ImageIcon className="w-6 h-6 text-slate-300" />
              )}
            </div>
            <div className="flex-1 space-y-2">
              <input ref={fileRef} type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
              <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()} loading={imgUploading}>
                <Upload className="w-4 h-4" /> 上传图片
              </Button>
              {imageUrl && (
                <button
                  onClick={() => setImageUrl('')}
                  className="block text-xs text-red-400 hover:text-red-500"
                >
                  移除图片
                </button>
              )}
            </div>
          </div>
          {!imageUrl && emojiOptions.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {emojiOptions.map(e => (
                <button
                  key={e}
                  onClick={() => setEmoji(e)}
                  className={cn(
                    'w-9 h-9 rounded-lg text-lg flex items-center justify-center',
                    emoji === e ? 'bg-star-100 ring-2 ring-star-400' : 'bg-slate-50'
                  )}
                >
                  {e}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 宠物字段 */}
        {item.type === 'pet' && (
          <>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">品种</label>
              <Input value={breed} onChange={e => setBreed(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">稀有度</label>
                <div className="flex gap-2">
                  {(Object.keys(RARITY_CONFIG) as PetRarity[]).map(r => (
                    <button
                      key={r}
                      onClick={() => setRarity(r)}
                      className={cn(
                        'flex-1 py-2 rounded-lg text-sm',
                        rarity === r ? RARITY_CONFIG[r].color : 'bg-slate-100 text-slate-400'
                      )}
                    >
                      {RARITY_CONFIG[r].label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">性别</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setGender('male')}
                    className={cn(
                      'flex-1 py-2 rounded-lg text-sm',
                      gender === 'male' ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-400'
                    )}
                  >
                    ♂ 男孩
                  </button>
                  <button
                    onClick={() => setGender('female')}
                    className={cn(
                      'flex-1 py-2 rounded-lg text-sm',
                      gender === 'female' ? 'bg-pink-100 text-pink-600' : 'bg-slate-100 text-slate-400'
                    )}
                  >
                    ♀ 女孩
                  </button>
                </div>
              </div>
            </div>
            {/* 特质选择 */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">特质</label>
              <select
                value={traitId ?? ''}
                onChange={e => setTraitId(e.target.value || null)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-star-300"
              >
                <option value="">不指定（无特质）</option>
                {traits.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.name}{t.shop_card_text ? ` · ${t.shop_card_text}` : ''}
                  </option>
                ))}
              </select>
              {traitId && traits.find(t => t.id === traitId)?.detail_text && (
                <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                  {traits.find(t => t.id === traitId)?.detail_text}
                </p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">基础产金/天</label>
              <Input
                type="number"
                min={0}
                step="0.5"
                value={baseCoinPerDay}
                onChange={e => setBaseCoinPerDay(Number(e.target.value))}
              />
            </div>
          </>
        )}

        {/* 名称（用品专属，宠物用品种字段） */}
        {item.type === 'supply' && (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">名称</label>
            <Input value={name} onChange={e => setName(e.target.value)} />
          </div>
        )}

        {/* 星光值价格 */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">星光值价格</label>
          <Input
            type="number"
            min={0}
            value={priceStar}
            onChange={e => setPriceStar(Number(e.target.value))}
          />
        </div>

        {/* 用品恢复值（非住所、非寄养用品） */}
        {item.type === 'supply' && subcategory !== 'doghouse' && subcategory !== 'foster' && (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              恢复值（使用时恢复对应血条值）
            </label>
            <Input
              type="number"
              min={1}
              max={100}
              value={recoveryValue}
              onChange={e => setRecoveryValue(Number(e.target.value))}
            />
          </div>
        )}

        {/* 托管卡有效天数（寄养用品） */}
        {item.type === 'supply' && subcategory === 'foster' && (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">有效天数</label>
            <Input
              type="number"
              min={1}
              value={validDays}
              onChange={e => setValidDays(Math.max(1, Number(e.target.value) || 1))}
            />
          </div>
        )}

        {/* 描述 */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">描述</label>
          <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} />
        </div>

        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose} className="flex-1">取消</Button>
          <Button onClick={handleSave} loading={saving} className="flex-1">保存</Button>
        </div>
      </div>
    </Modal>
  );
}

// ====== 背景管理 tab ======
// 压缩图片：缩放+转JPEG，大幅减小体积
// 压缩图片为 Blob（用于上传到 Storage）
function compressImageToBlob(file: File, maxWidth: number, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('Canvas not supported')); return; }
        ctx.drawImage(img, 0, 0, width, height);
        // 问题17: PNG 保留透明背景，不强制转 JPEG
        const outputType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
        canvas.toBlob(
          (blob) => blob ? resolve(blob) : reject(new Error('压缩失败')),
          outputType,
          quality,
        );
      };
      img.onerror = () => reject(new Error('图片加载失败'));
      img.src = reader.result as string;
    };
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsDataURL(file);
  });
}
function BackgroundTab() {
  const family = useFamilyStore(s => s.family);
  const toast = useToastStore();
  const [backgrounds, setBackgrounds] = useState<PetBackground[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [migrateProgress, setMigrateProgress] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const loadBgs = useCallback(async () => {
    if (!family) return;
    setLoading(true);
    try {
      const data = await fetchBackgrounds();
      setBackgrounds(data);
    } catch (e: any) {
      toast.error(e?.message ?? '加载失败');
    } finally {
      setLoading(false);
    }
  }, [family?.id]);

  useEffect(() => { loadBgs(); }, [loadBgs]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error('图片不能超过10MB');
      return;
    }
    setUploading(true);
    try {
      // 压缩图片为 Blob，上传到 Storage
      const blob = await compressImageToBlob(file, 1280, 0.8);
      const url = await uploadImageToStorage(blob, family!.id, 'backgrounds');
      const name = file.name.replace(/\.[^.]+$/, '');
      await createBackground(name, url);
      toast.success('上传成功');
      loadBgs();
    } catch (e: any) {
      toast.error(e?.message ?? '上传失败');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteBackground(id);
      toast.success('已删除');
      loadBgs();
    } catch (e: any) {
      toast.error(e?.message ?? '删除失败');
    }
  };

  // 一次性迁移：把旧的 base64 图片搬到 Storage
  const handleMigrate = async () => {
    if (!family) return;
    setMigrating(true);
    setMigrateProgress('正在扫描...');
    try {
      const result = await migrateBase64ToStorage(
        family.id,
        uploadImageToStorage,
        (done, total, label) => setMigrateProgress(`${label} (${done}/${total})`),
      );
      toast.success(`迁移完成：商品图片 ${result.shopMigrated} 张，背景图 ${result.bgMigrated} 张`);
      loadBgs();
    } catch (e: any) {
      toast.error(e?.message ?? '迁移失败');
    } finally {
      setMigrating(false);
      setMigrateProgress('');
    }
  };

  if (loading) return <Loading />;

  return (
    <div className="space-y-4">
      {/* 迁移旧图片按钮 */}
      <div className="flex items-center justify-between p-3 rounded-xl border-2 border-amber-200 bg-amber-50">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-amber-700">一键迁移旧图片到 Storage</p>
          <p className="text-xs text-amber-500 mt-0.5">
            {migrating ? migrateProgress : '把之前以 base64 存储的商品/背景图迁移到 Storage，提升加载速度'}
          </p>
        </div>
        <Button onClick={handleMigrate} loading={migrating} size="sm" variant="secondary">
          <Upload className="w-4 h-4" /> 迁移
        </Button>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">上传背景图，孩子可在萌宠星球前台免费切换</p>
        <input ref={fileRef} type="file" accept="image/*" onChange={handleUpload} className="hidden" />
        <Button onClick={() => fileRef.current?.click()} loading={uploading} size="sm">
          <Upload className="w-4 h-4" /> 上传背景
        </Button>
      </div>

      {backgrounds.length === 0 ? (
        <EmptyState icon="🖼️" title="还没有自定义背景" description="点击右上角上传" />
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {backgrounds.map(bg => (
            <Card key={bg.id} className="p-3">
              <img
                src={bg.image_data}
                alt={bg.name}
                className="w-full aspect-video object-cover rounded-lg mb-2"
              />
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-700 truncate">{bg.name}</span>
                <button
                  onClick={() => handleDelete(bg.id)}
                  className="text-red-500 hover:text-red-600 p-1"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ====== 抽卡管理 Tab ======
function GachaConfigTab() {
  const toast = useToastStore();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // 用 string 方便输入控制
  const [adoptCost, setAdoptCost] = useState('150');
  const [cancelPenalty, setCancelPenalty] = useState('45');
  const [commonProb, setCommonProb] = useState('70');
  const [rareProb, setRareProb] = useState('25');
  const [epicProb, setEpicProb] = useState('5');

  const loadCfg = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchGachaConfig();
      setAdoptCost(String(data.adopt_cost));
      setCancelPenalty(String(data.cancel_penalty));
      setCommonProb(String(data.rarity_common_prob));
      setRareProb(String(data.rarity_rare_prob));
      setEpicProb(String(data.rarity_epic_prob));
    } catch (e: any) {
      toast.error(e?.message ?? '加载抽卡配置失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadCfg(); }, [loadCfg]);

  const probSum = Number(commonProb || 0) + Number(rareProb || 0) + Number(epicProb || 0);
  const probValid = Math.abs(probSum - 100) < 0.01;
  const costValid = Number(adoptCost) >= 0 && Number(cancelPenalty) >= 0;

  const handleSave = async () => {
    if (!probValid) {
      toast.error('三个稀有度概率之和必须为100，当前为' + probSum);
      return;
    }
    if (!costValid) {
      toast.error('扣费值不能为负');
      return;
    }
    setSaving(true);
    try {
      await updateGachaConfig({
        adopt_cost: Number(adoptCost),
        cancel_penalty: Number(cancelPenalty),
        rarity_common_prob: Number(commonProb),
        rarity_rare_prob: Number(rareProb),
        rarity_epic_prob: Number(epicProb),
      });
      toast.success('抽卡配置已保存');
      loadCfg();
    } catch (e: any) {
      toast.error(e?.message ?? '保存失败');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <EmptyState icon="🎲" title="加载中..." />;
  }

  return (
    <div className="space-y-4">
      <Card className="p-5 space-y-4">
        <div>
          <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <Dices className="w-5 h-5 text-star-500" />
            抽卡参数配置
          </h2>
          <p className="text-xs text-slate-400 mt-1 leading-relaxed">
            全局生效；抽取按稀有度权重加权随机（每只宠物权重 = 其稀有度对应概率），
            自动剔除当前用户已拥有的宠物。
          </p>
        </div>

        {/* 扣费配置 */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">
              领养扣星光值
            </label>
            <Input
              type="number"
              value={adoptCost}
              onChange={e => setAdoptCost(e.target.value)}
              min={0}
              className="w-full"
            />
            <p className="text-[11px] text-slate-400 mt-1">抽中后选择"领养"时扣除的星光值</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">
              放弃扣星光值
            </label>
            <Input
              type="number"
              value={cancelPenalty}
              onChange={e => setCancelPenalty(e.target.value)}
              min={0}
              className="w-full"
            />
            <p className="text-[11px] text-slate-400 mt-1">放弃抽卡时扣除的星光值</p>
          </div>
        </div>

        {/* 稀有度概率配置 */}
        <div className="border-t border-slate-100 pt-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-bold text-slate-700">稀有度抽取概率 (%)</h3>
            <span className={cn(
              'text-xs px-2 py-0.5 rounded-full font-medium',
              probValid ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'
            )}>
              合计 {probSum} / 100
            </span>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                <span className="inline-block w-2 h-2 rounded-full bg-slate-400 mr-1.5" />
                普通
              </label>
              <Input
                type="number"
                value={commonProb}
                onChange={e => setCommonProb(e.target.value)}
                min={0}
                max={100}
                step="0.01"
                className="w-full"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                <span className="inline-block w-2 h-2 rounded-full bg-blue-500 mr-1.5" />
                稀有
              </label>
              <Input
                type="number"
                value={rareProb}
                onChange={e => setRareProb(e.target.value)}
                min={0}
                max={100}
                step="0.01"
                className="w-full"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                <span className="inline-block w-2 h-2 rounded-full bg-purple-500 mr-1.5" />
                史诗
              </label>
              <Input
                type="number"
                value={epicProb}
                onChange={e => setEpicProb(e.target.value)}
                min={0}
                max={100}
                step="0.01"
                className="w-full"
              />
            </div>
          </div>
          <p className="text-[11px] text-slate-400 mt-2">
            注意：实际抽中某稀有度的概率还受该稀有度下可抽宠物数量影响
            （每只宠物独立权重 = 此处配置值）。
          </p>
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
          <Button onClick={handleSave} disabled={saving || !probValid || !costValid}>
            {saving ? '保存中...' : '保存配置'}
          </Button>
        </div>
      </Card>
    </div>
  );
}
