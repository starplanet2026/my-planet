import { useState, useEffect } from 'react';
import { Modal } from '../../../../components/common/Modal';
import { Button } from '../../../../components/common/Button';
import { Input } from '../../../../components/common/Input';
import { EmptyState } from '../../../../components/common/EmptyState';
import { Loading } from '../../../../components/common/Loading';
import { useToastStore } from '../../../../store/toastStore';
import { useFamilyStore } from '../../../../store/familyStore';
import { cn } from '../../../../lib/utils';
import { Star, Coins } from 'lucide-react';
import {
  fetchPetShopItems,
  fetchPets,
  buyPetItem,
  updatePetInfo,
  buyDoghouseUpgrade,
} from '../../../../api/pets';
import type {
  PetShopItem,
  PetShopItemType,
  PetSubcategory,
  PetRarity,
  Pet,
} from '../../../../api/types';
import { TRAIT_DESC } from '../../../../api/types';

// 一级 tab：宠物 / 用品
const MAIN_TABS: { id: PetShopItemType; label: string }[] = [
  { id: 'pet', label: '宠物' },
  { id: 'supply', label: '用品' },
];

// 宠物子分类
const PET_SUBS: { id: PetSubcategory; label: string }[] = [
  { id: 'dog', label: '狗' },
  { id: 'cat', label: '猫' },
];

// 用品子分类（"全部"选项用 'all' 特殊值）
// 注：寄养(foster)不在用品栏展示，托管卡仅在托管板块内购买
const SUPPLY_SUBS: { id: string; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'food', label: '食品' },
  { id: 'clean', label: '清洁' },
  { id: 'toy', label: '玩具' },
  { id: 'medicine', label: '药品' },
  { id: 'doghouse', label: '住所' },
];

// 用品子分类 → 影响属性映射
const SUPPLY_EFFECT: Record<string, { icon: string; label: string; color: string; badgeCls: string }> = {
  food: { icon: '🍖', label: '食品', color: 'text-orange-600', badgeCls: 'bg-orange-100 text-orange-600' },
  clean: { icon: '🧴', label: '清洁', color: 'text-blue-600', badgeCls: 'bg-blue-100 text-blue-600' },
  toy: { icon: '🎾', label: '玩具', color: 'text-green-600', badgeCls: 'bg-green-100 text-green-600' },
  medicine: { icon: '💊', label: '药品', color: 'text-red-600', badgeCls: 'bg-red-100 text-red-600' },
  doghouse: { icon: '🏠', label: '住所', color: 'text-amber-600', badgeCls: 'bg-amber-100 text-amber-600' },
};

// 稀有度文案与配色
const RARITY_META: Record<PetRarity, { label: string; cls: string }> = {
  common: { label: '普通', cls: 'bg-slate-100 text-slate-500' },
  rare: { label: '稀有', cls: 'bg-blue-100 text-blue-600' },
  epic: { label: '史诗', cls: 'bg-purple-100 text-purple-600' },
};

// 商品图标：优先 image_url，否则 emoji，再否则占位
function ItemIcon({ item, size }: { item: PetShopItem; size: 'sm' | 'lg' }) {
  // 统一 3:4 竖版比例
  const boxCls = size === 'lg' ? 'w-[120px] h-[160px] text-7xl' : 'w-[48px] h-[64px] text-3xl';
  if (item.image_url) {
    return (
      <img
        src={item.image_url}
        alt={item.name ?? ''}
        className={cn(boxCls, 'object-cover rounded-2xl mx-auto')}
      />
    );
  }
  return (
    <div
      className={cn(
        boxCls,
        'flex items-center justify-center mx-auto rounded-2xl bg-gradient-to-br from-amber-50 to-star-50'
      )}
    >
      <span>{item.emoji || (item.type === 'pet' ? '🐾' : '🎁')}</span>
    </div>
  );
}

