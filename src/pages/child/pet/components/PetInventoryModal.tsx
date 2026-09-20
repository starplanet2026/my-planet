import { useState, useEffect } from 'react';
import { Modal } from '../../../../components/common/Modal';
import { EmptyState } from '../../../../components/common/EmptyState';
import { Loading } from '../../../../components/common/Loading';
import { useToastStore } from '../../../../store/toastStore';
import { cn } from '../../../../lib/utils';
import { fetchPetInventory } from '../../../../api/pets';
import type { PetInventory, PetSubcategory } from '../../../../api/types';

// 分组标签
const SUB_LABEL: Record<string, string> = {
  food: '食品',
  clean: '清洁',
  toy: '玩具',
  medicine: '药品',
  foster: '寄养',
};

// 分组顺序
const SUB_ORDER: PetSubcategory[] = ['food', 'clean', 'toy', 'medicine', 'foster'];

// 单个物品卡片：图标 + 名字 + 数量
function InventoryItemCard({ item }: { item: PetInventory }) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-1 p-2 rounded-xl border bg-white',
        'border-star-100 hover:border-amber-200 transition-colors'
      )}
    >
      <div className="w-[48px] h-[64px] flex items-center justify-center rounded-lg overflow-hidden bg-gradient-to-br from-amber-50 to-star-50">
        {item.item_image_url ? (
          <img
            src={item.item_image_url}
            alt={item.item_name_snapshot}
            className="w-full h-full object-cover"
          />
        ) : (
          <span className="text-2xl">{item.item_emoji || '🎁'}</span>
        )}
      </div>
      <div className="text-xs font-medium text-slate-700 line-clamp-1 w-full text-center">
        {item.item_name_snapshot || '未命名'}
      </div>
      <div className="text-[10px] font-bold text-amber-600">x{item.quantity}</div>
    </div>
  );
}

export function PetInventoryModal({
  memberId,
  isInline,
  onClose,
}: {
  memberId: string;
  isInline?: boolean; // true=内嵌渲染 false=弹窗
  onClose?: () => void;
  // 暂无使用按钮，onUsed 预留接口
  onUsed?: () => void;
}) {
  const toast = useToastStore();
  const [items, setItems] = useState<PetInventory[]>([]);
  const [loading, setLoading] = useState(false);

  // 加载背包
  const load = async () => {
    if (!memberId) return;
    setLoading(true);
    try {
      const data = await fetchPetInventory(memberId);
      setItems(data);
    } catch (e: any) {
      toast.error(e?.message ?? '加载背包失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId]);

  // 按子分类分组，仅展示有库存的分组
  const grouped = SUB_ORDER.map(sub => ({
    sub,
    label: SUB_LABEL[sub],
    items: items.filter(i => i.subcategory === sub && i.quantity > 0),
  })).filter(g => g.items.length > 0);

  // 主体内容
  const content = (
    <div className="space-y-4">
      {loading ? (
        <Loading text="加载背包中..." />
      ) : grouped.length === 0 ? (
        <EmptyState
          icon="🎒"
          title="背包空空如也"
          description="快去商店购买吧"
        />
      ) : (
        grouped.map(g => (
          <div key={g.sub} className="space-y-2">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-semibold text-slate-700">{g.label}</h4>
              <span className="text-xs text-slate-400">({g.items.length})</span>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {g.items.map(item => (
                <InventoryItemCard key={item.id} item={item} />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );

  // 内嵌模式直接渲染；弹窗模式用 Modal 包裹
  if (isInline) {
    return content;
  }

  return (
    <Modal open onClose={() => onClose?.()} title="我的背包" size="md">
      {content}
    </Modal>
  );
}
