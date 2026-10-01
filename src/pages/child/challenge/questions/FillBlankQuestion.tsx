import { useState, useRef, useEffect } from 'react';
import { cn } from '../../../../lib/utils';
import type { QuestionComponentProps } from './QuestionRenderer';

// 兼容 Question 与 WrongBattlePoolItem：仅依赖题干、正确答案、第二空答案
type FillBlankQuestionLike = { question_text: string; correct_answer: string; answer2?: string | null };

type FillBlankQuestionProps = Omit<QuestionComponentProps, 'question'> & { question: FillBlankQuestionLike };

// 标准化答案：去首尾空格、全角转半角
function normalizeAnswer(s: string): string {
  let result = '';
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    if (code === 12288) {
      result += ' ';
    } else if (code >= 65281 && code <= 65374) {
      result += String.fromCharCode(code - 65248);
    } else {
      result += ch;
    }
  }
  return result.trim();
}

// 检查单空答案是否匹配（支持 / 分隔的等价答案）
function checkAnswer(userAnswer: string, correctAnswer: string): boolean {
  const ua = normalizeAnswer(userAnswer);
  if (!ua) return false;
  const equivs = correctAnswer.split('/').map(s => normalizeAnswer(s));
  return equivs.includes(ua);
}

export function FillBlankQuestion({ question: q, answer, setAnswer, showResult, isCorrect, disabled }: FillBlankQuestionProps) {
  // 从 question_text 中按 ______ 分割
  const parts = q.question_text.split(/______/);
  const blankCount = parts.length - 1;

  // answer 格式：用 || 分隔各空答案
  const userAnswers = answer.split('||');

  // 数字键盘
  const [activeBlank, setActiveBlank] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const getBlankValue = (idx: number) => userAnswers[idx] ?? '';

  const setBlankValue = (idx: number, val: string) => {
    const next = [...userAnswers];
    while (next.length < idx) next.push('');
    next[idx] = val;
    setAnswer(next.join('||'));
  };

  // 数字键盘按键（含括号、省略号）
  const keys = ['7', '8', '9', '(', ')', '4', '5', '6', '+', '-', '1', '2', '3', '×', '÷', '0', '.', '……', '⌫'];

  const handleKey = (key: string) => {
    if (activeBlank === null) return;
    const current = getBlankValue(activeBlank);
    if (key === '⌫') {
      setBlankValue(activeBlank, current.slice(0, -1));
    } else {
      setBlankValue(activeBlank, current + key);
    }
  };

  // 结果页：展示正确答案
  const correctAnswers1 = (q.correct_answer ?? '').split('/');
  const correctAnswers2 = (q.answer2 ?? '').split('/');

  // 判断每空是否正确
  const blankResults = parts.slice(1).map((_, i) => {
    const ua = getBlankValue(i);
    if (i === 0) return checkAnswer(ua, q.correct_answer ?? '');
    if (i === 1) return checkAnswer(ua, q.answer2 ?? '');
    return false;
  });

  // 关闭键盘
  useEffect(() => {
    if (activeBlank !== null && inputRef.current) {
      inputRef.current.focus();
    }
  }, [activeBlank]);

  // 点击空白区域关闭键盘
  useEffect(() => {
    if (activeBlank === null) return;
    const handler = () => setActiveBlank(null);
    const timer = setTimeout(() => {
      document.addEventListener('click', handler);
    }, 100);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', handler);
    };
  }, [activeBlank]);

  return (
    <div className="space-y-4">
      {/* 题目 + 内联输入框 */}
      <div className="text-lg leading-relaxed text-slate-800 flex flex-wrap items-center gap-1">
        {parts.map((part, i) => (
          <span key={i}>
            <span>{part}</span>
            {i < blankCount && (
              <span
                onClick={(e) => { e.stopPropagation(); if (!disabled && !showResult) setActiveBlank(i); }}
                className={cn(
                  'inline-flex items-center justify-center min-w-[80px] px-2 py-0.5 mx-1 rounded-lg border-2 transition-colors',
                  showResult
                    ? blankResults[i]
                      ? 'border-emerald-400 bg-emerald-50 text-emerald-700'
                      : 'border-red-400 bg-red-50 text-red-700'
                    : activeBlank === i
                      ? 'border-star-400 bg-star-50'
                      : 'border-slate-300 bg-white cursor-pointer hover:border-star-300',
                  disabled && 'opacity-60 cursor-not-allowed'
                )}
              >
                {showResult && !blankResults[i] && !getBlankValue(i) ? (
                  <span className="text-red-500 text-sm font-medium">
                    {i === 0 ? correctAnswers1[0] : (i === 1 ? correctAnswers2[0] : '')}
                  </span>
                ) : (
                  getBlankValue(i) || <span className="text-slate-300 text-sm">&nbsp;</span>
                )}
              </span>
            )}
          </span>
        ))}
      </div>

      {/* 结果页展示正确答案 */}
      {showResult && !isCorrect && (
        <div className="bg-amber-50 rounded-lg p-3 space-y-1">
          <p className="text-xs text-amber-600 font-medium">正确答案：</p>
          {correctAnswers1.length > 0 && (
            <p className="text-sm text-emerald-700">第一空：{correctAnswers1.join(' 或 ')}</p>
          )}
          {correctAnswers2.length > 0 && (q.answer2 ?? '').length > 0 && (
            <p className="text-sm text-emerald-700">第二空：{correctAnswers2.join(' 或 ')}</p>
          )}
        </div>
      )}

      {/* 数字键盘 */}
      {activeBlank !== null && !showResult && (
        <div className="bg-slate-50 rounded-xl p-3" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-slate-500">第 {activeBlank + 1} 空</span>
            <button
              onClick={() => setActiveBlank(null)}
              className="text-xs text-slate-400 hover:text-slate-600"
            >
              收起
            </button>
          </div>
          <div className="grid grid-cols-5 gap-2">
            {keys.map(k => (
              <button
                key={k}
                onClick={() => handleKey(k)}
                className={cn(
                  'h-12 rounded-lg text-lg font-medium transition-colors',
                  k === '⌫'
                    ? 'bg-red-50 text-red-500 hover:bg-red-100'
                    : 'bg-white text-slate-700 hover:bg-star-50 border border-slate-200'
                )}
              >
                {k}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 隐藏的 input 用于移动端键盘兼容 */}
      <input
        ref={inputRef}
        type="text"
        value={activeBlank !== null ? getBlankValue(activeBlank) : ''}
        onChange={(e) => activeBlank !== null && setBlankValue(activeBlank, e.target.value)}
        className="sr-only"
        disabled={disabled}
      />
    </div>
  );
}
