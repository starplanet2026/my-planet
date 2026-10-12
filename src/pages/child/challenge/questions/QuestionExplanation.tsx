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
// 答错：红色，逐行出现 + "我已学会"按钮（点击后才能下一题）
export function QuestionExplanation({ show, isCorrect, explanation, correctAnswer, learned, onLearned }: QuestionExplanationProps) {
  const [revealedLines, setRevealedLines] = useState(0);
  const lines = explanation ? explanation.split('\n').filter(l => l.trim()) : [];

  // 答错时逐行展示解析
  useEffect(() => {
    if (!show || isCorrect) {
      setRevealedLines(lines.length);
      return;
    }
    setRevealedLines(0);
    if (lines.length === 0) return;
    let i = 0;
    const timer = setInterval(() => {
      i++;
      setRevealedLines(i);
      if (i >= lines.length) clearInterval(timer);
    }, 400);
    return () => clearInterval(timer);
  }, [show, isCorrect, lines.length]);

  if (!show) return null;

  return (
    <div className={cn(
      'flex flex-col rounded-xl border-2 p-4 h-full',
      isCorrect ? 'border-emerald-300 bg-emerald-50' : 'border-red-300 bg-red-50'
    )}>
      <p className={cn(
        'text-base font-bold mb-2',
        isCorrect ? 'text-emerald-600' : 'text-red-600'
      )}>
        {isCorrect ? '✅ 回答正确！' : `❌ 正确答案：${correctAnswer}`}
      </p>
      {explanation && (
        <div className={cn(
          'flex-1 overflow-y-auto text-base leading-relaxed',
          isCorrect ? 'text-emerald-700' : 'text-red-700'
        )}>
          {isCorrect ? (
            <p>{explanation}</p>
          ) : (
            lines.slice(0, revealedLines).map((line, i) => (
              <p key={i} className="mb-1">{line}</p>
            ))
          )}
        </div>
      )}
      {!isCorrect && (
        <button
          onClick={onLearned}
          disabled={learned}
          className={cn(
            'mt-3 px-4 py-2 rounded-lg font-medium text-sm transition-colors',
            learned
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
