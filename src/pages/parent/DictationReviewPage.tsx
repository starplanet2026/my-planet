import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFamilyStore } from '../../store/familyStore';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Modal } from '../../components/common/Modal';
import { Loading } from '../../components/common/Loading';
import { EmptyState } from '../../components/common/EmptyState';
import { Avatar } from '../../components/common/Avatar';
import { useToastStore } from '../../store/toastStore';
import { ROUTES } from '../../lib/constants';
import { ArrowLeft, Check, X } from 'lucide-react';
import {
  listPendingDictationSubmissions, approveDictationSubmission, rejectDictationSubmission,
} from '../../api/dictation';
import type { PendingDictationSubmission } from '../../api/dictation';

const TYPE_LABEL: Record<string, string> = {
  grading_access: '申请查看答案批改',
  grading_result: '提交批改结果',
  quick_review: '快速复习积分',
};

const TYPE_ICON: Record<string, string> = {
  grading_access: '👀',
  grading_result: '📝',
  quick_review: '⚡',
};

export function DictationReviewPage() {
  const navigate = useNavigate();
  const family = useFamilyStore(s => s.family);
  const members = useFamilyStore(s => s.members);
  const refreshMembers = useFamilyStore(s => s.refreshMembers);
  const toast = useToastStore();

  const reviewerId = useMemo(() => members.find(m => m.role === 'parent')?.id ?? '', [members]);

  const [list, setList] = useState<PendingDictationSubmission[]>([]);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<PendingDictationSubmission | null>(null);
  const [acting, setActing] = useState(false);

  const load = async () => {
    if (!family) return;
    setLoading(true);
    try {
      setList(await listPendingDictationSubmissions(family.id));
    } catch (e: any) {
      toast.error(e?.message ?? '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [family?.id]);

  const handleApprove = async (target: PendingDictationSubmission) => {
    if (!reviewerId) { toast.error('无法获取家长身份'); return; }
    setActing(true);
    try {
      const res = await approveDictationSubmission(target.id, reviewerId);
      if (!res.success) { toast.error(res.message); return; }
      if (target.type === 'grading_access') {
        toast.success('已批准查看答案');
      } else if (target.type === 'quick_review') {
        toast.success(`已通过，发放 ${res.total_star} 星光`);
      } else {
        toast.success(`已通过：答对 ${res.correct_count} 条，发放 ${res.total_star} 星光`);
      }
      setDetail(null);
      await refreshMembers();
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? '操作失败');
    } finally {
      setActing(false);
    }
  };

  const handleReject = async (target: PendingDictationSubmission) => {
    if (!reviewerId) { toast.error('无法获取家长身份'); return; }
    setActing(true);
    try {
      const res = await rejectDictationSubmission(target.id, reviewerId);
      if (!res.success) { toast.error(res.message); return; }
      toast.success('已驳回');
      setDetail(null);
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? '操作失败');
    } finally {
      setActing(false);
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
        <h1 className="text-xl font-bold">家默审核</h1>
      </div>

      {loading && list.length === 0 ? (
        <Loading />
      ) : list.length === 0 ? (
        <EmptyState
          icon="✅"
          title="没有待审核的家默请求"
          description="孩子提交的批改申请、批改结果、快速复习积分会在这里显示"
        />
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-slate-400 px-1">{list.length} 条待审核</p>
          {list.map(s => {
            const child = members.find(m => m.id === s.member_id);
            const correctCnt = (s.results ?? []).filter(r => r.is_correct).length;
            return (
              <Card key={s.id} className="p-4 border-amber-200 bg-amber-50/30">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <Avatar emoji={child?.avatar_emoji ?? ''} size="sm" />
                      <span className="text-base font-bold text-slate-700">{s.member_name}</span>
                      <span className="text-xs text-slate-400">{formatDate(s.created_at)}</span>
                    </div>
                    <div className="flex flex-wrap gap-2 mb-1 text-xs">
                      <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-600">
                        {TYPE_ICON[s.type]} {TYPE_LABEL[s.type] ?? s.type}
                      </span>
                      <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">
                        {s.subject === 'english' ? '英语' : '语文'} · {s.task_title}
                      </span>
                      {s.type === 'grading_result' && (
                        <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600">
                          勾选正确 {correctCnt}/{s.results?.length ?? 0}
                        </span>
                      )}
                      {s.type === 'quick_review' && (
                        <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-600">
                          ⭐ +{s.total_star ?? 0}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 flex-shrink-0">
                    {s.type === 'grading_result' && (
                      <Button size="sm" variant="secondary" onClick={() => setDetail(s)}>查看明细</Button>
                    )}
                    <Button
                      size="sm"
                      onClick={() => handleApprove(s)}
                      loading={acting}
                      className="bg-green-500 hover:bg-green-600"
                    >
                      <Check className="w-4 h-4" /> 通过
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleReject(s)}
                      className="border border-red-200 text-red-500 hover:bg-red-50"
                    >
                      <X className="w-4 h-4" /> 驳回
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* 批文明细弹窗 */}
      <Modal open={detail !== null} onClose={() => !acting && setDetail(null)} title="批改明细" size="md">
        {detail && (
          <div className="space-y-4">
            <div className="text-sm text-slate-600">
              <p>任务：<span className="font-medium text-slate-800">{detail.task_title}</span></p>
              <p>孩子：<span className="font-medium text-slate-800">{detail.member_name}</span></p>
            </div>
            <div className="max-h-72 overflow-y-auto space-y-1.5">
              {(detail.results ?? []).map((r, i) => (
                <div
                  key={i}
                  className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm ${
                    r.is_correct ? 'bg-emerald-50 border border-emerald-200' : 'bg-red-50 border border-red-200'
                  }`}
                >
                  <div>
                    <span className="text-slate-500 mr-2">{i + 1}.</span>
                    <span className="text-slate-700">{r.word_text}</span>
                    <span className="mx-2 text-slate-300">|</span>
                    <span className="font-medium text-slate-800">{r.answer}</span>
                  </div>
                  <span className={r.is_correct ? 'text-emerald-600' : 'text-red-500'}>
                    {r.is_correct ? '✓ 正确' : '✗ 错误'}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <Button variant="danger" loading={acting} onClick={() => handleReject(detail)}>驳回</Button>
              <Button variant="success" loading={acting} onClick={() => handleApprove(detail)}>审核通过</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
