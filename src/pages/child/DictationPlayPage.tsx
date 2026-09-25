import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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
import { getActiveTask, listTaskWords, submitDictationResult } from '../../api/dictation';
import type { DictationSubject, DictationTask, DictationTaskWord } from '../../api/types';

export function DictationPlayPage() {
  const { subject } = useParams<{ subject: DictationSubject }>();
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

  useEffect(() => {
    if (!childId || !subject) return;
    setLoading(true);
    getActiveTask(childId, subject).then(t => {
      setTask(t);
      if (t) return listTaskWords(t.id).then(setWords);
      setWords([]);
    }).catch(e => toast.error('加载失败：' + e.message))
      .finally(() => setLoading(false));
  }, [childId, subject]);

  if (loading) return <Loading />;

  const subjectLabel = subject === 'english' ? '英语' : '语文';

  if (!task) {
    return (
      <div className="max-w-3xl mx-auto py-6 px-4">
        <EmptyState icon="📭" title={`暂无${subjectLabel}家默任务`} description="请家长先在后台创建家默任务" />
      </div>
    );
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
      const submitRes = await submitDictationResult(task.id, childId, results);
      if (!submitRes.success) {
        toast.error(submitRes.message);
        return;
      }
      setResultInfo({ correct: submitRes.correct_count, total: words.length, star: submitRes.total_star });
      setShowResult(true);
      await refreshMembers();
    } catch (e: any) {
      toast.error('提交失败：' + e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="h-[100dvh] flex flex-col overflow-hidden px-2 sm:px-4 py-2">
      {/* 所有词条一屏展示：行高均分 + 容器查询单位实现词多缩小、词少放大 */}
      <div className="flex-1 min-h-0 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 [grid-auto-rows:minmax(0,1fr)]">
        {words.map((w, i) => {
          const isCorrect = correct.has(w.id);
          const prompt = subject === 'english' ? (w.chinese_meaning ?? '-') : (w.pinyin ?? '-');
          return (
            <Card
              key={w.id}
              onClick={() => grading && toggleCorrect(w.id)}
              className={cn(
                'p-2 flex flex-col justify-center [container-type:size] min-h-0 overflow-hidden transition-colors',
                grading && 'cursor-pointer',
                grading && isCorrect && 'bg-emerald-50 border-emerald-300 ring-2 ring-emerald-300'
              )}
            >
              <div className="text-[10px] text-slate-400">{i + 1}</div>
              <div className="font-bold text-slate-800 leading-tight [font-size:clamp(1.1rem,7cqh,3rem)] break-all">
                {prompt}
              </div>
              {grading && (
                <div className="text-red-600 font-extrabold leading-tight mt-1 [font-size:clamp(1rem,6cqh,2.6rem)] break-all">
                  {w.answer}
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {/* 底部操作栏 */}
      <div className="flex-shrink-0 py-2 flex items-center gap-3">
        {!grading ? (
          <Button className="w-full" size="lg" onClick={() => setGrading(true)}>
            <CheckCircle className="w-5 h-5" />去批改
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
