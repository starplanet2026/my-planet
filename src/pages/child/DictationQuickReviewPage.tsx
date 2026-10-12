import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFamilyStore } from '../../store/familyStore';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Modal } from '../../components/common/Modal';
import { Loading } from '../../components/common/Loading';
import { useToastStore } from '../../store/toastStore';
import { cn } from '../../lib/utils';
import { CheckCircle, XCircle, RotateCcw, ChevronLeft, Flag } from 'lucide-react';
import {
  listTaskWords, judgeQuickReviewWord, listQuickReviewRecords, updateTaskStatus,
} from '../../api/dictation';
import type { DictationTask, DictationTaskWord, DictationSubject } from '../../api/types';

interface Props {
  task: DictationTask;
  subject: DictationSubject;
  childId: string;
}

// 词条判题状态
type WordStatus = 'correct' | 'incorrect';

export function DictationQuickReviewPage({ task, subject, childId }: Props) {
  const navigate = useNavigate();
  const refreshMembers = useFamilyStore(s => s.refreshMembers);
  const toast = useToastStore();

  // 全部词条（第1轮）
  const [allWords, setAllWords] = useState<DictationTaskWord[]>([]);
  // 当前轮次的词条
  const [roundWords, setRoundWords] = useState<DictationTaskWord[]>([]);
  const [loading, setLoading] = useState(true);
  const [round, setRound] = useState(1);

  // 当前展开答案的卡片 ID
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // 本轮判题缓存（task_word_id -> status）
  const [judgedWords, setJudgedWords] = useState<Map<string, WordStatus>>(new Map());
  const [judging, setJudging] = useState(false);

  // 完成弹窗（按轮次控制，避免无限弹出）
  const [showComplete, setShowComplete] = useState(false);
  const [completedRounds, setCompletedRounds] = useState<Set<number>>(new Set());

  // 累计实际获得的星光值（按后端递减后的实际值累加）
  const [totalGainedStar, setTotalGainedStar] = useState(0);

  const subjectLabel = subject === 'english' ? '英语' : '语文';

  // 加载词条 + 恢复已持久化的判题记录
  useEffect(() => {
    setLoading(true);
    Promise.all([
      listTaskWords(task.id),
      listQuickReviewRecords(task.id, childId).catch(() => []),
    ]).then(([words, records]) => {
      setAllWords(words);
      setRoundWords(words);
      // 恢复判题状态
      const restored = new Map<string, WordStatus>();
      records.forEach(r => {
        restored.set(r.task_word_id, r.is_correct ? 'correct' : 'incorrect');
      });
      setJudgedWords(restored);
    }).catch(e => toast.error('加载失败：' + e.message))
      .finally(() => setLoading(false));
  }, [task.id, childId]);

  // 本轮错题列表
  const errorWordIds = useMemo(() => {
    const ids: string[] = [];
    judgedWords.forEach((status, id) => {
      if (status === 'incorrect') ids.push(id);
    });
    return ids;
  }, [judgedWords]);

  const judgedCount = judgedWords.size;
  const totalWords = roundWords.length;
  const correctCount = useMemo(() => {
    let c = 0;
    judgedWords.forEach(s => { if (s === 'correct') c++; });
    return c;
  }, [judgedWords]);
  const errorCount = errorWordIds.length;

  // 本轮是否全部判完
  const allJudged = totalWords > 0 && judgedCount === totalWords;
  // 本轮错题是否清零
  const noErrors = errorCount === 0;
  // 是否可点击复习完成（全部判完且无错题）
  const canFinish = allJudged && noErrors;
  // 是否可点击复习本轮错题（全部判完且有错题）
  const canReviewErrors = allJudged && !noErrors;

  // ✅❌ 按钮激活条件：已展开答案 && 该卡未判 && 非判题中
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
      const result = await judgeQuickReviewWord(
        task.id, childId, word, subject, isCorrect, task.star_per_word, round,
      );
      if (!result.success) {
        toast.error(result.message);
        return;
      }
      setJudgedWords(prev => {
        const next = new Map(prev);
        next.set(expandedId, isCorrect ? 'correct' : 'incorrect');
        return next;
      });
      if (isCorrect) {
        const gained = result.new_star;
        setTotalGainedStar(prev => prev + gained);
        toast.success(gained > 0 ? `✅ 正确 +${gained}星光` : '✅ 正确（已无额外星光奖励）');
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

  // 复习本轮错题（进入下一轮）
  const reviewErrors = () => {
    if (errorCount === 0) return;
    const errorWords = roundWords.filter(w => errorWordIds.includes(w.id));
    setRoundWords(errorWords);
    setJudgedWords(new Map());
    setExpandedId(null);
    setRound(r => r + 1);
    setShowComplete(false);
  };

  // 本轮全部判完 → 弹出完成弹窗（每轮只弹一次）
  useEffect(() => {
    if (allJudged && !showComplete && !completedRounds.has(round)) {
      setShowComplete(true);
      setCompletedRounds(prev => new Set(prev).add(round));
    }
  }, [allJudged, showComplete, completedRounds, round]);

  // 点击「复习完成」：标记任务结束，前端入口隐藏
  const finishReview = async () => {
    try {
      await updateTaskStatus(task.id, 'completed');
      toast.success('复习已完成');
      navigate('/challenge');
    } catch (e: any) {
      toast.error('操作失败：' + e.message);
    }
  };

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
        {/* 复习本轮错题 / 复习完成 按钮 */}
        {canFinish ? (
          <Button
            size="lg"
            className="w-full"
            onClick={finishReview}
          >
            <Flag className="w-4 h-4" />
            复习完成
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="lg"
            className="w-full"
            disabled={!canReviewErrors || judging}
            onClick={reviewErrors}
          >
            <RotateCcw className="w-4 h-4" />
            复习本轮错题（{errorCount}）
          </Button>
        )}
        {!buttonsActive && expandedId === null && !allJudged && (
          <p className="text-xs text-center text-slate-400">点击卡片查看答案后判题</p>
        )}
      </div>

      {/* 完成弹窗 */}
      <Modal
        open={showComplete}
        onClose={() => setShowComplete(false)}
        title={noErrors ? '全部完成' : '本轮完成'}
      >
        <div className="text-center py-4">
          <div className="text-5xl mb-3">{noErrors ? '🎉' : '📝'}</div>
          <p className="text-lg mb-1">
            正确 <span className="text-emerald-600 font-bold">{correctCount}</span> / {totalWords} 条
          </p>
          <p className="text-rose-500 mb-1">错题 <span className="font-bold">{errorCount}</span> 条</p>
          <p className="text-slate-500 text-sm">获得 <span className="text-amber-500 font-bold">{totalGainedStar}</span> 星光值</p>
        </div>
        <div className="flex gap-2 justify-end pt-2">
          {noErrors ? (
            <Button onClick={() => { setShowComplete(false); }}>
              <CheckCircle className="w-4 h-4" />知道了
            </Button>
          ) : (
            <>
              <Button variant="secondary" onClick={() => setShowComplete(false)}>稍后复习</Button>
              <Button onClick={() => { setShowComplete(false); reviewErrors(); }}>
                <RotateCcw className="w-4 h-4" />复习错题
              </Button>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}
