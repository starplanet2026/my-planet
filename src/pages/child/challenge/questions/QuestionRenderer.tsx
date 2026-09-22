import type { Question } from '../../../../api/types';
import { ChoiceQuestion } from './ChoiceQuestion';
import { SpellQuestion } from './SpellQuestion';
import { MatchQuestion } from './MatchQuestion';
import { ScrambleQuestion } from './ScrambleQuestion';
import { ReciteQuestion } from './ReciteQuestion';
import { CorrectQuestion } from './CorrectQuestion';
import { Input } from '../../../../components/common/Input';

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
      // math / 其他兜底：数字输入
      return (
        <Input
          type="text"
          value={props.answer}
          onChange={e => props.setAnswer(e.target.value)}
          placeholder="输入答案"
          className="text-2xl text-center py-4"
          disabled={props.disabled}
        />
      );
  }
}
