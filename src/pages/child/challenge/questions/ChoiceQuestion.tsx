import { useMemo } from 'react';
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
  if (!q.options) return null;
  const isMulti = q.type === 'multi_choice';
  const correctLetters = (q.correct_answer || '').toUpperCase().split('');

  // 选项乱序：按题目 id 生成稳定的随机顺序
  const shuffledIndices = useMemo(() => {
    if (!shuffleOptions) return q.options!.map((_, i) => i);
    // 兼容 Question(id) 和 WrongBattlePoolItem(question_id)
    const qid = (q as any).id ?? (q as any).question_id ?? '';
    const seed = qid.split('').reduce((acc: number, c: string) => acc + c.charCodeAt(0), 0);
    const indices = q.options!.map((_, i) => i);
    // Fisher-Yates shuffle with seeded random
    let s = seed;
    const rand = () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    return indices;
  }, [q.options, shuffleOptions, q.id, (q as any).question_id]);

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
            <span className="flex-1">{opt.replace(/^[A-H][.、]\s*/, '')}</span>
          </button>
        );
      })}
    </div>
  );
}
