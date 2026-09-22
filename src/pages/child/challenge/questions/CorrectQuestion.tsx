import { useMemo } from 'react';
import { cn } from '../../../../lib/utils';
import { Check, X } from 'lucide-react';
import type { QuestionComponentProps } from './QuestionRenderer';

export function CorrectQuestion({ question: q, answer, setAnswer, showResult, isCorrect }: QuestionComponentProps) {
  // options = 按空格拆分的单词块
  const words: string[] = q.options || q.question_text.split(/\s+/);
  // correct_answer = 错误位置字母如 "BD"（B=index1, D=index3）
  const correctLetters = (q.correct_answer || '').toUpperCase().split('').sort();
  const correctPositions = useMemo(() => {
    return new Set(correctLetters.map(l => l.charCodeAt(0) - 65));
  }, [correctLetters]);

  // answer 存字母，解析为已选位置集合
  const selectedLetters = (answer || '').toUpperCase().split('').filter(Boolean);
  const selectedPositions = new Set(selectedLetters.map(l => l.charCodeAt(0) - 65));

  // 切换选择
  const toggle = (idx: number) => {
    if (showResult) return;
    const letter = String.fromCharCode(65 + idx);
    const next = selectedLetters.includes(letter)
      ? selectedLetters.filter(l => l !== letter)
      : [...selectedLetters, letter];
    setAnswer(next.sort().join(''));
  };

  const allCorrect = showResult && isCorrect;

  return (
    <div>
      <p className="text-sm text-slate-500 mb-3 text-center">
        点击句子中错误的单词（再次点击可取消）
      </p>

      {/* 句子展示：单词块 */}
      <div className="p-4 rounded-xl bg-slate-50 border-2 border-slate-100 mb-4">
        <div className="flex flex-wrap gap-2 items-center">
          {words.map((word, idx) => {
            const letter = String.fromCharCode(65 + idx);
            const selected = selectedPositions.has(idx);
            const isActuallyError = correctPositions.has(idx);
            const isRightHit = showResult && selected && isActuallyError;
            const isMissed = showResult && !selected && isActuallyError;
            const isWrongHit = showResult && selected && !isActuallyError;

            return (
              <button
                key={idx}
                onClick={() => toggle(idx)}
                disabled={showResult}
                className={cn(
                  'px-3 py-2 rounded-lg border-2 text-sm font-medium transition-all',
                  isRightHit ? 'border-emerald-400 bg-emerald-50 text-emerald-700' :
                  isMissed ? 'border-amber-400 bg-amber-50 text-amber-700 border-dashed' :
                  isWrongHit ? 'border-red-400 bg-red-50 text-red-700' :
                  selected ? 'border-star-400 bg-star-50 text-star-700' :
                  'border-slate-200 bg-white text-slate-700 hover:border-star-300'
                )}
              >
                {word}
                {showResult && isActuallyError && (
                  <span className="ml-1 text-xs">
                    {isRightHit ? <Check className="w-3 h-3 inline" /> : <X className="w-3 h-3 inline" />}
                  </span>
                )}
                {showResult && selected && !isActuallyError && (
                  <span className="ml-1 text-xs"><X className="w-3 h-3 inline" /></span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* 已选位置 */}
      {selectedPositions.size > 0 && !showResult && (
        <p className="text-xs text-slate-400 text-center mb-3">
          已标记 {selectedPositions.size} 处错误
        </p>
      )}

      {/* 答案对比 */}
      {showResult && (
        <div className={cn('p-4 rounded-xl', allCorrect ? 'bg-emerald-50' : 'bg-red-50')}>
          <p className={cn('text-sm font-medium mb-2', allCorrect ? 'text-emerald-600' : 'text-red-600')}>
            {allCorrect ? '✅ 全部命中！' : '❌ 未完全命中所有错误点'}
          </p>
          <div className="space-y-2">
            <div>
              <p className="text-xs text-slate-400">你的答案：</p>
              <p className="text-sm text-slate-700">
                位置 {selectedLetters.map(l => l.charCodeAt(0) - 64).join(', ')}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-400">正确位置：</p>
              <p className="text-sm text-slate-700">
                位置 {correctLetters.map(l => l.charCodeAt(0) - 64).join(', ')}
              </p>
            </div>
            {q.metadata?.correctSentence && (
              <div>
                <p className="text-xs text-slate-400">正确句子：</p>
                <p className="text-sm text-slate-700 font-medium">{q.metadata.correctSentence}</p>
              </div>
            )}
          </div>
          {q.explanation && (
            <p className="text-sm text-slate-600 mt-2 pt-2 border-t border-slate-200">{q.explanation}</p>
          )}
        </div>
      )}
    </div>
  );
}
