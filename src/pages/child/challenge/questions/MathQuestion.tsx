import { useState, useRef, useEffect } from 'react';
import { cn } from '../../../../lib/utils';
import type { QuestionComponentProps } from './QuestionRenderer';

// 数字键盘按键（含括号、小数点、省略号、加减乘除、退格）
const KEYS = ['7', '8', '9', '(', ')', '4', '5', '6', '+', '-', '1', '2', '3', '×', '÷', '0', '.', '……', '⌫'];

// MathQuestion 兼容 Question 与 WrongBattlePoolItem：仅依赖题干与正确答案
type MathQuestionLike = { question_text: string; correct_answer: string; id?: string; question_id?: string };

type MathQuestionProps = Omit<QuestionComponentProps, 'question'> & { question: MathQuestionLike };

export function MathQuestion({ question: q, answer, setAnswer, showResult, isCorrect, disabled }: MathQuestionProps) {
  const [showKeypad, setShowKeypad] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const qid = q.id ?? q.question_id ?? q.question_text;

  const handleKey = (key: string) => {
    if (key === '⌫') {
      setAnswer(answer.slice(0, -1));
    } else {
      setAnswer(answer + key);
    }
  };

  // 结果页正确答案（支持 / 分隔等价答案）
  const correctAnswers = (q.correct_answer ?? '').split('/');

  // 自动弹起键盘：进入答题时默认展开，方便直接输入
  useEffect(() => {
    if (!showResult && !disabled) {
      setShowKeypad(true);
    }
  }, [showResult, disabled, qid]);

  return (
    <div className="space-y-4">
      {/* 题干 */}
      <p className="text-lg leading-relaxed text-slate-800">{q.question_text}</p>

      {/* 答案输入展示区 */}
      <div
        onClick={(e) => { e.stopPropagation(); if (!disabled && !showResult) setShowKeypad(true); }}
        className={cn(
          'min-h-[56px] px-4 py-3 rounded-xl border-2 text-2xl text-center font-medium transition-colors cursor-pointer',
          showResult
            ? isCorrect
              ? 'border-emerald-400 bg-emerald-50 text-emerald-700'
              : 'border-red-400 bg-red-50 text-red-700'
            : showKeypad
              ? 'border-star-400 bg-star-50 text-slate-800'
              : 'border-slate-300 bg-white text-slate-800 hover:border-star-300',
          disabled && 'opacity-60 cursor-not-allowed'
        )}
      >
        {showResult && !isCorrect && !answer ? (
          <span className="text-red-500 text-base">{correctAnswers[0]}</span>
        ) : (
          answer || <span className="text-slate-300 text-base">点击输入答案</span>
        )}
      </div>

      {/* 结果页展示正确答案 */}
      {showResult && !isCorrect && (
        <div className="bg-amber-50 rounded-lg p-3 space-y-1">
          <p className="text-xs text-amber-600 font-medium">正确答案：</p>
          <p className="text-sm text-emerald-700">{correctAnswers.join(' 或 ')}</p>
        </div>
      )}

      {/* 自定义数字键盘（含 数字/小数点/省略号/加减乘除/括号/退格） */}
      {showKeypad && !showResult && (
        <div className="bg-slate-50 rounded-xl p-3" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-slate-500">数学输入键盘</span>
            <button
              onClick={() => setShowKeypad(false)}
              className="text-xs text-slate-400 hover:text-slate-600"
            >
              收起
            </button>
          </div>
          <div className="grid grid-cols-5 gap-2">
            {KEYS.map(k => (
              <button
                key={k}
                onClick={() => handleKey(k)}
                className={cn(
                  'h-12 rounded-lg text-lg font-medium transition-colors',
                  k === '⌫'
                    ? 'bg-red-50 text-red-500 hover:bg-red-100'
                    : k === '×' || k === '÷' || k === '+' || k === '-'
                      ? 'bg-star-50 text-star-600 hover:bg-star-100 border border-star-200'
                      : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
                )}
              >
                {k}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 隐藏 input 用于移动端系统键盘兼容（type=text 允许任意字符） */}
      <input
        ref={inputRef}
        type="text"
        inputMode="text"
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        className="sr-only"
        disabled={disabled}
      />
    </div>
  );
}
