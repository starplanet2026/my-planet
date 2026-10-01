import type { Question } from '../../../../api/types';
import { ChoiceQuestion } from './ChoiceQuestion';
import { SpellQuestion } from './SpellQuestion';
import { MatchQuestion } from './MatchQuestion';
import { ScrambleQuestion } from './ScrambleQuestion';
import { ReciteQuestion } from './ReciteQuestion';
import { CorrectQuestion } from './CorrectQuestion';
import { FillBlankQuestion } from './FillBlankQuestion';
import { MathQuestion } from './MathQuestion';

export interface QuestionComponentProps {
  question: Question;
  answer: string;
  setAnswer: (a: string) => void;
  showResult: boolean;
  isCorrect: boolean;
  disabled?: boolean;
}

export function QuestionRenderer(props: QuestionComponentProps) {
  const { question: q } = props;
  switch (q.type) {
    case 'choice':
    case 'multi_choice':
      return <ChoiceQuestion {...props} />;
    case 'fill_blank':
      return <FillBlankQuestion {...props} />;
    case 'math':
      return <MathQuestion {...props} />;
    case 'spell':
      return <SpellQuestion {...props} />;
    case 'match':
      return <MatchQuestion {...props} />;
    case 'scramble':
      return <ScrambleQuestion {...props} />;
    case 'recite':
      return <ReciteQuestion {...props} />;
    case 'correct':
      return <CorrectQuestion {...props} />;
    default:
      // 其他未知类型兜底：纯文本输入
      return (
        <input
          type="text"
          value={props.answer}
          onChange={e => props.setAnswer(e.target.value)}
          placeholder="输入答案"
          className="w-full text-2xl text-center py-4 rounded-xl border-2 border-slate-300 focus:border-star-400 focus:outline-none"
          disabled={props.disabled}
        />
      );
  }
}
