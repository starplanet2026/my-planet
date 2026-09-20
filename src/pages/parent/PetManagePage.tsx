import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { useFamilyStore } from '../../store/familyStore';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Input, Textarea } from '../../components/common/Input';
import { Modal } from '../../components/common/Modal';
import { EmptyState } from '../../components/common/EmptyState';
import { Loading } from '../../components/common/Loading';
import { useToastStore } from '../../store/toastStore';
import { ROUTES } from '../../lib/constants';
import { cn } from '../../lib/utils';
import {
  Plus, Trash2, ArrowLeft, Dog, ShoppingBag, Star, Upload,
  Image as ImageIcon, Pencil, BookOpen, Package, CheckSquare, Square, Send, Power,
} from 'lucide-react';
import {
  fetchPetShopItems, createPetShopItem, deletePetShopItem, updatePetShopItem,
  batchUpdatePetShopStatus, batchDeletePetShopItems,
  fetchPetWords, createPetWord, createPetWordsBatch, deletePetWord,
  fetchAllPets, deletePet,
  fetchBackgrounds, createBackground, deleteBackground,
  migrateBase64ToStorage,
  fetchGameWordStats,
} from '../../api/pets';
import type {
  PetShopItem, PetShopItemType, PetSubcategory, PetRarity, PetWord, Pet,
  PetBackground, GameWordStat,
} from '../../api/types';
import { uploadImageToStorage, deleteImageFromStorage, type ImageCategory } from '../../lib/storage';

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

// 用品子分类（食品 / 清洁 / 玩具 / 药品 / 寄养 / 狗屋）
const SUPPLY_SUBS = [
  { id: 'food' as const, label: '食品', emojis: ['🍖', '🥩', '🍗', '🐟', '🥛', '🍪', '🥫'] },
  { id: 'clean' as const, label: '清洁', emojis: ['🧼', '🚿', '🛁', '🧴'] },
  { id: 'toy' as const, label: '玩具', emojis: ['🎾', '🧸', '🎈', '🎮', '🪀', '🎁', '🎯'] },
  { id: 'medicine' as const, label: '药品', emojis: ['💊', '💉', '🧪', '🩺'] },
  { id: 'foster' as const, label: '寄养', emojis: ['🏠', '🏨', '🛏️'] },
  { id: 'doghouse' as const, label: '狗屋', emojis: ['🏡', '🏠', '🛖'] },
];

// 子分类标签文案
const SUB_LABEL: Record<string, string> = {
  dog: '狗', cat: '猫', food: '食品', clean: '清洁', toy: '玩具', medicine: '药品', foster: '寄养', doghouse: '狗屋',
};

// 稀有度配置
const RARITY_CONFIG: Record<PetRarity, { label: string; color: string }> = {
  common: { label: '普通', color: 'bg-slate-100 text-slate-500' },
  rare: { label: '稀有', color: 'bg-blue-100 text-blue-600' },
  epic: { label: '史诗', color: 'bg-purple-100 text-purple-600' },
};

// 稀有度属性范围配置
const RARITY_STATS: Record<PetRarity, {
  priceStar: [number, number];
  baseCoin: [number, number];
  maxLevel: number;
  maxBlood: [number, number];
  upgradeReward: [number, number];
  upgradePercent: number;
  dailyDecay: [number, number];
}> = {
  common: { priceStar: [30, 80], baseCoin: [1, 2], maxLevel: 3, maxBlood: [80, 100], upgradeReward: [3, 8], upgradePercent: 5, dailyDecay: [3, 5] },
  rare: { priceStar: [100, 250], baseCoin: [2, 3], maxLevel: 5, maxBlood: [100, 120], upgradeReward: [8, 15], upgradePercent: 8, dailyDecay: [5, 7] },
  epic: { priceStar: [300, 600], baseCoin: [3, 4], maxLevel: 7, maxBlood: [120, 150], upgradeReward: [15, 30], upgradePercent: 12, dailyDecay: [8, 10] },
};

