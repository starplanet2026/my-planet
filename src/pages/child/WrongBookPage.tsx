import { useState, useEffect } from 'react';
import { useFamilyStore } from '../../store/familyStore';
import { useModeStore } from '../../store/modeStore';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { EmptyState } from '../../components/common/EmptyState';
import { Loading } from '../../components/common/Loading';
import { useToastStore } from '../../store/toastStore';
import { cn } from '../../lib/utils';
import { ArrowLeft, Check, X } from 'lucide-react';
import { fetchWrongQuestions, reviewWrongQuestion } from '../../api/challenges';
import type { WrongQuestion } from '../../api/types';

export function WrongBookPage() {
  const members = useFamilyStore(s => s.members);
  const currentChildId = useModeStore(s => s.currentChildId);
  const refreshMembers = useFamilyStore(s => s.refreshMembers);
  const child = members.find(m => m.id === currentChildId && m.role === 'child') ?? members.find(m => m.role === 'child');
  const toast = useToastStore();

  const [wrongs, setWrongs] = useState<WrongQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeWrong, setActiveWrong] = useState<WrongQuestion | null>(null);

  const load = async () => {
    if (!child) return;
    setLoading(true);
    try {
      setWrongs(await fetchWrongQuestions(child.id));
    } catch (e: any) {
      toast.error(e?.message ?? '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [child?.id]);

  if (loading) return <Loading />;

  if (activeWrong) {
    return <ReviewWrong wrong={activeWrong} childId={child?.id ?? ''} onBack={() => { setActiveWrong(null); load(); }} onReviewed={refreshMembers} />;
  }

  return (
    <div className="max-w-4xl mx-auto -mt-6">
      <div className="flex items-center gap-3 mb-6">
        <h1 className="text-2xl font-bold text-slate-800">错题本</h1>
        <span className="text-sm text-slate-400">共 {wrongs.length} 题</span>
      </div>

      {wrongs.length === 0 ? (
        <EmptyState icon="🎉" title="暂无错题" description="继续加油，保持全对！" />
      ) : (
        <div className="space-y-3">
          {wrongs.map(w => {
            const isWord = !!w.word;
            const content = isWord ? w.word!.word_en : w.question?.question_text ?? '已删除';
            return (
              <Card key={w.id} className="p-4 cursor-pointer hover:shadow-md transition-shadow" onClick={() => setActiveWrong(w)}>
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-slate-800 line-clamp-2">{content}</p>
                    {isWord && <p className="text-sm text-slate-400 mt-1">{w.word?.word_cn}</p>}
                  </div>
                  <div className="flex items-center gap-2 ml-3 flex-shrink-0">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-500">
                      错 {w.wrong_count} 次
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-500">
                      对 {w.correct_count}/2
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

// ====== 复习错题 ======
function ReviewWrong({ wrong, childId, onBack, onReviewed }: {
  wrong: WrongQuestion; childId: string; onBack: () => void; onReviewed: () => void;
}) {
  const [answer, setAnswer] = useState('');
  const [showResult, setShowResult] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const toast = useToastStore();

  const isWord = !!wrong.word;
  const correctAnswer = isWord ? wrong.word!.word_en : wrong.question?.correct_answer ?? '';

  const handleSubmit = async () => {
    if (!answer.trim()) return;
    setSubmitting(true);
    try {
      const correct = answer.trim().toLowerCase() === correctAnswer.trim().toLowerCase();
      setIsCorrect(correct);
      setShowResult(true);
      const result = await reviewWrongQuestion(wrong.id, childId, correct);
      onReviewed();
      if (correct) {
        if (result.removed) {
          toast.success('🎉 已掌握，移出错题本');
        } else {
          toast.success(`答对了，再答对 ${2 - wrong.correct_count - 1} 次即可移除`);
        }
      } else {
        toast.error(`答错了，正确答案：${correctAnswer}`);
      }
    } catch (e: any) {
      toast.error(e?.message ?? '提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto -mt-6">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-lg">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h2 className="text-xl font-bold text-slate-800">复习错题</h2>
      </div>

      <Card className="p-6">
        <div className="mb-6">
          {isWord ? (
            <>
              <p className="text-sm text-slate-400 mb-2">请输入英文：</p>
              <p className="text-3xl font-bold text-slate-700">{wrong.word?.word_cn}</p>
            </>
          ) : (
            <>
              <p className="text-sm text-slate-400 mb-2">题目：</p>
              <p className="text-lg font-medium text-slate-800">{wrong.question?.question_text}</p>
              {wrong.question?.options && (
                <div className="mt-2 space-y-1">
                  {wrong.question.options.map((opt, i) => (
                    <p key={i} className="text-sm text-slate-600">{opt}</p>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <Input
          value={answer}
          onChange={e => setAnswer(e.target.value)}
          placeholder={isWord ? '输入英文单词' : wrong.question?.type === 'choice' ? '输入选项字母' : '输入答案'}
          className="text-xl py-3"
          disabled={showResult}
        />

        {showResult && wrong.question?.explanation && (
          <div className="mt-4 p-3 rounded-xl bg-slate-50">
            <p className="text-sm text-slate-600">解析：{wrong.question.explanation}</p>
          </div>
        )}

        <div className="mt-6">
          {!showResult ? (
            <Button onClick={handleSubmit} loading={submitting} fullWidth disabled={!answer.trim()}>
              提交答案
            </Button>
          ) : (
            <Button onClick={onBack} fullWidth>
              返回错题本
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}
