import { useEffect, useState } from 'react';
import { cn } from '../../../../lib/utils';

interface QuestionExplanationProps {
  show: boolean;
  isCorrect: boolean;
  explanation: string | null;
  correctAnswer: string;
  learned: boolean;
  onLearned: () => void;
}

// 答案解析区域：固定在题目右侧
// 答对：绿色，文字一次性全部出现
// 答错：红色，逐字出现 + "我已学会"按钮（点击后才能下一题）
export function QuestionExplanation({ show, isCorrect, explanation, correctAnswer, learned, onLearned }: QuestionExplanationProps) {
  const [revealedChars, setRevealedChars] = useState(0);

  const fullText = explanation ?? '';

  // 答错时逐字展示解析
  useEffect(() => {
    if (!show || isCorrect) {
      setRevealedChars(fullText.length);
      return;
    }
    setRevealedChars(0);
    if (fullText.length === 0) return;
    let i = 0;
    const timer = setInterval(() => {
      i++;
      setRevealedChars(i);
      if (i >= fullText.length) clearInterval(timer);
    }, 30);
    return () => clearInterval(timer);
  }, [show, isCorrect, fullText]);

  if (!show) return null;

  return (
    <div className={cn(
      'flex flex-col rounded-xl border-2 p-4 h-full',
      isCorrect ? 'border-emerald-300 bg-emerald-50' : 'border-red-300 bg-red-50'
    )}>
      <p className={cn(
        'text-lg font-bold mb-2',
        isCorrect ? 'text-emerald-600' : 'text-red-600'
      )}>
        {isCorrect ? '✅ 回答正确！' : `❌ 正确答案：${correctAnswer}`}
      </p>
      {explanation && (
        <div className={cn(
          'flex-1 overflow-y-auto text-lg leading-relaxed',
          isCorrect ? 'text-emerald-700' : 'text-red-700'
        )}>
          {isCorrect ? (
            <p className="whitespace-pre-wrap">{explanation}</p>
          ) : (
            <p className="whitespace-pre-wrap">
              {fullText.slice(0, revealedChars)}
              {revealedChars < fullText.length && (
                <span className="animate-pulse">▌</span>
              )}
            </p>
          )}
        </div>
      )}
      {!isCorrect && (
        <button
          onClick={onLearned}
          disabled={learned || revealedChars < fullText.length}
          className={cn(
            'mt-3 px-4 py-2 rounded-lg font-medium text-sm transition-colors',
            learned || revealedChars < fullText.length
              ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
              : 'bg-red-500 text-white hover:bg-red-600'
          )}
        >
          {learned ? '已学会 ✓' : '我已学会'}
        </button>
      )}
    </div>
  );
}