function randomInRange(min: number, max: number): number {
  return Math.round(min + Math.random() * (max - min));
}

// 宠物各子分类的 emoji 备选
const PET_EMOJIS: Record<'dog' | 'cat', string[]> = {
  dog: ['🐶', '🐕', '🦮', '🐩', '🦴'],
  cat: ['🐱', '🐈', '😺', '😻', '🐾'],
};

// 商品分类筛选：全部 / 宠物 / 食物 / 清洁 / 玩具 / 药品 / 狗屋
type CategoryFilter = 'all' | 'pet' | 'food' | 'clean' | 'toy' | 'medicine' | 'doghouse';
const CATEGORY_OPTIONS: { id: CategoryFilter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'pet', label: '宠物' },
  { id: 'food', label: '食物' },
  { id: 'clean', label: '清洁' },
  { id: 'toy', label: '玩具' },
  { id: 'medicine', label: '药品' },
  { id: 'doghouse', label: '狗屋' },
];

// 顶部 tab：商品管理 / 单词管理 / 用户数据
type PageTab = 'shop' | 'word' | 'user' | 'bg';
const PAGE_TABS: { id: PageTab; label: string; icon: React.ReactNode }[] = [
  { id: 'shop', label: '商品管理', icon: <Package className="w-4 h-4" /> },
  { id: 'word', label: '单词管理', icon: <BookOpen className="w-4 h-4" /> },
  { id: 'user', label: '用户数据', icon: <Dog className="w-4 h-4" /> },
  { id: 'bg', label: '背景管理', icon: <ImageIcon className="w-4 h-4" /> },
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

export function PetManagePage() {
  const navigate = useNavigate();
  const family = useFamilyStore(s => s.family);
  const toast = useToastStore();

  const [activeTab, setActiveTab] = useState<PageTab>('shop');
  const [items, setItems] = useState<PetShopItem[]>([]);
  const [words, setWords] = useState<PetWord[]>([]);
  const [userPets, setUserPets] = useState<Pet[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editingItem, setEditingItem] = useState<PetShopItem | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');

  const loadItems = async () => {
    if (!family) return;
    setLoading(true);
    try {
      setItems(await fetchPetShopItems(family.id, undefined, undefined, true));
    } catch (e: any) {
      toast.error(e?.message ?? '加载商品失败');
    } finally {
      setLoading(false);
    }
  };

  const loadWords = async () => {
    if (!family) return;
    try {
      setWords(await fetchPetWords(family.id));
    } catch (e: any) {
      toast.error(e?.message ?? '加载单词失败');
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

  const handleDeletePet = async (petId: string, petName: string) => {
    try {
      await deletePet(petId);
      toast.success(`已删除宠物「${petName}」`);
      loadUserData();
    } catch (e: any) {
      toast.error(e?.message ?? '删除失败');
    }
  };

  useEffect(() => {
    if (family?.id) {
      loadItems();
      loadWords();
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

  const handleDeleteWord = async (id: string) => {
    try {
      await deletePetWord(id);
      toast.success('已删除');
      loadWords();
    } catch (e: any) {
      toast.error(e?.message ?? '删除失败');
    }
  };

  const handleAddWord = async (en: string, cn: string, pos: string) => {
    if (!family) return;
    if (!en.trim() || !cn.trim()) {
      toast.warning('请填写英文和中文');
      return;
    }
    try {
      await createPetWord(family.id, en.trim(), cn.trim(), pos.trim() || undefined);
      toast.success('已添加');
      loadWords();
    } catch (e: any) {
      toast.error(e?.message ?? '添加失败');
    }
  };

  const handleBatchImport = async (text: string) => {
    if (!family) return;
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) {
      toast.warning('请输入单词，每行格式：英文,词性,中文');
      return;
    }
    const parsed: { en: string; cn: string; pos?: string }[] = [];
    for (const line of lines) {
      const parts = line.split(/[,，\t]/).map(s => s.trim());
      if (parts.length >= 3 && parts[0] && parts[2]) {
        parsed.push({ en: parts[0], pos: parts[1], cn: parts[2] });
      } else if (parts.length >= 2 && parts[0] && parts[1]) {
        parsed.push({ en: parts[0], cn: parts[1] });
      }
    }
    if (parsed.length === 0) {
      toast.warning('未解析到有效单词，每行格式：英文,词性,中文');
      return;
    }
    try {
      await createPetWordsBatch(family.id, parsed);
      toast.success(`已导入 ${parsed.length} 个单词`);
      loadWords();
    } catch (e: any) {
      toast.error(e?.message ?? '导入失败');
    }
  };

  // Excel 导入
  const [excelImporting, setExcelImporting] = useState(false);
  const excelFileRef = useRef<HTMLInputElement>(null);

  const handleExcelImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !family) return;
    setExcelImporting(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      if (!ws) throw new Error('Excel 中未找到工作表');
      const rows: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      if (rows.length === 0) throw new Error('Excel 中无数据');

      // 检测表头：第一行如果包含"英文"/"english"等关键词则跳过
      const firstRow = rows[0].map(c => String(c).toLowerCase().trim());
      const hasHeader = firstRow.some(c =>
        c.includes('英文') || c.includes('english') || c.includes('词性') || c.includes('pos') || c.includes('中文') || c.includes('chinese')
      );
      const dataRows = hasHeader ? rows.slice(1) : rows;

      const parsed: { en: string; cn: string; pos?: string }[] = [];
      for (const row of dataRows) {
        const en = String(row[0] ?? '').trim();
        const pos = String(row[1] ?? '').trim();
        const cn = String(row[2] ?? '').trim();
        if (en && cn) {
          parsed.push({ en, cn, pos: pos || undefined });
        } else if (en && pos && !cn) {
          // 2列情况：英文,中文
          parsed.push({ en, cn: pos });
        }
      }

      if (parsed.length === 0) {
        toast.warning('未解析到有效单词，Excel 格式：英文 | 词性 | 中文');
        return;
      }

      await createPetWordsBatch(family.id, parsed);
      toast.success(`Excel 导入成功：${parsed.length} 个单词`);
      loadWords();
    } catch (e: any) {
      toast.error(e?.message ?? 'Excel 导入失败');
    } finally {
      setExcelImporting(false);
      if (excelFileRef.current) excelFileRef.current.value = '';
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

      {/* 单词管理 tab */}
      {activeTab === 'word' && (
        <WordManageTab
          words={words}
          onAdd={handleAddWord}
          onBatchImport={handleBatchImport}
          onDelete={handleDeleteWord}
          onExcelImport={handleExcelImport}
          excelImporting={excelImporting}
          excelFileRef={excelFileRef}
        />
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

      {showCreate && (
        <CreateItemModal onClose={() => setShowCreate(false)} onCreated={loadItems} />
      )}
      {editingItem && (
        <EditItemModal item={editingItem} onClose={() => setEditingItem(null)} onUpdated={loadItems} />
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
              {item.name || (item.type === 'pet' ? '宠物' : '未命名')}
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
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {/* 星光值价格（所有购买用星光值） */}
            {item.price_star > 0 ? (
              <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-600 inline-flex items-center gap-0.5">
                <Star className="w-3 h-3" />{item.price_star}
              </span>
            ) : (
              <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-600">免费</span>
            )}
            {/* 宠物显示产金（基础产金/天，非价格） */}
            {item.type === 'pet' && (
              <span className="text-xs text-slate-400">产金{item.base_coin_per_day}/天</span>
            )}
            {item.status === 'inactive' && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-400">已下架</span>
            )}
          </div>
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
  onDeletePet: (id: string, name: string) => void;
}) {
  const members = useFamilyStore(s => s.members);
  const children = members.filter(m => m.role === 'child');
  const toast = useToastStore();
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null);
  const [wordStats, setWordStats] = useState<GameWordStat[]>([]);
  const [statsLoading, setStatsLoading] = useState(false);

  useEffect(() => {
    if (!selectedChildId) {
      if (children.length > 0) setSelectedChildId(children[0].id);
      return;
    }
    setStatsLoading(true);
    fetchGameWordStats(selectedChildId)
      .then(setWordStats)
      .catch(e => toast.error(e?.message ?? '加载单词统计失败'))
      .finally(() => setStatsLoading(false));
  }, [selectedChildId, children.length]);

  if (loading) return <Loading />;
  return (
    <div className="space-y-6">
      {/* 单词挑战统计 */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <BookOpen className="w-4 h-4 text-purple-500" />
          <h2 className="text-sm font-semibold text-slate-700">单词挑战统计</h2>
        </div>
        {children.length === 0 ? (
          <EmptyState icon="👶" title="暂无孩子" description="先添加孩子账号" />
        ) : (
          <>
            <div className="flex gap-2 mb-3 overflow-x-auto pb-1">
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
                  {c.avatar_emoji} {c.name}
                </button>
              ))}
            </div>
            {statsLoading ? (
              <Loading />
            ) : wordStats.length === 0 ? (
              <EmptyState icon="📊" title="暂无挑战记录" description="孩子还未闯关" />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {wordStats.map(s => (
                  <Card key={s.id} className="p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium text-slate-800 truncate">
                            {s.word?.word_en ?? '—'}
                          </span>
                          {s.word?.part_of_speech && (
                            <span className="text-[10px] px-1 py-0.5 rounded bg-purple-100 text-purple-600 flex-shrink-0">
                              {s.word.part_of_speech}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500 truncate">
                          {s.word?.word_cn ?? '—'}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0 text-xs">
                        <span className="text-slate-500">挑战 {s.challenge_count}</span>
                        {s.wrong_count > 0 && (
                          <span className="text-red-500 font-medium">错误 {s.wrong_count}</span>
                        )}
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* 用户宠物 */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Dog className="w-4 h-4 text-amber-500" />
          <h2 className="text-sm font-semibold text-slate-700">孩子领养的宠物（{pets.length}）</h2>
        </div>
        {pets.length === 0 ? (
          <EmptyState icon="🐾" title="暂无宠物" description="孩子还没有领养宠物" />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {pets.map(pet => (
              <Card key={pet.id} className="p-4">
                <div className="flex items-start gap-3">
                  <div className="w-[60px] h-[80px] rounded-2xl overflow-hidden bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white text-2xl flex-shrink-0">
                    {pet.image_url ? (
                      <img src={pet.image_url} alt={pet.name} className="w-full h-full object-cover" />
                    ) : (
                      pet.emoji || '🐶'
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-slate-800">{pet.name}</h3>
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
                  <Button variant="ghost" size="sm" danger onClick={() => onDeletePet(pet.id, pet.name)}>
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

// ====== 单词管理 tab ======
function WordManageTab({
  words, onAdd, onBatchImport, onDelete, onExcelImport, excelImporting, excelFileRef,
}: {
  words: PetWord[];
  onAdd: (en: string, cn: string, pos: string) => void | Promise<void>;
  onBatchImport: (text: string) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
  onExcelImport: (e: React.ChangeEvent<HTMLInputElement>) => void | Promise<void>;
  excelImporting: boolean;
  excelFileRef: React.RefObject<HTMLInputElement>;
}) {
  const [en, setEn] = useState('');
  const [cn, setCn] = useState('');
  const [pos, setPos] = useState('');
  const [batchText, setBatchText] = useState('');
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);

  const handleAdd = async () => {
    setAdding(true);
    try {
      await onAdd(en, cn, pos);
      setEn('');
      setCn('');
      setPos('');
    } finally {
      setAdding(false);
    }
  };

  const handleBatch = async () => {
    setImporting(true);
    try {
      await onBatchImport(batchText);
      setBatchText('');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* 新增单词 */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">新增单词</h3>
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            value={en}
            onChange={e => setEn(e.target.value)}
            placeholder="英文，如 apple"
            className="flex-1"
          />
          <Input
            value={pos}
            onChange={e => setPos(e.target.value)}
            placeholder="词性，如 n."
            className="sm:w-24"
          />
          <Input
            value={cn}
            onChange={e => setCn(e.target.value)}
            placeholder="中文，如 苹果"
            className="flex-1"
          />
          <Button onClick={handleAdd} loading={adding} className="sm:w-auto">
            <Plus className="w-4 h-4" /> 添加
          </Button>
        </div>
      </Card>

      {/* Excel 导入 */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-semibold text-slate-700">Excel 导入</h3>
          <input ref={excelFileRef} type="file" accept=".xlsx,.xls,.csv" onChange={onExcelImport} className="hidden" />
          <Button
            onClick={() => excelFileRef.current?.click()}
            loading={excelImporting}
            size="sm"
            variant="secondary"
          >
            <Upload className="w-4 h-4" /> 选择 Excel 文件
          </Button>
        </div>
        <p className="text-xs text-slate-400">
          格式：第1列英文 | 第2列词性 | 第3列中文（支持表头行自动跳过）
        </p>
      </Card>

      {/* 批量文本导入 */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-1">批量文本导入</h3>
        <p className="text-xs text-slate-400 mb-3">每行格式：英文,词性,中文（支持中英文逗号、Tab）</p>
        <Textarea
          value={batchText}
          onChange={e => setBatchText(e.target.value)}
          placeholder={'apple,n.,苹果\nbanana,n.,香蕉\ncat,n.,猫'}
          rows={5}
        />
        <div className="mt-3 flex justify-end">
          <Button onClick={handleBatch} loading={importing} variant="secondary">
            <Upload className="w-4 h-4" /> 批量导入
          </Button>
        </div>
      </Card>

      {/* 单词列表 */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-700">单词列表（{words.length}）</h3>
        </div>
        {words.length === 0 ? (
          <EmptyState icon="📚" title="暂无单词" description="新增或批量导入单词" />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {words.map(w => (
              <Card key={w.id} className="p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-slate-800 truncate">{w.word_en}</span>
                      {w.part_of_speech && (
                        <span className="text-[10px] px-1 py-0.5 rounded bg-purple-100 text-purple-600 flex-shrink-0">
                          {w.part_of_speech}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 truncate">{w.word_cn}</div>
                  </div>
                  <button
                    onClick={() => onDelete(w.id)}
                    className="p-1.5 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors flex-shrink-0"
                    aria-label="删除"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
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
  const [maxBloodBar, setMaxBloodBar] = useState(90);
  const [upgradeCoinReward, setUpgradeCoinReward] = useState(5);
  const [upgradePercent, setUpgradePercent] = useState(5);
  const [dailyDecayBase, setDailyDecayBase] = useState(4);
  const [doghouseLevel, setDoghouseLevel] = useState<number>(1);
  const [recoveryValue, setRecoveryValue] = useState<number>(20);
  const [saving, setSaving] = useState(false);

  const emojiOptions = getEmojiOptions(type, subcategory);

  // 根据稀有度自动生成属性
  const applyRarity = (r: PetRarity) => {
    setRarity(r);
    const cfg = RARITY_STATS[r];
    setPriceStar(randomInRange(cfg.priceStar[0], cfg.priceStar[1]));
    setBaseCoinPerDay(randomInRange(cfg.baseCoin[0], cfg.baseCoin[1]));
    setMaxLevel(cfg.maxLevel);
    setMaxBloodBar(randomInRange(cfg.maxBlood[0], cfg.maxBlood[1]));
    setUpgradeCoinReward(randomInRange(cfg.upgradeReward[0], cfg.upgradeReward[1]));
    setUpgradePercent(cfg.upgradePercent);
    setDailyDecayBase(randomInRange(cfg.dailyDecay[0], cfg.dailyDecay[1]));
  };

  // 初始化：生成 common 默认属性
  useEffect(() => {
    applyRarity('common');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        family_id: family.id,
        type,
        subcategory,
        name: type === 'supply' ? name.trim() : undefined,
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
        max_level: type === 'pet' ? maxLevel : undefined,
        max_blood_bar: type === 'pet' ? maxBloodBar : undefined,
        upgrade_coin_reward: type === 'pet' ? upgradeCoinReward : undefined,
        upgrade_percent: type === 'pet' ? upgradePercent : undefined,
        daily_decay_base: type === 'pet' ? dailyDecayBase : undefined,
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

        {/* 狗屋等级选择：仅当用品+狗屋分类时显示 */}
        {type === 'supply' && subcategory === 'doghouse' && (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">狗屋等级（对应容纳数量）</label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { lv: 1, label: '茅草屋', cap: '容纳 1 只' },
                { lv: 2, label: '温馨狗屋', cap: '容纳 5 只' },
                { lv: 3, label: '豪华狗屋', cap: '容纳 10 只' },
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

        {/* 宠物专属字段：品种 / 稀有度 / 性别 / 产金 */}
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
                      onClick={() => applyRarity(r)}
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
            {/* 稀有度属性预览 */}
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-1.5">
              <p className="text-xs font-medium text-slate-500">自动生成属性（选择稀有度后随机生成）</p>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-600">
                <span>日产金: <strong className="text-yellow-600">{baseCoinPerDay}</strong>/天</span>
                <span>满级: <strong className="text-slate-700">Lv.{maxLevel}</strong></span>
                <span>升级奖励: <strong className="text-slate-700">{upgradeCoinReward}</strong>金币</span>
                <span>血条上限: <strong className="text-slate-700">{maxBloodBar}</strong></span>
                <span>升级加成: <strong className="text-slate-700">{upgradePercent}%</strong></span>
                <span>日衰减: <strong className="text-slate-700">{dailyDecayBase}</strong></span>
              </div>
              <p className="text-[10px] text-slate-400">价格已自动设为 {priceStar} 星光值</p>
            </div>
          </>
        )}

        {/* 用品专属字段：名称 / 描述 */}
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

        {/* 用品恢复值（非狗屋用品） */}
        {type === 'supply' && subcategory !== 'doghouse' && (
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
  const { fileRef, imageUrl, setImageUrl, handleImageUpload, uploading: imgUploading } = useImageUpload(item.image_url || '', toast, item.family_id, 'shop');

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
  const [recoveryValue, setRecoveryValue] = useState<number>(item.recovery_value ?? 20);
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
        name: item.type === 'supply' ? name.trim() : name.trim() || null,
        emoji: imageUrl ? null : emoji,
        image_url: imageUrl || null,
        description: description.trim() || null,
        price_star: priceStar,
        breed: item.type === 'pet' ? breed.trim() || null : null,
        base_coin_per_day: item.type === 'pet' ? baseCoinPerDay : undefined,
        rarity: item.type === 'pet' ? rarity : undefined,
        gender: item.type === 'pet' ? gender : undefined,
        recovery_value: item.type === 'supply' ? recoveryValue : undefined,
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

        {/* 用品字段 */}
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

        {/* 用品恢复值（非狗屋用品） */}
        {item.type === 'supply' && subcategory !== 'doghouse' && (
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
        canvas.toBlob(
          (blob) => blob ? resolve(blob) : reject(new Error('压缩失败')),
          'image/jpeg',
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
      const data = await fetchBackgrounds(family.id);
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
      await createBackground(family!.id, name, url);
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
