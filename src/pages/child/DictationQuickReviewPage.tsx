import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFamilyStore } from '../../store/familyStore';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Modal } from '../../components/common/Modal';
import { Loading } from '../../components/common/Loading';
import { useToastStore } from '../../store/toastStore';
import { cn } from '../../lib/utils';
import { CheckCircle, XCircle, RotateCcw, ChevronLeft } from 'lucide-react';
import { listTaskWords, judgeQuickReviewWord } from '../../api/dictation';
import type { DictationTask, DictationTaskWord, DictationSubject } from '../../api/types';

interface Props {
  task: DictationTask;
  subject: DictationSubject;
  childId: string;
}

// 本轮会话缓存中的词条状态
type WordStatus = 'correct' | 'incorrect';

export function DictationQuickReviewPage({ task, subject, childId }: Props) {
  const navigate = useNavigate();
  const refreshMembers = useFamilyStore(s => s.refreshMembers);
  const toast = useToastStore();

  const [allWords, setAllWords] = useState<DictationTaskWord[]>([]);
  // 当前轮次的词条（Round 1 = 全部，Round 2+ = 上一轮错题）
  const [roundWords, setRoundWords] = useState<DictationTaskWord[]>([]);
  const [loading, setLoading] = useState(true);
  const [round, setRound] = useState(1);

  // 当前展开答案的卡片 ID
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // 本轮会话缓存：记录每条词条判题状态
  const [judgedWords, setJudgedWords] = useState<Map<string, WordStatus>>(new Map());
  const [judging, setJudging] = useState(false);

  // 完成弹窗
  const [showComplete, setShowComplete] = useState(false);

  useEffect(() => {
    setLoading(true);
    listTaskWords(task.id)
      .then(words => {
        setAllWords(words);
        setRoundWords(words);
      })
      .catch(e => toast.error('加载失败：' + e.message))
      .finally(() => setLoading(false));
  }, [task.id]);

  const subjectLabel = subject === 'english' ? '英语' : '语文';

  // 本轮错题列表
  const errorWordIds = useMemo(() => {
    const ids: string[] = [];
    judgedWords.forEach((status, id) => {
      if (status === 'incorrect') ids.push(id);
    });
    return ids;
  }, [judgedWords]);

  // 本轮已判题数
  const judgedCount = judgedWords.size;
  const totalWords = roundWords.length;
  const correctCount = useMemo(() => {
    let c = 0;
    judgedWords.forEach(s => { if (s === 'correct') c++; });
    return c;
  }, [judgedWords]);
  const errorCount = errorWordIds.length;

  // 是否全部判完
  const allJudged = totalWords > 0 && judgedCount === totalWords;

  // ✅❌ 按钮是否激活
  const buttonsActive = expandedId !== null && !judgedWords.has(expandedId) && !judging;

  // 点击卡片展开/收起
  const toggleExpand = (id: string) => {
    if (judging) return;
    setExpandedId(prev => prev === id ? null : id);
  };

  // 判题
  const judge = async (isCorrect: boolean) => {
    if (!expandedId || judgedWords.has(expandedId) || judging) return;
    const word = roundWords.find(w => w.id === expandedId);
    if (!word) return;

    setJudging(true);
    try {
      const result = await judgeQuickReviewWord(task.id, childId, word, subject, isCorrect, task.star_per_word);
      if (!result.success) {
        toast.error(result.message);
        return;
      }
      // 更新会话缓存
      setJudgedWords(prev => {
        const next = new Map(prev);
        next.set(expandedId, isCorrect ? 'correct' : 'incorrect');
        return next;
      });
      if (isCorrect) {
        toast.success(`✅ 正确 +${task.star_per_word}星光`);
        await refreshMembers();
      } else {
        toast.success('❌ 已加入错词库');
      }
    } catch (e: any) {
      toast.error('判题失败：' + e.message);
    } finally {
      setJudging(false);
    }
  };

  // 复习本轮错题
  const reviewErrors = () => {
    if (errorWordIds.length === 0) return;
    const errorWords = roundWords.filter(w => errorWordIds.includes(w.id));
    setRoundWords(errorWords);
    setJudgedWords(new Map());
    setExpandedId(null);
    setRound(r => r + 1);
    setShowComplete(false);
  };

  // 全部判完时自动弹出完成弹窗
  useEffect(() => {
    if (allJudged && !showComplete) {
      setShowComplete(true);
    }
  }, [allJudged, showComplete]);

  if (loading) return <Loading />;

  return (
    <div className="h-[calc(100dvh-4rem-4rem-env(safe-area-inset-bottom))] -mt-6 -mb-24 -mx-4 sm:-mx-6 lg:-mx-8 px-2 sm:px-4 flex flex-col overflow-hidden">
      {/* 顶部信息栏 */}
      <div className="flex-shrink-0 flex items-center justify-between py-2 px-2">
        <div className="flex items-center gap-2">
          <button onClick={() => navigate('/challenge')} className="p-1 hover:bg-slate-100 rounded-lg">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="text-sm font-bold text-slate-700">⚡{subjectLabel}快速复习</span>
          <span className="text-xs text-slate-400">第{round}轮</span>
        </div>
        <div className="text-xs text-slate-500">
          已判 <span className="text-emerald-600 font-bold">{correctCount}</span> 正确
          <span className="mx-1">·</span>
          <span className="text-rose-500 font-bold">{errorCount}</span> 错误
          <span className="mx-1">·</span>
          共 {totalWords} 条
        </div>
      </div>

      {/* 卡片区域 */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 pb-4">
          {roundWords.map((w, i) => {
            const isExpanded = expandedId === w.id;
            const status = judgedWords.get(w.id);
            const prompt = subject === 'english' ? (w.chinese_meaning ?? '-') : (w.pinyin ?? '-');
            return (
              <Card
                key={w.id}
                onClick={() => toggleExpand(w.id)}
                className={cn(
                  'p-2 flex flex-col justify-center items-center text-center transition-all cursor-pointer w-full min-h-[140px]',
                  isExpanded && 'ring-2 ring-blue-400 shadow-md',
                  status === 'correct' && 'bg-emerald-50 border-emerald-300',
                  status === 'incorrect' && 'bg-rose-50 border-rose-300',
                )}
              >
                <div className="flex items-center justify-between w-full">
                  <div className="text-[15px] text-slate-400">{i + 1}</div>
                  {status === 'correct' && <CheckCircle className="w-4 h-4 text-emerald-500" />}
                  {status === 'incorrect' && <XCircle className="w-4 h-4 text-rose-500" />}
                </div>
                <div className="font-bold text-slate-800 leading-tight text-[21px] break-all whitespace-normal">
                  {prompt}
                </div>
                {isExpanded && (
                  <div className="text-blue-600 font-extrabold leading-tight mt-1 text-[18px] break-all whitespace-normal border-t border-blue-100 pt-1">
                    {w.answer}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      </div>

      {/* 底部操作栏 */}
      <div className="flex-shrink-0 pt-2 space-y-2">
        {/* ✅❌ 按钮行 */}
        <div className="flex items-center gap-2">
          <Button
            variant="success"
            size="lg"
            className="flex-1"
            disabled={!buttonsActive}
            onClick={() => judge(true)}
          >
            <CheckCircle className="w-5 h-5" />✅ 正确
          </Button>
          <Button
            variant="danger"
            size="lg"
            className="flex-1"
            disabled={!buttonsActive}
            onClick={() => judge(false)}
          >
            <XCircle className="w-5 h-5" />❌ 错误
          </Button>
        </div>
        {/* 复习本轮错题按钮 */}
        <Button
          variant="secondary"
          size="lg"
          className="w-full"
          disabled={errorCount === 0 || judging}
          onClick={reviewErrors}
        >
          <RotateCcw className="w-4 h-4" />
          复习本轮错题（{errorCount}）
        </Button>
        {!buttonsActive && expandedId === null && !allJudged && (
          <p className="text-xs text-center text-slate-400">点击卡片查看答案后判题</p>
        )}
      </div>

      {/* 完成弹窗 */}
      <Modal
        open={showComplete}
        onClose={() => {
          if (errorCount > 0) {
            setShowComplete(false);
          } else {
            navigate('/challenge');
          }
        }}
        title={errorCount > 0 ? '本轮完成' : '全部完成'}
      >
        <div className="text-center py-4">
          <div className="text-5xl mb-3">{errorCount > 0 ? '📝' : '🎉'}</div>
          <p className="text-lg mb-1">
            正确 <span className="text-emerald-600 font-bold">{correctCount}</span> / {totalWords} 条
          </p>
          <p className="text-rose-500 mb-1">错题 <span className="font-bold">{errorCount}</span> 条</p>
          <p className="text-slate-500 text-sm">获得 <span className="text-amber-500 font-bold">{correctCount * task.star_per_word}</span> 星光值</p>
          {errorCount > 0 && (
            <p className="text-xs text-slate-400 mt-3">可点击「复习本轮错题」继续循环复习</p>
          )}
        </div>
        <div className="flex gap-2 justify-end pt-2">
          {errorCount > 0 ? (
            <>
              <Button variant="secondary" onClick={() => navigate('/challenge')}>返回</Button>
              <Button onClick={() => { setShowComplete(false); }}>
                <RotateCcw className="w-4 h-4" />复习错题
              </Button>
            </>
          ) : (
            <Button onClick={() => navigate('/challenge')}>
              <CheckCircle className="w-4 h-4" />完成
            </Button>
          )}
        </div>
      </Modal>
    </div>
  );
}
