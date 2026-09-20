import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFamilyStore } from '../../store/familyStore';
import { usePurchases } from '../../hooks/usePurchases';
import { Card } from '../../components/common/Card';
import { EmptyState } from '../../components/common/EmptyState';
import { Avatar } from '../../components/common/Avatar';
import { PURCHASE_STATUS_LABELS, ROUTES } from '../../lib/constants';
import { formatDate, isExpired, formatCoins } from '../../lib/utils';
import { ArrowLeft, Coins } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { PurchaseStatus } from '../../api/types';

type TabKey = 'pending' | 'redeemed' | 'sold' | 'all';

export function PurchaseRedeemPage() {
  const navigate = useNavigate();
  const members = useFamilyStore(s => s.members);
  const childMembers = members.filter(m => m.role === 'child');

  const { purchases, loading } = usePurchases();

  const [tab, setTab] = useState<TabKey>('pending');

  const filtered = useMemo(() => {
    return purchases.filter(p => {
      if (tab === 'pending') {
        return p.status === 'pending' && !(p.expires_at && isExpired(p.expires_at));
      }
      if (tab === 'redeemed') return p.status === 'redeemed';
      if (tab === 'sold') return p.status === 'sold';
      return true;
    });
  }, [purchases, tab]);

  const pendingCount = purchases.filter(p =>
    p.status === 'pending' && !(p.expires_at && isExpired(p.expires_at))
  ).length;

  const tabs: { key: TabKey; label: string; badge?: number }[] = [
    { key: 'pending', label: '待使用', badge: pendingCount },
    { key: 'redeemed', label: '已兑换' },
    { key: 'sold', label: '已出售' },
    { key: 'all', label: '全部' },
  ];

  const statusStyle = (status: PurchaseStatus, overdue: boolean) => cn(
    'text-xs px-2 py-1 rounded-full',
    status === 'redeemed' ? 'bg-slate-100 text-slate-400' :
    status === 'sold' ? 'bg-amber-50 text-amber-500' :
    overdue ? 'bg-red-50 text-red-500' :
    'bg-emerald-50 text-emerald-600'
  );

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate(ROUTES.PARENT)}
          className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-xl font-bold">特权记录</h1>
      </div>

      <p className="text-sm text-slate-400">
        孩子在背包中可自行兑换或出售特权卡，此处查看历史记录
      </p>

      {/* Tab */}
      <div className="flex gap-2 flex-wrap">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-all',
              tab === t.key ? 'bg-star-400 text-white' : 'bg-white text-slate-600 border border-star-100'
            )}
          >
            {t.label}
            {t.badge !== undefined && t.badge > 0 && (
              <span className={cn(
                'text-xs px-1.5 rounded-full',
                tab === t.key ? 'bg-white/30' : 'bg-star-50 text-star-600'
              )}>
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* 记录列表 */}
      {loading ? (
        <EmptyState icon="📜" title="加载中..." />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="📜"
          title={tab === 'pending' ? '没有待使用的特权' : '暂无记录'}
          description={tab === 'pending' ? '孩子兑换特权后这里会显示记录' : ''}
        />
      ) : (
        <div className="space-y-3">
          {filtered.map(p => {
            const child = childMembers.find(m => m.id === p.member_id);
            const overdue = p.expires_at && isExpired(p.expires_at);
            const totalPaid = p.price_paid * p.quantity;
            return (
              <Card key={p.id} className={cn('p-4', (p.status === 'redeemed' || p.status === 'sold') && 'opacity-70')}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-medium">{p.item_name_snapshot}</h3>
                      {p.quantity > 1 && <span className="text-xs text-slate-400">x{p.quantity}</span>}
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs text-slate-400">
                      <span className="flex items-center gap-1">
                        <Avatar emoji={child?.avatar_emoji} size="sm" />
                        {child?.name ?? '未知'}
                      </span>
                      <span>· 购买于 {formatDate(p.created_at)}</span>
                      {p.redeemed_at && <span>· {p.status === 'sold' ? '出售于' : '兑换于'} {formatDate(p.redeemed_at)}</span>}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                    <span className="font-bold text-amber-600 tabular-nums flex items-center gap-1">
                      <Coins className="w-4 h-4" />{formatCoins(totalPaid)}
                    </span>
                    <span className={statusStyle(p.status, !!overdue)}>
                      {overdue && p.status === 'pending' ? '已过期' : PURCHASE_STATUS_LABELS[p.status]}
                    </span>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