// 价格徽章：星光值用 Star，金币用 Coins，两者皆无则免费
function PriceBadge({ item, big }: { item: PetShopItem; big?: boolean }) {
  const iconCls = big ? 'w-4 h-4' : 'w-3.5 h-3.5';
  const textCls = big ? 'text-base' : 'text-sm';
  return (
    <div className="flex items-center gap-2 flex-wrap justify-center">
      {item.price_star > 0 && (
        <span className={cn('inline-flex items-center gap-1 font-bold text-amber-500', textCls)}>
          <Star className={cn(iconCls, 'fill-amber-400 text-amber-400')} />
          {item.price_star}
        </span>
      )}
      {item.price_star === 0 && (
        <span className="text-sm font-bold text-emerald-500">免费</span>
      )}
    </div>
  );
}

export function PetShopModal({
  familyId,
  childId,
  isInline,
  onClose,
  onBought,
  dogHouseLevel = 0,
  jumpDoghouse = false,
  onJumpDone,
}: {
  familyId: string;
  childId: string;
  isInline?: boolean; // true=内嵌渲染 false=弹窗
  onClose?: () => void;
  onBought: () => void;
  dogHouseLevel?: number;
  jumpDoghouse?: boolean;
  onJumpDone?: () => void;
}) {
  const toast = useToastStore();
  const refreshMembers = useFamilyStore(s => s.refreshMembers);

  const [activeMain, setActiveMain] = useState<PetShopItemType>(jumpDoghouse ? 'supply' : 'pet');
  const [activeSub, setActiveSub] = useState<PetSubcategory>(jumpDoghouse ? 'doghouse' : 'dog');
  const [items, setItems] = useState<PetShopItem[]>([]);
  const [ownedPets, setOwnedPets] = useState<Pet[]>([]);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<PetShopItem | null>(null);
  const [buying, setBuying] = useState(false);
  // 各用品卡片内联数量输入框：itemId -> 数量
  const [qtyMap, setQtyMap] = useState<Record<string, number>>({});
  // 各用品卡片单独购买中状态
  const [buyingItem, setBuyingItem] = useState<string | null>(null);
  // 命名弹窗：购买宠物成功后弹出（只起名，不选性别）
  const [naming, setNaming] = useState<{
    petId: string;
    name: string;
  } | null>(null);
  const [savingName, setSavingName] = useState(false);

  // 切换主 tab 时重置子分类到首个
  const switchMain = (main: PetShopItemType) => {
    setActiveMain(main);
    setActiveSub(main === 'pet' ? 'dog' : 'all');
  };

  // 加载商品列表 + 已领养宠物
  const loadItems = async () => {
    if (!familyId) return;
    setLoading(true);
    try {
      // "全部" 时传 undefined 加载所有
      const fetchSub = activeSub === 'all' ? undefined : activeSub as PetSubcategory;
      const [data, myPets] = await Promise.all([
        fetchPetShopItems(activeMain, fetchSub),
        fetchPets(childId),
      ]);
      // 寄养(foster)商品不在用品栏展示，托管卡仅在托管板块内购买
      setItems(data.filter(i => i.subcategory !== 'foster'));
      setOwnedPets(myPets);
    } catch (e: any) {
      toast.error(e?.message ?? '加载商品失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familyId, activeMain, activeSub, childId]);

  // 是否已领养某宠物商品
  const isOwned = (itemId: string) =>
    ownedPets.some(p => p.shop_item_id === itemId);

  // 购买商品
  const handleBuy = async (item: PetShopItem) => {
    if (buying) return;
    setBuying(true);
    try {
      // 住所：直接消费升级容量，不进背包
      if (item.type === 'supply' && item.subcategory === 'doghouse') {
        const result = await buyDoghouseUpgrade(childId, item.id);
        if (!result.success) {
          toast.error(result.message || '升级失败');
          return;
        }
        await refreshMembers();
        loadItems();
        toast.success(result.message || '狗窝扩容成功');
        setDetail(null);
        onBought();
        return;
      }

      // 寄养商品不在用品栏出售，托管卡请前往托管板块购买
      if (item.subcategory === 'foster') {
        toast.warning('托管卡请前往托管板块购买');
        return;
      }

      const result = await buyPetItem(childId, item.id);
      if (!result.success) {
        const msg = result.message || '购买失败';
        if (msg.includes('茅草屋') || msg.includes('狗屋') || msg.includes('住所')) {
          toast.error(msg);
          setActiveMain('supply');
          setActiveSub('doghouse');
          setDetail(null);
        } else {
          toast.error(msg);
        }
        return;
      }
      // 刷新星光/金币余额
      await refreshMembers();
      // 刷新本组件商品库存
      loadItems();

      if (item.type === 'pet' && result.pet_id) {
        // 宠物：关闭详情，弹出命名弹窗（只起名）
        setDetail(null);
        setNaming({
          petId: result.pet_id,
          name: '',
        });
      } else {
        // 用品：存入背包
        toast.success('已存入背包');
        setDetail(null);
        onBought();
      }
    } catch (e: any) {
      toast.error(e?.message ?? '购买失败');
    } finally {
      setBuying(false);
    }
  };

  // 内联购买用品（卡片外层直接购买，支持数量）
  const handleInlineBuy = async (item: PetShopItem, qty: number) => {
    if (buyingItem || qty < 1) return;
    setBuyingItem(item.id);
    try {
      let lastErr: any = null;
      let successCount = 0;
      let lastMsg: string | undefined;
      for (let i = 0; i < qty; i++) {
        const r = await buyPetItem(childId, item.id);
        if (r.success) {
          successCount++;
        } else {
          lastMsg = r.message;
          lastErr = new Error(r.message || '购买失败');
          break;
        }
      }
      if (successCount > 0) {
        await refreshMembers();
        loadItems();
        toast.success(`已购买 ${successCount} 件，存入背包`);
        setQtyMap(prev => ({ ...prev, [item.id]: 1 }));
        onBought();
      }
      if (lastErr) {
        toast.error(lastMsg ?? '部分购买失败');
      }
    } catch (e: any) {
      toast.error(e?.message ?? '购买失败');
    } finally {
      setBuyingItem(null);
    }
  };

  // 提交命名与性别
  const handleNamingSubmit = async () => {
    if (!naming) return;
    const name = naming.name.trim();
    if (!name) {
      toast.warning('请给宠物起个名字');
      return;
    }
    setSavingName(true);
    try {
      // gender 已在购买时从商品写入宠物，这里只更新名字
      await updatePetInfo(naming.petId, childId, name, null);
      toast.success('领养成功，好好照顾它吧！');
      setNaming(null);
      onBought();
    } catch (e: any) {
      toast.error(e?.message ?? '命名失败');
    } finally {
      setSavingName(false);
    }
  };

  // 主体内容
  const content = (
    <div className="space-y-4">
      {/* 主 tab：宠物 / 用品 */}
      <div className="flex gap-2">
        {MAIN_TABS.map(t => (
          <button
            key={t.id}
            onClick={() => switchMain(t.id)}
            className={cn(
              'flex-1 py-2 rounded-xl text-sm font-medium transition-colors',
              activeMain === t.id
                ? 'bg-star-400 text-white shadow-sm'
                : 'bg-star-50 text-slate-600 hover:bg-star-100'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 子分类 tab：筛选 */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {(activeMain === 'pet' ? PET_SUBS : SUPPLY_SUBS).map(s => (
          <button
            key={s.id}
            onClick={() => setActiveSub(s.id)}
            className={cn(
              'px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors',
              activeSub === s.id
                ? 'bg-amber-400 text-white shadow-sm'
                : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
            )}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* 商品列表 */}
      {loading ? (
        <Loading text="加载商品中..." />
      ) : items.length === 0 ? (
        <EmptyState
          icon="🏪"
          title="暂无商品"
          description="家长还未上架此分类商品"
        />
      ) : activeMain === 'supply' ? (
        /* 用品 tab：全部用品一行三个排列，不分组 */
        <div className="grid grid-cols-3 gap-3">
          {items.map(item => {
            const soldOut = item.stock !== null && item.stock <= 0;
            const isDoghouse = item.subcategory === 'doghouse';
            const doghouseOwned = isDoghouse && dogHouseLevel >= (item.doghouse_level ?? 0);
            const inlineBuy = !isDoghouse;
            const qty = qtyMap[item.id] ?? 1;
            const effect = item.subcategory ? SUPPLY_EFFECT[item.subcategory] : null;
            const recovery = item.recovery_value ?? 0;
            // 住所容量描述
            const doghouseCapacity = isDoghouse
              ? (item.doghouse_level === 1 ? '容纳1只小狗'
                 : item.doghouse_level === 2 ? '容纳5只小狗'
                 : item.doghouse_level === 3 ? '容纳10只小狗'
                 : '')
              : '';
            const cardCls = cn(
              'flex flex-col items-center gap-1 p-2 rounded-2xl border-2 transition-all text-center relative',
              soldOut
                ? 'border-slate-100 bg-slate-50 opacity-60 cursor-not-allowed'
                : 'border-star-100 bg-white hover:border-amber-300 hover:shadow-md hover:scale-[1.02] active:scale-[0.98]'
            );
            // 用品内联卡片（非住所）
            if (inlineBuy) {
              return (
                <div key={item.id} className={cardCls}>
                  {/* 左上角分类标签 */}
                  {effect && (
                    <span className={cn('absolute top-1 left-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold', effect.badgeCls)}>
                      {effect.label}
                    </span>
                  )}
                  <div className="mt-3">
                    <ItemIcon item={item} size="sm" />
                  </div>
                  <div className="font-medium text-sm text-slate-700 line-clamp-1 w-full">
                    {item.name || '未命名'}
                  </div>
                  {/* 价格 + 恢复值放一行 */}
                  <div className="w-full flex items-center justify-center gap-2 text-[10px]">
                    <PriceBadge item={item} />
                    {effect && recovery > 0 && (
                      <span className={`font-bold ${effect.color}`}>
                        +{recovery}
                      </span>
                    )}
                  </div>
                  {soldOut ? (
                    <span className="text-[10px] text-slate-400">已售罄</span>
                  ) : (
                    <div className="w-full flex items-center gap-1">
                      <input
                        type="number"
                        min={1}
                        value={qty}
                        onChange={e => {
                          const v = parseInt(e.target.value, 10);
                          setQtyMap(prev => ({ ...prev, [item.id]: Number.isNaN(v) || v < 1 ? 1 : v }));
                        }}
                        disabled={buyingItem === item.id}
                        className="w-12 text-center text-sm font-bold rounded-md border border-star-200 px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-star-300"
                      />
                      <button
                        onClick={() => handleInlineBuy(item, qty)}
                        disabled={buyingItem === item.id}
                        className="flex-1 py-1 rounded-md bg-star-400 text-white text-xs font-bold hover:bg-star-500 active:scale-95 transition-colors disabled:opacity-50"
                      >
                        {buyingItem === item.id ? '购买中…' : '购买'}
                      </button>
                    </div>
                  )}
                </div>
              );
            }
            // 住所：外层直接购买
            return (
              <div key={item.id} className={cardCls}>
                {/* 左上角分类标签 */}
                {effect && (
                  <span className={cn('absolute top-1 left-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold', effect.badgeCls)}>
                    {effect.label}
                  </span>
                )}
                <div className="mt-3">
                  <ItemIcon item={item} size="sm" />
                </div>
                <div className="font-medium text-sm text-slate-700 line-clamp-1 w-full">
                  {item.name || '未命名'}
                </div>
                {/* 价格 + 容量描述放一行 */}
                <div className="w-full flex items-center justify-center gap-2 text-[10px]">
                  <PriceBadge item={item} />
                  {doghouseCapacity && (
                    <span className={`font-bold ${effect?.color ?? 'text-amber-600'}`}>
                      {doghouseCapacity}
                    </span>
                  )}
                </div>
                {soldOut ? (
                  <span className="text-[10px] text-slate-400">已售罄</span>
                ) : doghouseOwned ? (
                  <span className="w-full py-1 rounded-md bg-green-100 text-green-600 text-xs font-bold text-center">已拥有</span>
                ) : (
                  <button
                    onClick={() => handleBuy(item)}
                    disabled={buyingItem === item.id}
                    className="w-full py-1 rounded-md bg-amber-400 text-white text-xs font-bold hover:bg-amber-500 active:scale-95 transition-colors disabled:opacity-50"
                  >
                    {buyingItem === item.id ? '购买中…' : '购买'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        /* 宠物 tab：按子分类筛选展示 */
        <div className="grid grid-cols-3 gap-3">
          {items.map(item => {
            const soldOut = item.stock !== null && item.stock <= 0;
            const owned = item.type === 'pet' && isOwned(item.id);
            const disabled = soldOut;
            const cardCls = cn(
              'flex flex-col items-center gap-1.5 p-3 rounded-2xl border-2 transition-all text-center relative',
              disabled
                ? 'border-slate-100 bg-slate-50 opacity-60 cursor-not-allowed'
                : owned
                ? 'border-emerald-200 bg-emerald-50/40 hover:border-emerald-300 hover:shadow-md active:scale-[0.98]'
                : 'border-star-100 bg-white hover:border-amber-300 hover:shadow-md hover:scale-[1.02] active:scale-[0.98]'
            );
            return (
              <button
                key={item.id}
                onClick={() => setDetail(item)}
                disabled={disabled}
                className={cardCls}
              >
                {/* 宠物稀有度徽章 - 左上角 */}
                {item.type === 'pet' && (
                  <span
                    className={cn(
                      'absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold',
                      RARITY_META[item.rarity].cls
                    )}
                  >
                    {RARITY_META[item.rarity].label}
                  </span>
                )}
                {owned && (
                  <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded-full bg-emerald-500 text-white text-[10px] font-bold">
                    已领养
                  </span>
                )}
                <ItemIcon item={item} size="sm" />
                <div className="font-medium text-sm text-slate-700 line-clamp-1 w-full">
                  {item.name || '未命名'}
                </div>
                <div className="w-full space-y-0.5">
                  <div className="text-[10px] text-amber-500 font-medium">
                    ⭐ {item.price_star} 星光值
                  </div>
                  <div className="text-[10px] text-yellow-600 font-medium">
                    💰 {item.base_coin_per_day}/天
                  </div>
                  {item.trait && (
                    <div className="text-[10px] text-purple-500 font-medium">
                      🌟 {item.trait}
                    </div>
                  )}
                </div>
                {soldOut && !owned && (
                  <span className="text-[10px] text-slate-400">已售罄</span>
                )}
              </button>
            );
          })}

          {/* 锁定预告卡：仅宠物列表末尾显示 */}
          <div
            className={cn(
              'flex flex-col items-center justify-center gap-2 p-3 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/60 text-center',
              'opacity-70 select-none'
            )}
            aria-disabled="true"
          >
            <div className="text-3xl">🔒</div>
            <p className="text-[11px] font-medium text-slate-500 leading-tight">
              限时领养满 2 只宠物后解锁更多萌宠
            </p>
            <p className="text-[10px] text-slate-400">
              当前: {Math.min(ownedPets.length, 2)}/2
            </p>
          </div>
        </div>
      )}

      {/* 商品详情弹窗 */}
      <Modal
        open={!!detail}
        onClose={() => !buying && setDetail(null)}
        title={detail?.name ?? '商品详情'}
        size="sm"
      >
        {detail && (() => {
          const owned = detail.type === 'pet' && isOwned(detail.id);
          const soldOut = detail.stock !== null && detail.stock <= 0;
          const disabled = owned || soldOut;
          return (
            <div className="space-y-4">
              {/* 大图 */}
              <div className="flex justify-center">
                <ItemIcon item={detail} size="lg" />
              </div>

              {/* 稀有度 / 性别 / 特质 */}
              <div className="flex items-center justify-center gap-2 flex-wrap">
                {detail.type === 'pet' && (
                  <span
                    className={cn(
                      'px-2 py-0.5 rounded-full text-xs font-medium',
                      RARITY_META[detail.rarity].cls
                    )}
                  >
                    {RARITY_META[detail.rarity].label}
                  </span>
                )}
                {detail.gender && (
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
                    {detail.gender === 'male' ? '♂ 公' : '♀ 母'}
                  </span>
                )}
                {detail.type === 'pet' && detail.trait && (
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-purple-50 text-purple-600">
                    🌟 {detail.trait}
                  </span>
                )}
                {owned && (
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-600">
                    已领养
                  </span>
                )}
              </div>

              {/* 描述 */}
              {detail.description ? (
                <p className="text-sm text-slate-500 text-center">{detail.description}</p>
              ) : (
                <p className="text-sm text-slate-400 text-center italic">暂无介绍</p>
              )}

              {/* 宠物属性面板 */}
              {detail.type === 'pet' && (
                <div className="grid grid-cols-2 gap-2 p-3 rounded-lg bg-yellow-50">
                  <div className="flex items-center gap-1.5">
                    <Coins className="w-4 h-4 text-yellow-600" />
                    <span className="text-xs text-slate-500">日产金</span>
                    <span className="text-sm font-bold text-yellow-600">{detail.base_coin_per_day}</span>
                    <span className="text-[10px] text-slate-400">/天</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-slate-500">满级</span>
                    <span className="text-sm font-bold text-slate-700">Lv.{detail.max_level}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-slate-500">升级奖励</span>
                    <span className="text-sm font-bold text-slate-700">等级×1.25</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-slate-500">特质效果</span>
                    <span className="text-xs font-bold text-purple-600">
                      {detail.trait ? (TRAIT_DESC[detail.trait] || '无') : '无'}
                    </span>
                  </div>
                </div>
              )}

              {/* 价格 */}
              <div className="flex items-center justify-center bg-amber-50 rounded-xl py-2.5">
                <PriceBadge item={detail} big />
              </div>

              {/* 库存提示 */}
              {detail.stock !== null && detail.stock <= 5 && detail.stock > 0 && !owned && (
                <p className="text-center text-xs text-red-400">仅剩 {detail.stock} 件</p>
              )}

              {/* 购买按钮 */}
              <Button
                fullWidth
                loading={buying}
                disabled={disabled}
                onClick={() => handleBuy(detail)}
              >
                {owned
                  ? '已领养'
                  : soldOut
                  ? '已售罄'
                  : detail.type === 'pet'
                  ? '领养'
                  : detail.subcategory === 'doghouse'
                  ? '购买并扩容'
                  : '购买'}
              </Button>
            </div>
          );
        })()}
      </Modal>

      {/* 命名弹窗 */}
      <Modal
        open={!!naming}
        onClose={() => !savingName && setNaming(null)}
        title="给宠物起个名字"
        size="sm"
      >
        {naming && (
          <div className="space-y-4">
            <div className="text-center text-5xl">🐾</div>
            <p className="text-xs text-slate-400 text-center">性别由商品设定，请给宠物起个名字</p>
            <Input
              label="名字"
              placeholder="例如：小白、糖糖"
              value={naming.name}
              maxLength={12}
              onChange={e =>
                setNaming(n => (n ? { ...n, name: e.target.value } : n))
              }
            />
            <div className="flex gap-2">
              <Button
                className="flex-1"
                loading={savingName}
                onClick={handleNamingSubmit}
              >
                起名成功
              </Button>
              <Button
                variant="ghost"
                className="flex-1"
                disabled={savingName}
                onClick={() => { setNaming(null); onBought(); }}
              >
                稍后再起
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );

  // 内嵌模式直接渲染；弹窗模式用 Modal 包裹
  if (isInline) {
    return content;
  }

  return (
    <Modal open onClose={() => onClose?.()} title="萌宠商店" size="lg">
      {content}
    </Modal>
  );
}
