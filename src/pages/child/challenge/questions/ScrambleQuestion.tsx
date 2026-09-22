import { useState, useMemo } from 'react';
import { cn } from '../../../../lib/utils';
import type { QuestionComponentProps } from './QuestionRenderer';

export function ScrambleQuestion({ question: q, answer, setAnswer, showResult }: QuestionComponentProps) {
  // metadata.words = 乱序单词块数组
  const originalWords: string[] = q.metadata?.words || [];

  // 初始打乱顺序（按 q.id 记忆，防止重渲染时反复洗牌）
  const shuffledWords = useMemo(() => {
    const arr = [...originalWords];
    // Fisher-Yates 洗牌
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    // 如果恰好和正确答案顺序一致，交换前两个
    if (arr.length > 1 && arr.join(' ') === q.correct_answer) {
      [arr[0], arr[1]] = [arr[1], arr[0]];
    }
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.id]);

  // answer 格式：已选单词的原始索引序列，如 "2,0,1" 表示 shuffledWords[2]+[0]+[1]
  const selectedIndices: number[] = answer ? answer.split(',').filter(Boolean).map(Number) : [];
  const selectedSet = new Set(selectedIndices);

  const isCorrect = showResult && answer.split(',').map(i => shuffledWords[i] || '').join(' ') === q.correct_answer;

  const tapWord = (idx: number) => {
    if (showResult) return;
    if (selectedSet.has(idx)) {
      // 取消选择
      const next = selectedIndices.filter(i => i !== idx);
      setAnswer(next.join(','));
    } else {
      setAnswer([...selectedIndices, idx].join(','));
    }
  };

  const clearAll = () => {
    if (showResult) return;
    setAnswer('');
  };

  return (
    <div>
      {/* 组句显示区 */}
      <div className="mb-4 min-h-[80px] p-4 rounded-xl bg-slate-50 border-2 border-slate-100">
        <div className="flex flex-wrap gap-2 items-center">
          {selectedIndices.length === 0 ? (
            <span className="text-slate-400 text-sm">点击下方单词组成句子</span>
          ) : (
            selectedIndices.map((idx, pos) => (
              <button
                key={`${idx}-${pos}`}
                onClick={() => tapWord(idx)}
                disabled={showResult}
                className={cn(
                  'px-3 py-2 rounded-lg border-2 text-sm font-medium transition-all',
                  showResult && isCorrect ? 'border-emerald-400 bg-emerald-50 text-emerald-700' :
                  showResult && !isCorrect ? 'border-red-400 bg-red-50 text-red-700' :
                  'border-star-300 bg-white text-slate-700 hover:border-star-400'
                )}
              >
                {shuffledWords[idx]}
              </button>
            ))
          )}
        </div>
        {showResult && !isCorrect && (
          <p className="text-sm text-red-500 mt-2">❌ 正确答案：{q.correct_answer}</p>
        )}
        {showResult && isCorrect && (
          <p className="text-sm text-emerald-600 mt-2">✅ 重组正确！</p>
        )}
      </div>

      {/* 单词库 */}
      {!showResult && (
        <div>
          <div className="flex flex-wrap gap-2 justify-center mb-3">
            {shuffledWords.map((word, idx) => {
              const used = selectedSet.has(idx);
              return (
                <button
                  key={idx}
                  onClick={() => tapWord(idx)}
                  disabled={used}
                  className={cn(
                    'px-3 py-2 rounded-lg border-2 text-sm font-medium transition-all',
                    used
                      ? 'border-slate-100 bg-slate-50 text-slate-300 cursor-not-allowed'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-star-400 hover:bg-star-50 active:scale-95'
                  )}
                >
                  {word}
                </button>
              );
            })}
          </div>
          <div className="text-center">
            <button onClick={clearAll} className="px-4 py-2 rounded-lg bg-slate-100 text-slate-600 text-sm hover:bg-slate-200">
              清空
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
