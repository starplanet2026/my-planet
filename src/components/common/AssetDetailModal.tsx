import { useState, useCallback, useEffect } from 'react';
import { Modal } from './Modal';
import { Card } from './Card';
import { Loading } from './Loading';
import { EmptyState } from './EmptyState';
import { Trash2, CornerDownRight } from 'lucide-react';
import { fetchAssetLogs, clearAssetLogs, type BalanceType } from '../../api/coins';
import { replyMessage } from '../../api/coins';
import { timeAgo } from '../../lib/utils';
import { cn } from '../../lib/utils';
import { COIN_ICON_SM, STAR_ICON_SM } from '../../lib/constants';
import { useToastStore } from '../../store/toastStore';
import type { CoinRecord } from '../../api/types';

interface AssetDetailModalProps {
  open: boolean;
  onClose: () => void;
  memberId: string;
  /** 是否展示星光值明细 */
  showStar?: boolean;
  /** 是否展示金币明细 */
  showCoin?: boolean;
  /** 默认选中的 tab */
  defaultTab?: BalanceType;
}

const PAGE_SIZE = 20;

export function AssetDetailModal({
  open,
  onClose,
  memberId,
  showStar = true,
  showCoin = true,
  defaultTab = 'coin',
}: AssetDetailModalProps) {
  const toast = useToastStore();
  // 若只展示一种货币，强制 tab 为该种
  const onlyTab: BalanceType | null = !showStar && showCoin ? 'coin' : showStar && !showCoin ? 'star' : null;

  const [tab, setTab] = useState<BalanceType>(onlyTab ?? defaultTab);
  const [logs, setLogs] = useState<CoinRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [replyTarget, setReplyTarget] = useState<CoinRecord | null>(null);
  const [replyText, setReplyText] = useState('');
  const [replying, setReplying] = useState(false);

  const loadLogs = useCallback(async (t: BalanceType, off = 0) => {
    const isFirst = off === 0;
    if (isFirst) setLoading(true); else setLoadingMore(true);
    try {
      const data = await fetchAssetLogs(memberId, t, PAGE_SIZE, off);
      if (off === 0) {
        setLogs(data);
      } else {
        setLogs(prev => [...prev, ...data]);
      }
      setOffset(off + data.length);
      setHasMore(data.length >= PAGE_SIZE);
    } catch {
      if (off === 0) setLogs([]);
      setHasMore(false);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [memberId]);

  // 打开弹窗或切换 tab 时加载
  useEffect(() => {
    if (!open) return;
    setLogs([]);
    setOffset(0);
    setHasMore(true);
    loadLogs(tab, 0);
  }, [open, tab, loadLogs]);

  // 只展示一种货币时，强制 tab
  useEffect(() => {
    if (onlyTab && tab !== onlyTab) setTab(onlyTab);
  }, [onlyTab, tab]);

  const handleClear = async () => {
    try {
      await clearAssetLogs(memberId, tab);
      setLogs([]);
      setOffset(0);
      setHasMore(false);
      toast.success('已清空');
    } catch (e: any) {
      toast.error(e?.message ?? '清空失败');
    }
  };

  const handleReply = async () => {
    if (!replyTarget) return;
    if (!replyText.trim()) { toast.error('请输入回复内容'); return; }
    setReplying(true);
    try {
      await replyMessage(replyTarget.id, replyText.trim());
      setLogs(prev => prev.map(r => r.id === replyTarget.id ? { ...r, reply: replyText.trim() } : r));
      setReplyTarget(null);
      setReplyText('');
      toast.success('回复成功');
    } catch (e: any) {
      toast.error(e?.message ?? '回复失败');
    } finally {
      setReplying(false);
    }
  };

  const showTabSwitcher = showStar && showCoin;

  return (
    <>
      <Modal open={open} onClose={onClose} title="资产明细" size="md">
        {/* 分类切换：仅当两种货币都展示时显示 */}
        {showTabSwitcher && (
          <div className="flex items-center justify-between mb-2">
            <div className="flex bg-slate-100 rounded-lg p-0.5">
              <button
                onClick={() => setTab('coin')}
                className={cn(
                  'px-3 py-1 rounded-md text-xs font-medium transition-colors flex items-center gap-1',
                  tab === 'coin' ? 'bg-white text-amber-500 shadow-sm' : 'text-slate-400'
                )}
              >
                <img src={COIN_ICON_SM} alt="" className="w-3.5 h-3.5 object-contain" /> 金币
              </button>
              <button
                onClick={() => setTab('star')}
                className={cn(
                  'px-3 py-1 rounded-md text-xs font-medium transition-colors flex items-center gap-1',
                  tab === 'star' ? 'bg-white text-star-500 shadow-sm' : 'text-slate-400'
                )}
              >
                <img src={STAR_ICON_SM} alt="" className="w-3.5 h-3.5 object-contain" /> 星光值
              </button>
            </div>
            {logs.length > 0 && (
              <button
                onClick={handleClear}
                className="text-xs text-slate-400 hover:text-red-500 flex items-center gap-1"
              >
                <Trash2 className="w-3 h-3" /> 清空
              </button>
            )}
          </div>
        )}
        {!showTabSwitcher && logs.length > 0 && (
          <div className="flex justify-end mb-2">
            <button
              onClick={handleClear}
              className="text-xs text-slate-400 hover:text-red-500 flex items-center gap-1"
            >
              <Trash2 className="w-3 h-3" /> 清空
            </button>
          </div>
        )}

        {loading && logs.length === 0 ? (
          <Loading />
        ) : logs.length === 0 ? (
          <EmptyState icon="📬" title="暂无记录" description="完成任务后这里会有流水" />
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {logs.map(record => {
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
                        {record.category === 'lucky_wheel' && <span className="text-xs">🎡</span>}
                        {record.category === 'recitation' && <span className="text-xs">📖</span>}
                        {record.category === 'dictation' && <span className="text-xs">📝</span>}
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
                          <span className="text-[10px] ml-0.5">{tab === 'coin' ? '金币' : '星光'}</span>
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

            {hasMore && (
              <button
                onClick={() => loadLogs(tab, offset)}
                disabled={loadingMore}
                className="w-full py-2 text-xs text-slate-400 hover:text-slate-600"
              >
                {loadingMore ? '加载中...' : '加载更多'}
              </button>
            )}
          </div>
        )}
      </Modal>

      {/* 回复弹窗 */}
      <Modal open={!!replyTarget} onClose={() => !replying && setReplyTarget(null)} title="回复家长" size="sm">
        <div className="space-y-3">
          {replyTarget?.message && (
            <p className="text-xs text-amber-600 bg-amber-50 rounded-lg p-2">
              家长留言：{replyTarget.message}
            </p>
          )}
          <textarea
            value={replyText}
            onChange={e => setReplyText(e.target.value)}
            placeholder="输入回复内容..."
            className="w-full min-h-[80px] p-3 rounded-lg border border-slate-200 text-sm focus:outline-none focus:border-star-400"
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setReplyTarget(null)}
              disabled={replying}
              className="px-4 py-1.5 text-sm text-slate-500 hover:text-slate-700"
            >
              取消
            </button>
            <button
              onClick={handleReply}
              disabled={replying}
              className="px-4 py-1.5 text-sm bg-star-500 text-white rounded-lg hover:bg-star-600 disabled:opacity-50"
            >
              {replying ? '发送中...' : '发送'}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
