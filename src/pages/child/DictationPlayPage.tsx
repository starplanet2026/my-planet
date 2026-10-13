import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { useModeStore } from '../../store/modeStore';
import { useFamilyStore } from '../../store/familyStore';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Modal } from '../../components/common/Modal';
import { EmptyState } from '../../components/common/EmptyState';
import { Loading } from '../../components/common/Loading';
import { useToastStore } from '../../store/toastStore';
import { cn } from '../../lib/utils';
import { CheckCircle } from 'lucide-react';
import { getActiveTask, getTaskById, listTaskWords, submitDictationReview, getDictationSubmissionStatus } from '../../api/dictation';
import type { DictationSubject, DictationTask, DictationTaskWord } from '../../api/types';
import { DictationQuickReviewPage } from './DictationQuickReviewPage';

export function DictationPlayPage() {
  const { pathname } = useLocation();
  const subject = pathname.split('/')[3] as DictationSubject | undefined;
  const [searchParams] = useSearchParams();
  const taskId = searchParams.get('taskId');
  const navigate = useNavigate();
  const currentChildId = useModeStore(s => s.currentChildId);
  const childId = currentChildId ?? '';
  const refreshMembers = useFamilyStore(s => s.refreshMembers);
  const toast = useToastStore();

  const [task, setTask] = useState<DictationTask | null>(null);
  const [words, setWords] = useState<DictationTaskWord[]>([]);
  const [loading, setLoading] = useState(true);
  // 批改模式：点击「去批改」后展示答案并可勾选正确
  const [grading, setGrading] = useState(false);
  const [correct, setCorrect] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [resultInfo, setResultInfo] = useState({ correct: 0, total: 0, star: 0 });
  // 审核状态：null=未提交 / pending=待审核 / approved=已通过 / rejected=已驳回
  const [reviewStatus, setReviewStatus] = useState<string | null>(null);
  const [approvedInfo, setApprovedInfo] = useState<{ correct: number; total: number; star: number } | null>(null);
  // 查看答案授权状态：null=未申请 / pending=待批准 / approved=已授权
  const [accessStatus, setAccessStatus] = useState<string | null>(null);
  // 加载错误信息（可见化展示，替代仅 toast 一闪而过）
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    // childId/subject 缺失时必须结束 loading，否则页面永久卡在加载态
    if (!childId || !subject) { setLoading(false); return; }
    setLoading(true);
    setLoadError(null);
    // 优先加载 URL 中指定的任务（支持多个 active 任务时直达），否则取最新 active 任务
    const loadTask = taskId ? getTaskById(taskId) : getActiveTask(childId, subject);
    loadTask.then(t => {
      setTask(t);
      if (t) {
        // 查询批改结果审核状态
        getDictationSubmissionStatus(t.id, childId, 'grading_result').then(s => {
          if (s) {
            setReviewStatus(s.status);
            if (s.status === 'approved') {
              setApprovedInfo({ correct: s.correct_count ?? 0, total: 0, star: s.total_star ?? 0 });
            }
          }
        }).catch(() => {});
        // 查询查看答案授权状态
        getDictationSubmissionStatus(t.id, childId, 'grading_access').then(s => {
          if (s) {
            setAccessStatus(s.status);
            if (s.status === 'approved') setGrading(true);
          }
        }).catch(() => {});
        return listTaskWords(t.id).then(setWords);
      }
      setWords([]);
    }).catch(e => {
      setLoadError(e?.message ?? '未知错误');
      toast.error('加载失败：' + e.message);
    })
      .finally(() => setLoading(false));
  }, [childId, subject, taskId]);

  // 轮询授权状态（pending 时每 5 秒检查一次，家长批准后立即进入批改界面）
  // 注意：必须声明在下方所有提前 return 之前，否则 Hooks 数量随渲染变化会导致 React 崩溃白屏
  useEffect(() => {
    if (accessStatus !== 'pending' || !task || !childId) return;
    const timer = setInterval(async () => {
      try {
        const s = await getDictationSubmissionStatus(task.id, childId, 'grading_access');
        if (s?.status === 'approved') {
          setAccessStatus('approved');
          setGrading(true);
          toast.success('家长已批准，开始批改吧！');
        } else if (s?.status === 'rejected') {
          setAccessStatus('rejected');
        }
      } catch { /* 静默 */ }
    }, 5000);
    return () => clearInterval(timer);
  }, [accessStatus, task?.id, childId]);

  if (loading) return <Loading />;

  const subjectLabel = subject === 'english' ? '英语' : '语文';

  // 加载失败：展示可见错误空态（含原因与返回入口），避免用户无法区分「没任务」与「加载出错」
  if (loadError) {
    return (
      <div className="max-w-3xl mx-auto py-6 px-4">
        <EmptyState icon="⚠️" title={`${subjectLabel}家默加载失败`} description={loadError} />
        <div className="flex justify-center mt-4">
          <Button onClick={() => navigate('/challenge')}>返回挑战页</Button>
        </div>
      </div>
    );
  }

  if (!task) {
    return (
      <div className="max-w-3xl mx-auto py-6 px-4">
        <EmptyState icon="📭" title={`暂无${subjectLabel}家默任务`} description="请家长先在后台创建家默任务" />
      </div>
    );
  }

  // 快速复习模式：渲染独立组件，默写模式继续走下方原有逻辑
  if (task.mode === 'quick_review') {
    return <DictationQuickReviewPage task={task} subject={subject!} childId={childId} />;
  }

  const correctCount = correct.size;
  const totalStar = task ? correctCount * task.star_per_word : 0;

  const toggleCorrect = (id: string) => {
    setCorrect(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // 点击「去批改」：需先申请家长授权查看答案
  const requestGradingAccess = async () => {
    if (!task) return;
    setSubmitting(true);
    try {
      const res = await submitDictationReview(task.id, childId, [], 'grading_access');
      if (!res.success) { toast.error(res.message); return; }
      if (res.message === 'already_approved') {
        setAccessStatus('approved');
        setGrading(true);
      } else {
        setAccessStatus('pending');
        toast.success('已申请，等待家长批准查看答案');
      }
    } catch (e: any) {
      toast.error('申请失败：' + e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const submit = async () => {
    if (!task || words.length === 0) return;
    setSubmitting(true);
    try {
      const results = words.map(w => ({
        word_id: w.word_id ?? null,
        error_word_id: w.error_word_id ?? null,
        word_text: subject === 'english' ? (w.chinese_meaning ?? '') : (w.pinyin ?? ''),
        answer: w.answer,
        is_correct: correct.has(w.id),
      }));
      const submitRes = await submitDictationReview(task.id, childId, results);
      if (!submitRes.success) {
        toast.error(submitRes.message);
        return;
      }
      setReviewStatus('pending');
      setGrading(false);
      toast.success('已提交，等待家长审核');
    } catch (e: any) {
      toast.error('提交失败：' + e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="h-[calc(100dvh-4rem-4rem-env(safe-area-inset-bottom))] -mt-6 -mb-24 -mx-4 sm:-mx-6 lg:-mx-8 px-2 sm:px-4 flex flex-col overflow-hidden">
      {/* 卡片固定最小高度，超出部分可滚动 */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
          {words.map((w, i) => {
            const isCorrect = correct.has(w.id);
            const prompt = subject === 'english' ? (w.chinese_meaning ?? '-') : (w.pinyin ?? '-');
            return (
              <Card
                key={w.id}
                onClick={() => grading && toggleCorrect(w.id)}
                className={cn(
                  'p-2 flex flex-col justify-center items-center text-center transition-colors w-full min-h-[140px]',
                  grading && 'cursor-pointer',
                  grading && isCorrect && 'bg-emerald-50 border-emerald-300 ring-2 ring-emerald-300'
                )}
              >
                <div className="text-[15px] text-slate-400">{i + 1}</div>
                <div className="font-bold text-slate-800 leading-tight text-[21px] break-all whitespace-normal">
                  {prompt}
                </div>
                {subject === 'english' && w.part_of_speech && (
                  <div className="text-xs text-slate-400 mt-0.5">{w.part_of_speech}</div>
                )}
                {(grading || reviewStatus === 'approved') && (
                  <div className="text-emerald-500 font-extrabold leading-tight mt-1 text-[18px] break-all whitespace-normal">
                    {w.answer}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      </div>

      {/* 底部操作栏 */}
      <div className="flex-shrink-0 pt-2 flex items-center gap-3">
        {reviewStatus === 'pending' ? (
          <div className="w-full text-center py-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 text-sm font-medium">
            ⏳ 已提交批改，等待家长审核…
          </div>
        ) : reviewStatus === 'approved' ? (
          <div className="w-full text-center py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm font-medium">
            ✅ 审核通过：答对 {approvedInfo?.correct ?? 0} 条，获得 {approvedInfo?.star ?? 0} 星光值
          </div>
        ) : reviewStatus === 'rejected' ? (
          <div className="w-full flex items-center gap-2">
            <div className="flex-1 text-center py-2 rounded-xl bg-red-50 border border-red-200 text-red-600 text-sm font-medium">
              批改已被家长驳回，请重新批改
            </div>
            <Button size="lg" onClick={() => { setReviewStatus(null); setCorrect(new Set()); setGrading(true); }}>
              重新批改
            </Button>
          </div>
        ) : accessStatus === 'pending' ? (
          <div className="w-full text-center py-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 text-sm font-medium">
            ⏳ 已申请批改，等待家长批准查看答案…
          </div>
        ) : !grading ? (
          <Button className="w-full" size="lg" onClick={requestGradingAccess} disabled={submitting}>
            <CheckCircle className="w-5 h-5" />{submitting ? '申请中...' : '去批改'}
          </Button>
        ) : (
          <>
            <div className="flex-1 text-sm text-slate-600 whitespace-nowrap">
              已选 <span className="text-emerald-600 font-bold">{correctCount}</span>/{words.length} 正确
              <span className="ml-2">预计 <span className="text-amber-500 font-bold">{totalStar}</span> 星光</span>
            </div>
            <Button onClick={submit} disabled={submitting} size="lg">
              {submitting ? '提交中...' : '提交批改'}
            </Button>
          </>
        )}
      </div>

      {/* 结果弹窗 */}
      <Modal open={showResult} onClose={() => navigate('/challenge')} title="批改完成">
        <div className="text-center py-4">
          <div className="text-5xl mb-3">🎉</div>
          <p className="text-lg mb-1">答对 <span className="text-emerald-600 font-bold">{resultInfo.correct}</span> / {resultInfo.total} 条</p>
          <p className="text-slate-500">获得 <span className="text-amber-500 font-bold">{resultInfo.star}</span> 星光值</p>
          <p className="text-xs text-slate-400 mt-3">错误词条已加入错词库，将按艾宾浩斯节奏推送复习</p>
        </div>
        <div className="flex gap-2 justify-end pt-2">
          <Button onClick={() => navigate('/challenge')}><CheckCircle className="w-4 h-4" />完成</Button>
        </div>
      </Modal>
    </div>
  );
}
