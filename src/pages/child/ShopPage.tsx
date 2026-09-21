import { useState, useMemo } from 'react';
import { useFamilyStore } from '../../store/familyStore';
import { useModeStore } from '../../store/modeStore';
import { useItems } from '../../hooks/useItems';
import { usePurchases } from '../../hooks/usePurchases';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Modal } from '../../components/common/Modal';
import { EmptyState } from '../../components/common/EmptyState';
import { Loading } from '../../components/common/Loading';
import { useToastStore } from '../../store/toastStore';
import { formatCoins, formatDate, isExpired } from '../../lib/utils';
import { COIN_ICON_SM } from '../../lib/constants';
import { cn } from '../../lib/utils';
import type { Item } from '../../api/types';

// 特权卡装饰星星（SVG）
function CardStar({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className}>
      <path
        d="M50 8 L61 38 L93 38 L67 57 L77 88 L50 69 L23 88 L33 57 L7 38 L39 38 Z"
        fill="currentColor"
        opacity="0.15"
      />
    </svg>
  );
}

// 金币徽章（用金币图标，无白底）
function CoinBadge({ price, className }: { price: number; className?: string }) {
  return (
    <div className={cn('inline-flex items-center gap-1 font-bold text-sm text-amber-600', className)}>
      <img src={COIN_ICON_SM} alt="金币" className="w-4 h-4 object-contain" />
      {formatCoins(price)}
    </div>
  );
}

// 分类对应的颜色
const CATEGORY_COLORS: Record<string, string> = {
  '美食': '#f97316', // 橙色
  '放松': '#3b82f6', // 蓝色
  '玩乐': '#22c55e', // 绿色
  '稀有': '#a855f7', // 紫色
};

