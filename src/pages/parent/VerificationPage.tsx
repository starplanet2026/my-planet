import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFamilyStore } from '../../store/familyStore';
import { useTasks } from '../../hooks/useTasks';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Modal } from '../../components/common/Modal';
import { Textarea } from '../../components/common/Input';
import { EmptyState } from '../../components/common/EmptyState';
import { Avatar } from '../../components/common/Avatar';
import { useToastStore } from '../../store/toastStore';
import { getTaskIconUrl, TASK_CATEGORIES, ROUTES } from '../../lib/constants';
import { formatSignedCoins, formatDate } from '../../lib/utils';
import { cn } from '../../lib/utils';
import { Check, X, ArrowLeft } from 'lucide-react';
import type { Task } from '../../api/types';

export function VerificationPage() {
  const navigate = useNavigate();
  const family = useFamilyStore(s => s.family);
  const members = useFamilyStore(s => s.members);
  const refreshMembers = useFamilyStore(s => s.refreshMembers);
  const childMembers = members.filter(m => m.role === 'child');

  const { tasks, loading, refresh, approveTask, rejectTask } = useTasks();
  const toast = useToastStore();

  const [approving, setApproving] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<Task | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejecting, setRejecting] = useState(false);

  const pendingTasks = tasks.filter(t => t.status === 'pending_approval');

  const handleApprove = async (id: string) => {
    setApproving(id);
    try {
      const result = await approveTask(id);
      await refresh();
      await refreshMembers();
      toast.success(`已确认，奖励 ${result.reward} 星光值`);
    } catch (e: any) {
      toast.error(e?.message ?? '确认失败');
    } finally {
      setApproving(null);
    }
  };

  const handleReject = async () => {
    if (!rejectTarget) return;
    setRejecting(true);
    try {
      await rejectTask(rejectTarget.id, rejectReason.trim() || undefined);
      await refresh();
      toast.success('已退回任务');
      setRejectTarget(null);
      setRejectReason('');
    } catch (e: any) {
      toast.error(e?.message ?? '操作失败');
    } finally {
      setRejecting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate(ROUTES.PARENT)}
          className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-xl font-bold">验证申请</h1>
      </div>

      {loading && pendingTasks.length === 0 ? (
        <EmptyState icon="⏳" title="加载中..." />
      ) : pendingTasks.length === 0 ? (
        <EmptyState
          icon="✅"
          title="没有待验证的任务"
          description="孩子提交完成的任务会在这里显示"
        />
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-slate-400 px-1">
            {pendingTasks.length} 个任务待确认
          </p>
          {pendingTasks.map(task => {
            const iconUrl = getTaskIconUrl(task.icon);
            const child = childMembers.find(m => m.id === task.member_id);
            return (
              <Card key={task.id} className="p-4 border-amber-200 bg-amber-50/30">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    {iconUrl ? (
                      <img src={iconUrl} alt={task.title} className="w-12 h-12 object-contain rounded-xl bg-star-50 flex-shrink-0" />
                    ) : (
                      <span className="text-2xl flex-shrink-0">{TASK_CATEGORIES[task.category].emoji}</span>
                    )}
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium truncate">{task.title}</h3>
                      {task.description && (
                        <p className="text-xs text-slate-400 mt-1 line-clamp-2">{task.description}</p>
                      )}
                      <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-slate-400">
                        {child && (
                          <span className="flex items-center gap-1">
                            <Avatar emoji={child.avatar_emoji} size="sm" />
                            {child.name}
                          </span>
                        )}
                        {task.completed_at && <span>· 提交于 {formatDate(task.completed_at)}</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2 flex-shrink-0">
                    <span className={cn(
                      'font-bold tabular-nums',
                      task.reward_coins >= 0 ? 'text-emerald-500' : 'text-red-500'
                    )}>
                      {formatSignedCoins(task.reward_coins)}
                    </span>
                    <div className="flex gap-1">
                      <button
                        onClick={() => handleApprove(task.id)}
                        disabled={approving === task.id}
                        className="p-2 text-emerald-500 hover:bg-emerald-50 rounded-lg disabled:opacity-50"
                        title="确认完成"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => { setRejectTarget(task); setRejectReason(''); }}
                        className="p-2 text-red-400 hover:bg-red-50 rounded-lg"
                        title="退回"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* 退回原因弹窗 */}
      <Modal
        open={!!rejectTarget}
        onClose={() => !rejecting && setRejectTarget(null)}
        title="退回任务"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            退回「<span className="font-medium">{rejectTarget?.title}</span>」
          </p>
          <Textarea
            label="退回原因（可选）"
            placeholder="如：没有完成全部内容，请继续努力"
            value={rejectReason}
            onChange={e => setRejectReason(e.target.value)}
          />
          <div className="flex gap-3 pt-2">
            <Button variant="secondary" fullWidth onClick={() => setRejectTarget(null)} disabled={rejecting}>
              取消
            </Button>
            <Button fullWidth loading={rejecting} onClick={handleReject}>
              确认退回
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
