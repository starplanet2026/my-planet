import { cn } from '../../../../lib/utils';
import type { QuestionComponentProps } from './QuestionRenderer';

export function ChoiceQuestion({ question: q, answer, setAnswer, showResult }: QuestionComponentProps) {
  if (!q.options) return null;
  const isMulti = q.type === 'multi_choice';
  // 后端 correct_answer 存字母如 "A" 或 "BD"
  const correctLetters = (q.correct_answer || '').toUpperCase().split('');

  return (
    <div className="space-y-3">
      {q.options.map((opt, i) => {
        const letter = String.fromCharCode(65 + i);
        const isSelected = isMulti ? answer.includes(letter) : answer === letter;
        const isRightAnswer = showResult && correctLetters.includes(letter);
        const isWrongPick = showResult && isSelected && !correctLetters.includes(letter);

        const toggle = () => {
          if (showResult) return;
          if (isMulti) {
            setAnswer(answer.includes(letter) ? answer.replace(letter, '') : answer + letter);
          } else {
            setAnswer(letter);
          }
        };

        return (
          <button
            key={i}
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
