import { useMemo } from 'react';
import { cn } from '../../../../lib/utils';
import { Delete } from 'lucide-react';
import type { QuestionComponentProps } from './QuestionRenderer';

export function SpellQuestion({ question: q, answer, setAnswer, showResult, disabled }: QuestionComponentProps) {
  // correct_answer = 正确单词，如 "apple"
  const correctWord = q.correct_answer || '';

  // 生成字母键盘：打乱正确单词的字母 + 2 个干扰字母
  const letters = useMemo(() => {
    const wordLetters = correctWord.toUpperCase().split('');
    const allChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const distractCount = Math.min(2, 26 - new Set(wordLetters).size);
    const distract: string[] = [];
    while (distract.length < distractCount) {
      const c = allChars[Math.floor(Math.random() * 26)];
      if (!wordLetters.includes(c) && !distract.includes(c)) distract.push(c);
    }
    return [...wordLetters, ...distract].sort(() => Math.random() - 0.5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.id]);

  const usedIndices: number[] = [];
  // answer 的每个字符对应 letters 中的某个索引（从左到右匹配未使用的字母）
  for (const ch of (answer || '')) {
    const idx = letters.findIndex((l, i) => l === ch && !usedIndices.includes(i));
    if (idx >= 0) usedIndices.push(idx);
  }

  const tap = (i: number) => {
    if (showResult || disabled) return;
    if (usedIndices.includes(i)) return;
    setAnswer(answer + letters[i]);
  };

  const backspace = () => {
    if (showResult || disabled) return;
    setAnswer(answer.slice(0, -1));
  };

  const clearAll = () => {
    if (showResult || disabled) return;
    setAnswer('');
  };

  const isCorrect = showResult && answer.toUpperCase() === correctWord.toUpperCase();

  return (
    <div>
      {/* 提示 */}
      {q.metadata?.hint && (
        <p className="text-sm text-slate-500 mb-3 text-center">💡 {q.metadata.hint}</p>
      )}

      {/* 拼写显示区 */}
      <div className="mb-4 min-h-[60px] flex items-center justify-center flex-wrap gap-1 p-4 rounded-xl bg-slate-50 border-2 border-slate-100">
        {answer ? (
          answer.split('').map((ch, i) => (
            <span key={i} className="text-3xl font-bold text-slate-800 tracking-wider">{ch}</span>
          ))
        ) : (
          <span className="text-slate-400 text-sm">点击下方字母拼写</span>
        )}
      </div>

      {/* 答案对比（提交后） */}
      {showResult && (
        <div className={cn('mb-4 p-3 rounded-xl text-center', isCorrect ? 'bg-emerald-50' : 'bg-red-50')}>
          <p className={cn('text-sm font-medium', isCorrect ? 'text-emerald-600' : 'text-red-600')}>
            {isCorrect ? '✅ 拼写正确！' : `❌ 正确答案：${correctWord}`}
          </p>
        </div>
      )}

      {/* 字母键盘 */}
      {!showResult && (
        <div>
          <div className="flex flex-wrap justify-center gap-2 mb-4">
            {letters.map((l, i) => {
              const used = usedIndices.includes(i);
              return (
                <button
                  key={i}
                  onClick={() => tap(i)}
                  disabled={used}
                  className={cn(
                    'w-12 h-12 rounded-xl border-2 text-xl font-bold transition-all',
                    used
                      ? 'border-slate-100 bg-slate-50 text-slate-300 cursor-not-allowed'
                      : 'border-star-200 bg-white text-slate-700 hover:border-star-400 hover:bg-star-50 active:scale-95'
                  )}
                >
                  {l}
                </button>
              );
            })}
          </div>
          <div className="flex justify-center gap-2">
            <button onClick={backspace} className="px-4 py-2 rounded-lg bg-slate-100 text-slate-600 text-sm hover:bg-slate-200 flex items-center gap-1">
              <Delete className="w-4 h-4" /> 删除
            </button>
            <button onClick={clearAll} className="px-4 py-2 rounded-lg bg-slate-100 text-slate-600 text-sm hover:bg-slate-200">
              清空
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
