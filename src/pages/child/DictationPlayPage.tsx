import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useModeStore } from '../../store/modeStore';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { EmptyState } from '../../components/common/EmptyState';
import { Loading } from '../../components/common/Loading';
import { useToastStore } from '../../store/toastStore';
import { ArrowLeft, CheckCircle } from 'lucide-react';
import { getActiveTask, listTaskWords } from '../../api/dictation';
import type { DictationSubject, DictationTask, DictationTaskWord } from '../../api/types';

export function DictationPlayPage() {
  const { subject } = useParams<{ subject: DictationSubject }>();
  const navigate = useNavigate();
  const currentChildId = useModeStore(s => s.currentChildId);
  const childId = currentChildId ?? '';
  const toast = useToastStore();

  const [task, setTask] = useState<DictationTask | null>(null);
  const [words, setWords] = useState<DictationTaskWord[]>([]);
  const [loading, setLoading] = useState(true);

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
        <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-slate-500 mb-4 hover:text-slate-700">
          <ArrowLeft className="w-4 h-4" />返回
        </button>
        <EmptyState icon="📭" title={`暂无${subjectLabel}家默任务`} description="请家长先在后台创建家默任务" />
      </div>
    );
  }

  return (
    <div className="h-[100dvh] flex flex-col overflow-hidden px-2 sm:px-4">
      <div className="flex items-center gap-3 py-2 flex-shrink-0">
        <button onClick={() => navigate(-1)} className="p-2 hover:bg-slate-100 rounded-lg">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-lg font-bold">{task.title}</h1>
          <p className="text-[11px] text-slate-400">共 {words.length} 条 · 单条答对 {task.star_per_word} 星光值</p>
        </div>
      </div>

      <Card className="p-2 mb-2 bg-amber-50 border-amber-200 flex-shrink-0">
        <p className="text-xs text-amber-800">
          {subject === 'english'
            ? '请根据中文释义在纸上写出英文单词，完成后点击「去批改」。'
            : '请根据拼音在纸上写出汉字词语，完成后点击「去批改」。'}
        </p>
      </Card>

      {/* 所有词条一屏展示：行高均分 + 容器查询单位实现词多缩小、词少放大 */}
      <div className="flex-1 min-h-0 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 [grid-auto-rows:minmax(0,1fr)]">
        {words.map((w, i) => (
          <Card key={w.id} className="p-2 flex flex-col justify-center [container-type:size] min-h-0 overflow-hidden">
            <div className="text-[10px] text-slate-400">第 {i + 1} 题</div>
            <div className="font-bold text-slate-800 leading-tight [font-size:clamp(0.75rem,4.2cqh,2.25rem)] break-all">
              {subject === 'english' ? (w.chinese_meaning ?? '-') : (w.pinyin ?? '-')}
            </div>
          </Card>
        ))}
      </div>

      <div className="flex-shrink-0 py-2">
        <Button className="w-full" size="lg" onClick={() => navigate(`/challenge/dictation/${subject}/grade`)}>
          <CheckCircle className="w-5 h-5" />完成默写，去批改
        </Button>
      </div>
    </div>
  );
}
