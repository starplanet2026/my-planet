import { useState, useMemo, useRef, useCallback } from 'react';
import { useFamilyStore } from '../../store/familyStore';
import { useModeStore } from '../../store/modeStore';
import { useCoinRecords } from '../../hooks/useCoinRecords';
import { usePurchases } from '../../hooks/usePurchases';
import { updateMember } from '../../api/members';
import { fetchAssetLogs, clearAssetLogs, type BalanceType } from '../../api/coins';
import { replyMessage } from '../../api/coins';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Input, Textarea } from '../../components/common/Input';
import { Loading } from '../../components/common/Loading';
import { Modal } from '../../components/common/Modal';
import { EmptyState } from '../../components/common/EmptyState';
import { useToastStore } from '../../store/toastStore';
import { formatCoins, formatDate, isExpired, timeAgo } from '../../lib/utils';
import { MessageSquare, ChevronDown, Pencil, CornerDownRight, Upload, Trash2 } from 'lucide-react';
import { CHILD_EMOJIS, PURCHASE_STATUS_LABELS, COIN_ICON_SM, STAR_ICON_SM } from '../../lib/constants';
import { cn } from '../../lib/utils';
import type { CoinRecord, Purchase } from '../../api/types';

// 特权卡装饰星星
function CardStar({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className}>
      <path d="M50 8 L61 38 L93 38 L67 57 L77 88 L50 69 L23 88 L33 57 L7 38 L39 38 Z"
        fill="currentColor" opacity="0.15" />
    </svg>
  );
}

