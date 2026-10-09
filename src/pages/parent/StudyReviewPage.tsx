import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFamilyStore } from '../../store/familyStore';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Textarea } from '../../components/common/Input';
import { Modal } from '../../components/common/Modal';
import { Loading } from '../../components/common/Loading';
import { EmptyState } from '../../components/common/EmptyState';
import { Avatar } from '../../components/common/Avatar';
import { useToastStore } from '../../store/toastStore';
import { ROUTES } from '../../lib/constants';
import { ArrowLeft, Check, X, EyeOff } from 'lucide-react';
import {
  approveStudyRecord, rejectStudyRecord, ignoreStudyRecord, fetchPendingStudyReviews,
} from '../../api/pets';
import type { PendingStudyReview } from '../../api/pets';

export function StudyReviewPage() {
  const navigate = useNavigate();
  const family = useFamilyStore(s => s.family);
  const members = useFamilyStore(s => s.members);
  const refreshMembers = useFamilyStore(s => s.refreshMembers);
  const toast = useToastStore();

  // 家长本人 member id（审核人）
  const parentMember = useMemo(() => members.find(m => m.role === 'parent'), [members]);
  const reviewerId = parentMember?.id ?? '';

  const [reviews, setReviews] = useState<PendingStudyReview[]>([]);
  const [loading, setLoading] = useState(false);
  const [approving, setApproving] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<PendingStudyReview | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [ignoring, setIgnoring] = useState<string | null>(null);

  const loadReviews = async () => {
    if (!family) return;
    setLoading(true);
    try {
      const list = await fetchPendingStudyReviews(family.id);
      setReviews(list);
    } catch (e: any) {
      toast.error(e?.message ?? '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadReviews(); }, [family?.id]);

  const handleApprove = async (r: PendingStudyReview) => {
    if (!reviewerId) { toast.error('无法获取家长身份'); return; }
    setApproving(r.id);
    try {
      const result = await approveStudyRecord(r.id, reviewerId);
      if (result.success) {
        toast.success(result.message);
        await refreshMembers();
        await loadReviews();
      } else {
        toast.error(result.message ?? '审核失败');
      }
    } catch (e: any) {
      toast.error(e?.message ?? '操作失败');
    } finally {
      setApproving(null);
    }
  };

  const handleReject = async () => {
    if (!rejectTarget || !reviewerId) return;
    setRejecting(true);
    try {
      await rejectStudyRecord(rejectTarget.id, reviewerId, rejectNote.trim() || undefined);
      toast.success('已驳回');
      setRejectTarget(null);
      setRejectNote('');
      await loadReviews();
    } catch (e: any) {
      toast.error(e?.message ?? '操作失败');
    } finally {
      setRejecting(false);
    }
  };

  const handleIgnore = async (r: PendingStudyReview) => {
    if (!reviewerId) { toast.error('无法获取家长身份'); return; }
    setIgnoring(r.id);
    try {
      const result = await ignoreStudyRecord(r.id, reviewerId);
      if (result.success) {
        toast.success(result.message ?? '已忽略');
        await loadReviews();
      } else {
        toast.error(result.message ?? '操作失败');
      }
    } catch (e: any) {
      toast.error(e?.message ?? '操作失败');
    } finally {
      setIgnoring(null);
    }
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate(ROUTES.PARENT_DASHBOARD)}
          className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-xl font-bold">陪伴学习审核</h1>
      </div>

      {loading && reviews.length === 0 ? (
        <Loading />
      ) : reviews.length === 0 ? (
        <EmptyState
          icon="✅"
          title="没有待审核的学习记录"
          description="孩子提交完成的学习会在这里显示"
        />
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-slate-400 px-1">{reviews.length} 条待审核</p>
          {reviews.map(r => {
            const child = members.find(m => m.id === r.member_id);
            const tasks = r.tasks ?? [];
            const doneCount = tasks.filter(t => t.done).length;
            return (
              <Card key={r.id} className="p-4 border-amber-200 bg-amber-50/30">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    {/* 头部：孩子 + 时间 */}
                    <div className="flex items-center gap-2 mb-2">
                      <Avatar emoji={child?.avatar_emoji ?? ''} size="sm" />
                      <span className="text-base font-bold text-slate-700">
                        {r.member_name}
                      </span>
                      <span className="text-xs text-slate-400">{formatDate(r.created_at)}</span>
                    </div>
                    {/* 数据 */}
                    <div className="flex flex-wrap gap-2 mb-2 text-xs">
                      <span className="px-2 py-0.5 rounded-full bg-green-50 text-green-600">⏱ {r.minutes}分钟</span>
                      <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600">💚 心情+{r.happiness_gain}</span>
                      {r.star_earned > 0 && (
                        <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-600">⭐ +{r.star_earned}</span>
                      )}
                      {r.pet_name && (
                        <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">🐾 {r.pet_name}</span>
                      )}
                    </div>
                    {/* 任务列表 */}
                    {tasks.length > 0 && (
                      <ul className="space-y-1 mt-1">
                        {tasks.map((t, i) => (
                          <li key={i} className="flex items-center gap-1.5 text-xs">
                            <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center text-[8px] ${
                              t.done ? 'bg-green-400 border-green-400 text-white' : 'border-slate-300'
                            }`}>
                              {t.done ? '✓' : ''}
                            </span>
                            <span className={t.done ? 'text-slate-500 line-through' : 'text-slate-600'}>
                              {t.text}
                            </span>
                            {t.reward > 0 && (
                              <span className="text-amber-500 text-[10px]">⭐{t.reward}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="text-[10px] text-slate-400 mt-1">完成 {doneCount}/{tasks.length} 个任务</p>
                  </div>
                  {/* 审核按钮 */}
                  <div className="flex flex-col gap-2 flex-shrink-0">
                    <Button
                      size="sm"
                      onClick={() => handleApprove(r)}
                      loading={approving === r.id}
                      className="bg-green-500 hover:bg-green-600"
                    >
                      <Check className="w-4 h-4" /> 通过
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => { setRejectTarget(r); setRejectNote(''); }}
                      className="border border-red-200 text-red-500 hover:bg-red-50"
                    >
                      <X className="w-4 h-4" /> 驳回
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleIgnore(r)}
                      loading={ignoring === r.id}
                      className="border border-slate-200 text-slate-500 hover:bg-slate-100"
                    >
                      <EyeOff className="w-4 h-4" /> 忽略
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* 驳回弹窗 */}
      <Modal open={!!rejectTarget} onClose={() => !rejecting && setRejectTarget(null)} title="驳回学习申请" size="sm">
        <div className="space-y-4">
          {rejectTarget && (
            <p className="text-sm text-slate-500">
              驳回 <span className="font-medium text-slate-700">{rejectTarget.member_name}</span> 的学习申请（{rejectTarget.minutes}分钟）
            </p>
          )}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">驳回备注（学生可见，可选）</label>
            <Textarea
              value={rejectNote}
              onChange={e => setRejectNote(e.target.value)}
              placeholder="如：学习时长不足，请重新提交"
              rows={3}
            />
          </div>
          <div className="flex gap-2">
            <Button onClick={handleReject} loading={rejecting} className="flex-1 bg-red-500 hover:bg-red-600">确认驳回</Button>
            <Button onClick={() => setRejectTarget(null)} variant="ghost" className="flex-1">取消</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
