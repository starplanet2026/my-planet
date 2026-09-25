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
import { ArrowLeft, CheckSquare, Square, CheckCircle } from 'lucide-react';
import { getActiveTask, listTaskWords, submitDictationResult } from '../../api/dictation';
import type { DictationSubject, DictationTask, DictationTaskWord } from '../../api/types';

export function DictationGradePage() {
  const { subject } = useParams<{ subject: DictationSubject }>();
  const navigate = useNavigate();
  const currentChildId = useModeStore(s => s.currentChildId);
  const childId = currentChildId ?? '';
  const refreshMembers = useFamilyStore(s => s.refreshMembers);
  const toast = useToastStore();

  const [task, setTask] = useState<DictationTask | null>(null);
  const [words, setWords] = useState<DictationTaskWord[]>([]);
  const [loading, setLoading] = useState(true);
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

  const allCorrect = words.length > 0 && words.every(w => correct.has(w.id));
  const correctCount = correct.size;
  const totalStar = task ? correctCount * task.star_per_word : 0;

  const toggleCorrect = (id: string) => {
    setCorrect(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (allCorrect) setCorrect(new Set());
    else setCorrect(new Set(words.map(w => w.id)));
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
      // 提交批改 + 发放星光值（同一数据库事务，原子性保证）
      const submitRes = await submitDictationResult(task.id, childId, results);
      if (!submitRes.success) {
        toast.error(submitRes.message);
        return;
      }
      setResultInfo({ correct: submitRes.correct_count, total: words.length, star: submitRes.total_star });
      setShowResult(true);
      // 刷新成员星光值
      await refreshMembers();
    } catch (e: any) {
      toast.error('提交失败：' + e.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <Loading />;

  const subjectLabel = subject === 'english' ? '英语' : '语文';

  if (!task) {
    return (
      <div className="max-w-3xl mx-auto py-6 px-4">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-slate-500 mb-4 hover:text-slate-700">
          <ArrowLeft className="w-4 h-4" />返回
        </button>
        <EmptyState icon="📭" title={`暂无${subjectLabel}家默任务`} description="请家长先在后台创建家默任务" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto py-4 px-4 pb-24">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => navigate(-1)} className="p-2 hover:bg-slate-100 rounded-lg">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-xl font-bold">{task.title} - 批改</h1>
          <p className="text-xs text-slate-400">逐条对照标准答案，勾选正确的词条</p>
        </div>
      </div>

      {/* 全选操作栏 */}
      <div className="flex items-center justify-between mb-3">
        <button onClick={toggleAll} className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-800">
          {allCorrect ? <CheckSquare className="w-5 h-5 text-emerald-500" /> : <Square className="w-5 h-5" />}
          全部标记为正确
        </button>
        <span className="text-sm text-slate-500">已选 {correctCount} / {words.length} 正确</span>
      </div>

      {/* 逐条批改 */}
      <div className="space-y-3">
        {words.map((w, i) => {
          const isCorrect = correct.has(w.id);
          return (
            <Card key={w.id} className={cn('p-4 flex items-start gap-3', isCorrect ? 'bg-emerald-50 border-emerald-200' : '')}>
              <button onClick={() => toggleCorrect(w.id)} className="mt-1 shrink-0">
                {isCorrect ? <CheckSquare className="w-6 h-6 text-emerald-500" /> : <Square className="w-6 h-6 text-slate-300" />}
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs text-slate-400">第 {i + 1} 题</span>
                  <span className="text-xs text-slate-400">
                    {subject === 'english' ? (w.chinese_meaning ?? '-') : (w.pinyin ?? '-')}
                  </span>
                </div>
                <div className="text-lg font-bold text-slate-800">{w.answer}</div>
                {w.part_of_speech && (
                  <div className="text-xs text-slate-400 mt-0.5">{w.part_of_speech}</div>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      {/* 底部提交 */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-100 p-4 z-30">
        <div className="max-w-4xl mx-auto flex gap-3">
          <div className="flex-1 flex items-center justify-center text-sm text-slate-600">
            预计获得 <span className="text-amber-500 font-bold mx-1">{totalStar}</span> 星光值
          </div>
          <Button onClick={submit} disabled={submitting} size="lg">
            {submitting ? '提交中...' : '提交批改'}
          </Button>
        </div>
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