export function ProfilePage() {
  const members = useFamilyStore(s => s.members);
  const currentChildId = useModeStore(s => s.currentChildId);
  const updateMemberStore = useFamilyStore(s => s.updateMember);
  const refreshMembers = useFamilyStore(s => s.refreshMembers);
  const toast = useToastStore();
  const child = members.find(m => m.id === currentChildId && m.role === 'child')
    ?? members.find(m => m.role === 'child');

  const { refresh: refreshRecords } = useCoinRecords();
  const { purchases, loading: purchasesLoading, redeemPurchase, sellPurchase } = usePurchases();

  // 资产明细日志：星光 / 金币 切换 + 分页
  const [assetTab, setAssetTab] = useState<BalanceType>('coin');
  const [assetLogs, setAssetLogs] = useState<CoinRecord[]>([]);
  const [assetLogsLoading, setAssetLogsLoading] = useState(false);
  const [assetLoadingMore, setAssetLoadingMore] = useState(false);
  const [assetOffset, setAssetOffset] = useState(0);
  const [hasMoreAsset, setHasMoreAsset] = useState(true);
  const ASSET_PAGE_SIZE = 20;

  const loadAssetLogs = useCallback(async (tab: BalanceType, offset = 0) => {
    if (!child) return;
    const isFirst = offset === 0;
    if (isFirst) setAssetLogsLoading(true); else setAssetLoadingMore(true);
    try {
      const data = await fetchAssetLogs(child.id, tab, ASSET_PAGE_SIZE, offset);
      if (offset === 0) {
        setAssetLogs(data);
      } else {
        setAssetLogs(prev => [...prev, ...data]);
      }
      setAssetOffset(offset + data.length);
      setHasMoreAsset(data.length >= ASSET_PAGE_SIZE);
    } catch {
      if (offset === 0) setAssetLogs([]);
      setHasMoreAsset(false);
    } finally {
      setAssetLogsLoading(false);
      setAssetLoadingMore(false);
    }
  }, [child?.id]);

  const handleClearAssetLogs = async () => {
    if (!child) return;
    try {
      await clearAssetLogs(child.id, assetTab);
      setAssetLogs([]);
      setAssetOffset(0);
      setHasMoreAsset(false);
      toast.success('已清空');
    } catch (e: any) {
      toast.error(e?.message ?? '清空失败');
    }
  };

  // 切换 tab 时重新加载
  const switchAssetTab = (tab: BalanceType) => {
    if (tab === assetTab) return;
    setAssetTab(tab);
    setAssetLogs([]);
    setAssetOffset(0);
    setHasMoreAsset(true);
    loadAssetLogs(tab, 0);
  };

  // 首次展开时加载
  const [assetLogsLoaded, setAssetLogsLoaded] = useState(false);
  const toggleRecords = () => {
    if (!showRecords && !assetLogsLoaded) {
      setAssetLogsLoaded(true);
      loadAssetLogs(assetTab, 0);
    }
    setShowRecords(v => !v);
  };

  // 编辑名字和头像
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editEmoji, setEditEmoji] = useState('🦁');
  const [editAvatarImage, setEditAvatarImage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 消息展开
  const [showRecords, setShowRecords] = useState(false);
  // 回复弹窗
  const [replyTarget, setReplyTarget] = useState<CoinRecord | null>(null);
  const [replyText, setReplyText] = useState('');
  const [replying, setReplying] = useState(false);
  // 兑换/出售
  const [redeemTarget, setRedeemTarget] = useState<Purchase | null>(null);
  const [sellTarget, setSellTarget] = useState<Purchase | null>(null);
  const [processing, setProcessing] = useState(false);

  const startEdit = () => {
    setEditName(child?.name ?? '');
    const cur = child?.avatar_emoji ?? '🦁';
    // 现有值若是 data URL（自定义图片），单独保存到 editAvatarImage，emoji 选回退
    if (cur.startsWith('data:')) {
      setEditAvatarImage(cur);
      setEditEmoji('🦁');
    } else {
      setEditAvatarImage(null);
      setEditEmoji(cur);
    }
    setEditing(true);
  };

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('请上传图片');
      return;
    }
    if (file.size > 512 * 1024) {
      toast.error('图片过大，请压缩到 512KB 以下');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setEditAvatarImage(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleSaveProfile = async () => {
    if (!child) return;
    if (!editName.trim()) { toast.error('请输入名字'); return; }
    setSaving(true);
    try {
      // 自定义图优先：存为 data URL 写入 avatar_emoji；否则写入所选 emoji
      const avatarValue = editAvatarImage ?? editEmoji;
      const updated = await updateMember(child.id, { name: editName.trim(), avatar_emoji: avatarValue });
      updateMemberStore(child.id, {
        name: updated.name,
        avatar_emoji: updated.avatar_emoji,
      });
      toast.success('已更新');
      setEditing(false);
    } catch (e: any) {
      toast.error(e?.message ?? '更新失败');
    } finally {
      setSaving(false);
    }
  };

  // 背包：当前孩子的购买记录
  const myPurchases = useMemo(() =>
    purchases.filter(p => child ? p.member_id === child.id : false),
    [purchases, child],
  );
  const pendingPurchases = myPurchases.filter(p => p.status === 'pending');
  const usedPurchases = myPurchases.filter(p => p.status === 'redeemed' || p.status === 'sold');

  const handleReply = async () => {
    if (!replyTarget) return;
    if (!replyText.trim()) { toast.error('请输入回复内容'); return; }
    setReplying(true);
    try {
      await replyMessage(replyTarget.id, replyText.trim());
      await refreshRecords();
      toast.success('已回复');
      setReplyTarget(null);
      setReplyText('');
    } catch (e: any) {
      toast.error(e?.message ?? '回复失败');
    } finally {
      setReplying(false);
    }
  };

  const handleRedeem = async () => {
    if (!redeemTarget || !child) return;
    setProcessing(true);
    try {
      await redeemPurchase(redeemTarget.id, child.id);
      await refreshMembers();
      toast.success('已使用');
      setRedeemTarget(null);
    } catch (e: any) {
      toast.error(e?.message ?? '使用失败');
    } finally {
      setProcessing(false);
    }
  };

  const handleSell = async () => {
    if (!sellTarget || !child) return;
    setProcessing(true);
    try {
      const result = await sellPurchase(sellTarget.id, child.id);
      await refreshMembers();
      toast.success(`已出售，返还 ${formatCoins(result.refund)} 金币`);
      setSellTarget(null);
    } catch (e: any) {
      toast.error(e?.message ?? '出售失败');
    } finally {
      setProcessing(false);
    }
  };

  // 出售返金币计算（90%）
  const sellRefund = (p: Purchase) => Math.floor(p.price_paid * p.quantity * 0.9);

  return (
    <div className="w-full space-y-4">
      {/* 双货币 Hero */}
      <Card className="bg-gradient-to-br from-amber-500 to-star-600 text-white border-0">
        <div className="p-6 sm:p-8 text-center relative">
          <button
            onClick={startEdit}
            className="absolute top-4 right-4 p-2 rounded-full bg-white/20 hover:bg-white/30 transition-colors"
          >
            <Pencil className="w-4 h-4 text-white" />
          </button>

          {/* 头像 */}
          <div className="w-20 h-20 sm:w-24 sm:h-24 mx-auto rounded-full bg-white/20 overflow-hidden flex items-center justify-center text-5xl sm:text-6xl mb-2 border-2 border-white/30">
            {child?.avatar_emoji?.startsWith('data:') ? (
              <img src={child.avatar_emoji} alt="头像" className="w-full h-full object-cover" />
            ) : (
              <span>{child?.avatar_emoji ?? '🦁'}</span>
            )}
          </div>
          <h2 className="text-xl font-medium text-white/90 mb-3">{child?.name ?? '我'}</h2>

          {/* 双货币并列 */}
          <div className="grid grid-cols-2 gap-2 sm:gap-4">
            {/* 金币 */}
            <div className="bg-white/15 rounded-2xl p-2 sm:p-3 flex flex-col items-center">
              <img src={COIN_ICON_SM} alt="金币" className="w-8 h-8 sm:w-10 sm:h-10 object-contain mb-1" />
              <span className="text-2xl sm:text-3xl font-bold tabular-nums animate-coin-pop leading-tight">
                {formatCoins(child?.coin_balance ?? 0)}
              </span>
              <p className="text-white/70 text-[11px] sm:text-sm mt-0.5">金币</p>
            </div>
            {/* 星光值 */}
            <div className="bg-white/15 rounded-2xl p-2 sm:p-3 flex flex-col items-center">
              <img src={STAR_ICON_SM} alt="星光值" className="w-8 h-8 sm:w-10 sm:h-10 object-contain mb-1" />
              <span className="text-2xl sm:text-3xl font-bold tabular-nums leading-tight">
                {child?.star_value ?? 0}
              </span>
              <p className="text-white/70 text-[11px] sm:text-sm mt-0.5">星光值</p>
            </div>
          </div>
        </div>
      </Card>

      {/* 背包：特权卡展示 */}
      <div>
        <h3 className="text-sm font-medium text-slate-500 mb-3 px-1">🎒 我的背包</h3>
        {purchasesLoading && pendingPurchases.length === 0 ? (
          <Loading />
        ) : pendingPurchases.length === 0 ? (
          <EmptyState icon="🎒" title="背包是空的" description="去兑换特权获取奖励吧！" />
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            {pendingPurchases.map(p => {
              const overdue = p.expires_at && isExpired(p.expires_at);
              const totalPaid = p.price_paid * p.quantity;
              return (
                <div
                  key={p.id}
                  className={cn(
                    'relative rounded-2xl overflow-hidden border-2',
                    'bg-gradient-to-br from-star-50 via-amber-50 to-star-100 border-star-200',
                    overdue && 'opacity-60'
                  )}
                >
                  {/* 装饰星星 */}
                  <CardStar className="absolute -top-2 -right-2 w-10 h-10 text-amber-300" />
                  <CardStar className="absolute -bottom-2 -left-2 w-8 h-8 text-amber-300" />

                  {/* 特权图标区 */}
                  <div className="pt-3 pb-1 flex items-center justify-center relative">
                    <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-gradient-to-br from-amber-200 to-star-300 flex items-center justify-center shadow-inner">
                      <span className="text-2xl sm:text-3xl">🎴</span>
                    </div>
                    {/* 特权标签 */}
                    <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-full bg-star-500 text-white text-[9px] font-bold shadow">
                      特权
                    </div>
                    {p.quantity > 1 && (
                      <div className="absolute top-1.5 right-1.5 px-1 py-0.5 rounded-full bg-white/80 text-star-600 text-[9px] font-bold">
                        x{p.quantity}
                      </div>
                    )}
                  </div>

                  {/* 信息 */}
                  <div className="px-2 pb-2 text-center relative">
                    <h4 className="font-bold text-slate-800 text-xs sm:text-sm line-clamp-1">{p.item_name_snapshot}</h4>
                    <p className="text-[10px] text-slate-400 mt-0.5 hidden sm:block">
                      购买于 {formatDate(p.created_at)}
                    </p>
                    <div className="flex items-center justify-center gap-1 mt-1 mb-2">
                      <img src={COIN_ICON_SM} alt="金币" className="w-3 h-3 object-contain" />
                      <span className="text-[11px] font-bold text-amber-600">{formatCoins(totalPaid)}</span>
                      <span className="text-[9px] text-slate-400 hidden sm:inline">
                        ·可售{formatCoins(sellRefund(p))}
                      </span>
                    </div>

                    {/* 操作按钮 */}
                    <div className="flex gap-1">
                      <button
                        onClick={() => setRedeemTarget(p)}
                        className="flex-1 py-1 rounded-lg text-[11px] font-bold text-white bg-gradient-to-r from-amber-400 to-star-400 hover:from-amber-500 hover:to-star-500 transition-all shadow-sm"
                      >
                        使用
                      </button>
                      <button
                        onClick={() => setSellTarget(p)}
                        className="flex-1 py-1 rounded-lg text-[11px] font-bold text-star-600 bg-white/70 hover:bg-white border border-star-200 transition-all"
                      >
                        出售
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* 已使用/已出售 */}
        {usedPurchases.length > 0 && (
          <div className="mt-4">
            <h4 className="text-xs font-medium text-slate-400 mb-2 px-1">已使用 / 已出售</h4>
            <div className="space-y-2">
              {usedPurchases.slice(0, 10).map(p => (
                <Card key={p.id} className="p-3 opacity-60">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm line-through">{p.item_name_snapshot}</span>
                      {p.quantity > 1 && <span className="text-xs text-slate-400">x{p.quantity}</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        'text-xs px-2 py-0.5 rounded-full',
                        p.status === 'sold' ? 'bg-amber-50 text-amber-500' : 'bg-slate-100 text-slate-400'
                      )}>
                        {PURCHASE_STATUS_LABELS[p.status]}
                      </span>
                      <span className="text-xs text-slate-400">
                        {p.redeemed_at ? formatDate(p.redeemed_at) : ''}
                      </span>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 资产明细：点击展开 + 星光/金币 切换 */}
      <div>
        <button
          onClick={toggleRecords}
          className="w-full flex items-center justify-between px-1 py-2"
        >
          <span className="flex items-center gap-2 text-sm font-medium text-slate-500">
            <MessageSquare className="w-4 h-4" /> 资产明细
          </span>
          <ChevronDown className={cn('w-4 h-4 text-slate-400 transition-transform', showRecords && 'rotate-180')} />
        </button>

        {showRecords && (
          <div className="mt-2">
            {/* 分类切换 */}
            <div className="flex items-center justify-between mb-2">
              <div className="flex bg-slate-100 rounded-lg p-0.5">
                <button
                  onClick={() => switchAssetTab('coin')}
                  className={cn(
                    'px-3 py-1 rounded-md text-xs font-medium transition-colors flex items-center gap-1',
                    assetTab === 'coin' ? 'bg-white text-amber-500 shadow-sm' : 'text-slate-400'
                  )}
                >
                  <img src={COIN_ICON_SM} alt="" className="w-3.5 h-3.5 object-contain" /> 金币
                </button>
                <button
                  onClick={() => switchAssetTab('star')}
                  className={cn(
                    'px-3 py-1 rounded-md text-xs font-medium transition-colors flex items-center gap-1',
                    assetTab === 'star' ? 'bg-white text-star-500 shadow-sm' : 'text-slate-400'
                  )}
                >
                  <img src={STAR_ICON_SM} alt="" className="w-3.5 h-3.5 object-contain" /> 星光值
                </button>
              </div>
              {assetLogs.length > 0 && (
                <button
                  onClick={handleClearAssetLogs}
                  className="text-xs text-slate-400 hover:text-red-500 flex items-center gap-1"
                >
                  <Trash2 className="w-3 h-3" /> 清空
                </button>
              )}
            </div>

            {assetLogsLoading && assetLogs.length === 0 ? (
              <Loading />
            ) : assetLogs.length === 0 ? (
              <EmptyState icon="📬" title="暂无记录" description="完成任务后这里会有流水" />
            ) : (
              <div className="space-y-2">
                {assetLogs.map(record => {
                  const isReject = record.category === 'task_reject';
                  const isManual = record.category === 'manual_adjust';
                  const isTask = record.category === 'task';
                  const positive = record.amount >= 0;
                  return (
                    <Card key={record.id} className={cn(
                      'p-3',
                      isReject && 'border-amber-200 bg-amber-50/30',
                      isManual && 'border-purple-200 bg-purple-50/30',
                    )}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            {isReject && <span className="text-xs">⚠️</span>}
                            {isManual && <span className="text-xs">✋</span>}
                            {isTask && <span className="text-xs">⭐</span>}
                            {record.category === 'purchase' && <span className="text-xs">🎴</span>}
                            {record.category === 'upgrade' && <span className="text-xs">⬆️</span>}
                            {record.category === 'evolve' && <span className="text-xs">✨</span>}
                            {record.category === 'boarding' && <span className="text-xs">🏠</span>}
                            {record.category === 'study' && <span className="text-xs">📚</span>}
                            {record.category === 'challenge' && <span className="text-xs">🧠</span>}
                            <p className="text-sm font-medium truncate">{record.reason}</p>
                          </div>
                          <p className="text-xs text-slate-400 mt-0.5">{timeAgo(record.created_at)}</p>
                          {record.message && (
                            <p className="text-xs text-amber-600 mt-1.5 bg-amber-50 rounded-lg p-2">
                              家长留言：{record.message}
                            </p>
                          )}
                          {record.reply && (
                            <p className="text-xs text-blue-500 mt-1.5 bg-blue-50 rounded-lg p-2 flex items-center gap-1">
                              <CornerDownRight className="w-3 h-3" />
                              我的回复：{record.reply}
                            </p>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                          {record.amount !== 0 && (
                            <span className={cn(
                              'font-bold tabular-nums',
                              positive ? 'text-emerald-500' : 'text-red-500'
                            )}>
                              {positive ? '+' : ''}{record.amount}
                              <span className="text-[10px] ml-0.5">{assetTab === 'coin' ? '金币' : '星光'}</span>
                            </span>
                          )}
                          {isReject && !record.reply && (
                            <button
                              onClick={() => { setReplyTarget(record); setReplyText(''); }}
                              className="text-xs text-blue-400 hover:text-blue-600"
                            >
                              回复
                            </button>
                          )}
                        </div>
                      </div>
                    </Card>
                  );
                })}

                {/* 加载更多 */}
                {hasMoreAsset && (
                  <button
                    onClick={() => loadAssetLogs(assetTab, assetOffset)}
                    disabled={assetLoadingMore}
                    className="w-full py-2 text-xs text-slate-400 hover:text-slate-600"
                  >
                    {assetLoadingMore ? '加载中...' : '加载更多'}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 使用确认弹窗 */}
      <Modal
        open={!!redeemTarget}
        onClose={() => !processing && setRedeemTarget(null)}
        title="确认使用"
        size="sm"
      >
        {redeemTarget && (
          <div className="space-y-4">
            <div className="text-center">
              <div className="w-16 h-16 mx-auto rounded-full bg-gradient-to-br from-amber-200 to-star-300 flex items-center justify-center mb-2">
                <span className="text-3xl">🎴</span>
              </div>
              <h3 className="font-bold text-slate-800">{redeemTarget.item_name_snapshot}</h3>
              {redeemTarget.quantity > 1 && (
                <p className="text-sm text-slate-400">数量 x{redeemTarget.quantity}</p>
              )}
            </div>
            <p className="text-sm text-slate-500 text-center">
              使用后特权卡将消失，请向家长出示确认
            </p>
            <div className="flex gap-3">
              <Button variant="secondary" fullWidth onClick={() => setRedeemTarget(null)} disabled={processing}>
                取消
              </Button>
              <Button
                fullWidth
                loading={processing}
                onClick={handleRedeem}
                className="bg-star-400 hover:bg-star-500 text-white"
              >
                确认使用
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* 出售确认弹窗 */}
      <Modal
        open={!!sellTarget}
        onClose={() => !processing && setSellTarget(null)}
        title="确认出售特权卡"
        size="sm"
      >
        {sellTarget && (
          <div className="space-y-4">
            <div className="text-center">
              <div className="w-16 h-16 mx-auto rounded-full bg-gradient-to-br from-amber-200 to-star-300 flex items-center justify-center mb-2">
                <span className="text-3xl">🎴</span>
              </div>
              <h3 className="font-bold text-slate-800">{sellTarget.item_name_snapshot}</h3>
              {sellTarget.quantity > 1 && (
                <p className="text-sm text-slate-400">数量 x{sellTarget.quantity}</p>
              )}
            </div>
            <div className="flex items-center justify-between bg-amber-50 rounded-xl px-4 py-3 border border-amber-100">
              <span className="text-slate-600">返还金币（90%）</span>
              <span className="flex items-center gap-1 font-bold text-amber-600 text-lg">
                <img src={COIN_ICON_SM} alt="金币" className="w-5 h-5 object-contain" />
                {formatCoins(sellRefund(sellTarget))}
              </span>
            </div>
            <p className="text-sm text-slate-500 text-center">
              出售后特权卡将消失，金币按购买价的 90% 返还
            </p>
            <div className="flex gap-3">
              <Button variant="secondary" fullWidth onClick={() => setSellTarget(null)} disabled={processing}>
                取消
              </Button>
              <Button
                fullWidth
                loading={processing}
                onClick={handleSell}
                className="bg-amber-500 hover:bg-amber-600 text-white"
              >
                确认出售
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* 回复弹窗 */}
      <Modal
        open={!!replyTarget}
        onClose={() => !replying && setReplyTarget(null)}
        title="回复家长"
        size="sm"
      >
        <div className="space-y-4">
          {replyTarget?.message && (
            <div className="bg-amber-50 rounded-lg p-3 text-sm text-amber-700">
              家长留言：{replyTarget.message}
            </div>
          )}
          <Textarea
            label="回复内容"
            placeholder="如：我已经补做了 / 下次会注意"
            value={replyText}
            onChange={e => setReplyText(e.target.value)}
            autoFocus
          />
          <div className="flex gap-3">
            <Button variant="secondary" fullWidth onClick={() => setReplyTarget(null)} disabled={replying}>
              取消
            </Button>
            <Button fullWidth loading={replying} onClick={handleReply}>
              发送
            </Button>
          </div>
        </div>
      </Modal>

      {/* 编辑名字和头像 */}
      <Modal open={editing} onClose={() => setEditing(false)} title="设置我的资料" size="sm">
        <div className="space-y-4">
          <Input
            label="我的名字"
            placeholder="如：小明"
            value={editName}
            onChange={e => setEditName(e.target.value)}
            autoFocus
          />
          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-700">我的头像</label>

            {/* 自定义头像上传 */}
            <div className="flex items-center gap-3 mb-2">
              <div className="w-16 h-16 rounded-full bg-slate-100 border-2 border-star-200 overflow-hidden flex items-center justify-center flex-shrink-0">
                {editAvatarImage ? (
                  <img src={editAvatarImage} alt="预览" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-3xl">{editEmoji.startsWith('data:') ? '🦁' : editEmoji}</span>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-star-100 text-star-600 text-xs font-medium hover:bg-star-200 transition-colors"
                >
                  <Upload className="w-3.5 h-3.5" />
                  上传图片
                </button>
                {editAvatarImage && (
                  <button
                    type="button"
                    onClick={() => { setEditAvatarImage(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                    className="text-xs text-slate-400 hover:text-red-500 transition-colors text-left"
                  >
                    移除图片，使用 emoji
                  </button>
                )}
                <p className="text-[10px] text-slate-400">支持 JPG/PNG，建议 512KB 以下</p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleAvatarUpload}
                className="hidden"
              />
            </div>

            {/* Emoji 备选（仅当未上传图片时生效） */}
            <p className="text-xs text-slate-400 mb-1">或选择 emoji 头像</p>
            <div className="grid grid-cols-6 gap-2">
              {CHILD_EMOJIS.map(emoji => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => { setEditEmoji(emoji); setEditAvatarImage(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                  className={cn(
                    'h-12 rounded-xl flex items-center justify-center text-2xl transition-all',
                    !editAvatarImage && editEmoji === emoji
                      ? 'bg-star-100 ring-2 ring-star-400 scale-110'
                      : 'bg-slate-50 hover:bg-slate-100'
                  )}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
          <Button fullWidth loading={saving} onClick={handleSaveProfile}
            className="bg-star-400 hover:bg-star-500 text-white">
            保存
          </Button>
        </div>
      </Modal>
    </div>
  );
}
