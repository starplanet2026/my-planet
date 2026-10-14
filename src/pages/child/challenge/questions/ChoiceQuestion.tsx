import { useMemo, useState, useEffect } from 'react';
import { cn } from '../../../../lib/utils';
import type { QuestionComponentProps } from './QuestionRenderer';

interface ChoiceQuestionProps extends Omit<QuestionComponentProps, 'question'> {
  question: {
    id?: string;
    question_id?: string;
    type: string;
    options: string[] | null;
    correct_answer: string;
  };
  shuffleOptions?: boolean;
}

export function ChoiceQuestion({ question: q, answer, setAnswer, showResult, shuffleOptions = true }: ChoiceQuestionProps) {
  const isMulti = q.type === 'multi_choice';

  // 兼容 correct_answer 可能存的是字母（A/C）或选项文本（多选以 || 拼接）
  // 正则要求字母后有分隔符(. 或 、)才剥离前缀，避免 "buys" 被误删首字母
  const correctLetters = useMemo(() => {
    const ca = (q.correct_answer || '').trim();
    const upper = ca.toUpperCase();
    if (/^[A-H]+$/.test(upper)) return upper.split('');
    // 按选项文本匹配对应字母（多选 correct_answer 以 || 拼接多个正确选项原文）
    const correctTexts = ca.split('||').map(s => s.trim().toLowerCase());
    return (q.options || [])
      .map((opt, i) => {
        const optText = opt.replace(/^[A-Ha-h][.、]\s*/, '').trim().toLowerCase();
        return correctTexts.includes(optText) ? String.fromCharCode(65 + i) : null;
      })
      .filter(Boolean) as string[];
  }, [q.correct_answer, q.options]);

  // 选项乱序：每次题目变化时用 Math.random 生成随机顺序
  const [shuffledIndices, setShuffledIndices] = useState<number[]>([]);
  useEffect(() => {
    if (!q.options) { setShuffledIndices([]); return; }
    if (!shuffleOptions) { setShuffledIndices(q.options.map((_, i) => i)); return; }
    const indices = q.options.map((_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    setShuffledIndices(indices);
  }, [q.id, (q as any).question_id, shuffleOptions, q.options]);

  // 注意：提前 return 必须放在所有 Hooks 之后，否则 Hooks 数量前后不一致会导致 React 崩溃白屏
  if (!q.options) return null;

  return (
    <div className="space-y-3">
      {shuffledIndices.map((origIdx, displayIdx) => {
        const opt = q.options![origIdx];
        const letter = String.fromCharCode(65 + displayIdx);
        const origLetter = String.fromCharCode(65 + origIdx);
        const isSelected = isMulti ? answer.includes(origLetter) : answer === origLetter;
        const isRightAnswer = showResult && correctLetters.includes(origLetter);
        const isWrongPick = showResult && isSelected && !correctLetters.includes(origLetter);

        const toggle = () => {
          if (showResult) return;
          if (isMulti) {
            setAnswer(answer.includes(origLetter) ? answer.replace(origLetter, '') : answer + origLetter);
          } else {
            setAnswer(origLetter);
          }
        };

        return (
          <button
            key={origIdx}
            onClick={toggle}
            className={cn(
              'w-full p-4 rounded-xl border-2 text-left transition-colors flex items-center',
              isRightAnswer ? 'border-emerald-400 bg-emerald-50' :
              isWrongPick ? 'border-red-400 bg-red-50' :
              isSelected ? 'border-star-400 bg-star-50' : 'border-slate-200 hover:border-star-200'
            )}
          >
            <span className={cn(
              'w-6 h-6 rounded-full border-2 flex items-center justify-center text-xs font-bold mr-3 flex-shrink-0',
              isSelected ? 'bg-star-500 text-white border-star-500' : 'border-slate-300 text-slate-400'
            )}>
              {isMulti && isSelected ? '✓' : letter}
            </span>
            <span className="flex-1 text-lg">{opt.replace(/^[A-H][.、]\s*/, '')}</span>
          </button>
        );
      })}
    </div>
  );
}