// 特权卡组件
function PrivilegeCard({ item, onClick, disabled }: { item: Item; onClick?: () => void; disabled?: boolean }) {
  const soldOut = item.stock !== null && item.stock <= 0;
  const expired = item.expires_at && isExpired(item.expires_at);
  const unAvailable = soldOut || !!expired;
  const categoryColor = item.category ? (CATEGORY_COLORS[item.category] ?? '#a855f7') : '#a855f7';

  return (
    <div
      onClick={unAvailable ? undefined : onClick}
      className={cn(
        'relative rounded-2xl overflow-hidden border-2 transition-all',
        'bg-gradient-to-br from-star-50 via-amber-50 to-star-100 border-star-200',
        unAvailable ? 'opacity-50 grayscale' : 'cursor-pointer hover:shadow-lg hover:scale-[1.02] active:scale-[0.98]',
      )}
    >
      {/* 装饰星星 */}
      <CardStar className="absolute -top-2 -right-2 w-16 h-16 text-amber-300" />
      <CardStar className="absolute -bottom-3 -left-3 w-12 h-12 text-amber-300" />

      {/* 图片区 */}
      <div className="aspect-[4/3] flex items-center justify-center relative">
        {item.image_url ? (
          <img src={item.image_url} alt={item.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <div className="relative">
              <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-gradient-to-br from-amber-200 to-star-300 flex items-center justify-center shadow-inner">
                <span className="text-3xl sm:text-4xl">🎁</span>
              </div>
            </div>
          </div>
        )}
        {/* 分类标签 */}
        {item.category && (
          <div
            className="absolute top-2 left-2 px-2 py-0.5 rounded-full text-white text-[10px] font-bold shadow"
            style={{ background: categoryColor }}
          >
            {item.category}
          </div>
        )}
        {item.weekly_limit && (
          <div className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-white/80 text-star-600 text-[10px] font-medium">
            使用上限{item.weekly_limit}/周
          </div>
        )}
      </div>

      {/* 信息区 */}
      <div className="p-2.5 sm:p-3 relative">
        <h3 className="font-bold text-slate-800 text-sm sm:text-base line-clamp-1 mb-0.5">{item.name}</h3>
        {item.description && (
          <p className="text-[11px] sm:text-xs text-slate-500 line-clamp-3 mb-2">{item.description}</p>
        )}
        <div className="flex items-center justify-between">
          <CoinBadge price={item.price} />
          {unAvailable ? (
            <span className="text-xs text-slate-400 font-medium">
              {soldOut ? '售罄' : '已下架'}
            </span>
          ) : (
            <span className="text-xs font-bold text-star-600 bg-white/60 px-2 py-1 rounded-full">
              兑换
            </span>
          )}
        </div>
        {item.stock !== null && item.stock <= 5 && !soldOut && (
          <p className="text-[10px] text-red-400 mt-1">仅剩 {item.stock} 件</p>
        )}
      </div>
    </div>
  );
}

export function ShopPage() {
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [purchasing, setPurchasing] = useState(false);
  const [activeCat, setActiveCat] = useState<string>('全部');

  const members = useFamilyStore(s => s.members);
  const refreshMembers = useFamilyStore(s => s.refreshMembers);
  const currentChildId = useModeStore(s => s.currentChildId);
  const child = members.find(m => m.id === currentChildId && m.role === 'child')
    ?? members.find(m => m.role === 'child');

  const { items, loading } = useItems(true);
  const { purchaseItem } = usePurchases();
  const toast = useToastStore();

  const availableItems = items.filter(i =>
    i.status === 'active' && (!i.expires_at || !isExpired(i.expires_at))
  );

  // 分类列表（稀有放最后）
  const categories = useMemo(() => {
    const cats = Array.from(new Set(availableItems.map(i => i.category).filter(Boolean))) as string[];
    const sorted = cats.sort((a, b) => {
      if (a === '稀有') return 1;
      if (b === '稀有') return -1;
      return 0;
    });
    return ['全部', ...sorted];
  }, [availableItems]);

  const filteredItems = activeCat === '全部'
    ? availableItems
    : availableItems.filter(i => i.category === activeCat);

  const balance = child?.coin_balance ?? 0;

  const openModal = (item: Item) => {
    setSelectedItem(item);
    setQuantity(1);
  };

  const handlePurchase = async () => {
    if (!selectedItem || !child) return;
    setPurchasing(true);
    try {
      await purchaseItem(selectedItem.id, child.id, quantity);
      await refreshMembers();
      toast.success('兑换成功！已存入背包');
      setSelectedItem(null);
    } catch (e: any) {
      toast.error(e?.message ?? '兑换失败');
    } finally {
      setPurchasing(false);
    }
  };

  if (loading && items.length === 0) return <Loading />;

  const totalCost = selectedItem ? selectedItem.price * quantity : 0;
  const canAfford = balance >= totalCost;

  return (
    <div className="max-w-6xl mx-auto -mt-6">
      {/* 分类筛选栏 */}
      {categories.length > 1 && (
        <div className="sticky top-16 z-20 bg-white/80 backdrop-blur-sm border-b border-star-100 shadow-sm mb-4 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-2">
          <div className="flex gap-2 overflow-x-auto">
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setActiveCat(cat)}
                className={cn(
                  'px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors',
                  activeCat === cat
                    ? 'bg-star-400 text-white shadow-sm'
                    : 'bg-star-50 text-slate-600 hover:bg-star-100'
                )}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>
      )}

      {filteredItems.length === 0 ? (
        <EmptyState
          icon="🎴"
          title="暂无特权卡"
          description="家长还没上架特权哦"
        />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 sm:gap-4">
          {filteredItems.map(item => (
            <PrivilegeCard
              key={item.id}
              item={item}
              onClick={() => openModal(item)}
            />
          ))}
        </div>
      )}

      {/* 兑换确认弹层 */}
      <Modal
        open={!!selectedItem}
        onClose={() => !purchasing && setSelectedItem(null)}
        title="确认兑换"
        size="sm"
      >
        {selectedItem && (
          <div className="space-y-4">
            {/* 特权卡预览 */}
            <div className="text-center">
              <div className="inline-block relative rounded-2xl overflow-hidden border-2 border-star-200 bg-gradient-to-br from-star-50 to-amber-50 p-4 w-40">
                <CardStar className="absolute -top-1 -right-1 w-10 h-10 text-amber-300" />
                {selectedItem.image_url ? (
                  <img src={selectedItem.image_url} alt={selectedItem.name} className="w-24 h-24 mx-auto rounded-xl object-cover" />
                ) : (
                  <div className="w-24 h-24 mx-auto rounded-full bg-gradient-to-br from-amber-200 to-star-300 flex items-center justify-center">
                    <span className="text-4xl">🎁</span>
                  </div>
                )}
                <h3 className="font-bold text-slate-800 text-sm mt-2">{selectedItem.name}</h3>
              </div>
            </div>

            {selectedItem.description && (
              <p className="text-sm text-slate-500 text-center">{selectedItem.description}</p>
            )}

            {/* 数量选择（手动输入） */}
            <div className="flex items-center justify-between bg-star-50 rounded-xl px-4 py-3">
              <span className="text-slate-600 font-medium">兑换数量</span>
              <input
                type="number"
                min={1}
                value={quantity}
                onChange={e => {
                  const v = parseInt(e.target.value, 10);
                  setQuantity(Number.isNaN(v) || v < 1 ? 1 : v);
                }}
                disabled={purchasing}
                className="w-20 text-center text-lg font-bold tabular-nums rounded-lg border border-star-200 px-2 py-1 focus:outline-none focus:ring-2 focus:ring-star-300"
              />
            </div>

            {/* 总价 */}
            <div className="flex items-center justify-between bg-amber-50 rounded-xl px-4 py-3 border border-amber-100">
              <span className="text-slate-600 font-medium">合计</span>
              <span className="flex items-center gap-1.5 font-bold text-amber-600 text-lg">
                <img src={COIN_ICON_SM} alt="金币" className="w-5 h-5 object-contain" />
                {formatCoins(totalCost)}
              </span>
            </div>

            <div className="flex gap-3">
              <Button
                variant="secondary"
                fullWidth
                onClick={() => setSelectedItem(null)}
                disabled={purchasing}
              >
                取消
              </Button>
              <Button
                fullWidth
                loading={purchasing}
                disabled={!canAfford}
                onClick={handlePurchase}
                className={cn(canAfford ? 'bg-star-400 hover:bg-star-500 active:bg-star-600 text-white' : '')}
              >
                {canAfford ? '确认兑换' : '金币不足'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
