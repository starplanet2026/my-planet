import { useState, useMemo } from 'react';
import { cn } from '../../../../lib/utils';
import { Check, X } from 'lucide-react';
import type { QuestionComponentProps } from './QuestionRenderer';

export function MatchQuestion({ question: q, answer, setAnswer, showResult }: QuestionComponentProps) {
  const leftColumn: string[] = q.options || [];
  const rightColumn: string[] = q.metadata?.rightColumn || [];

  // correct_answer 格式 "0:2,1:3,2:0,3:1"
  const correctPairs = useMemo(() => {
    const map = new Map<number, number>();
    (q.correct_answer || '').split(',').forEach(pair => {
      const [l, r] = pair.split(':').map(Number);
      if (!isNaN(l) && !isNaN(r)) map.set(l, r);
    });
    return map;
  }, [q.correct_answer]);

  // 当前选中的左项索引
  const [selectedLeft, setSelectedLeft] = useState<number | null>(null);

  // 从 answer 解析已配对列表 [[leftIdx, rightIdx], ...]
  const pairs: [number, number][] = useMemo(() => {
    if (!answer) return [];
    return answer.split(',').filter(Boolean).map(pair => {
      const [l, r] = pair.split(':').map(Number);
      return [l, r] as [number, number];
    });
  }, [answer]);

  const pairedLeft = new Set(pairs.map(p => p[0]));
  const pairedRight = new Set(pairs.map(p => p[1]));

  const tapLeft = (i: number) => {
    if (showResult) return;
    if (pairedLeft.has(i)) {
      // 取消该配对
      const newPairs = pairs.filter(p => p[0] !== i);
      setAnswer(newPairs.map(p => `${p[0]}:${p[1]}`).join(','));
    } else {
      setSelectedLeft(i);
    }
  };

  const tapRight = (i: number) => {
    if (showResult || selectedLeft === null) return;
    // 如果右项已被配对，先取消旧配对
    const filtered = pairs.filter(p => p[1] !== i);
    filtered.push([selectedLeft, i]);
    setAnswer(filtered.map(p => `${p[0]}:${p[1]}`).join(','));
    setSelectedLeft(null);
  };

  const getPairStatus = (leftIdx: number, rightIdx: number): 'correct' | 'wrong' | 'none' => {
    if (!showResult) return 'none';
    const pair = pairs.find(p => p[0] === leftIdx && p[1] === rightIdx);
    if (!pair) return 'none';
    return correctPairs.get(leftIdx) === rightIdx ? 'correct' : 'wrong';
  };

  if (leftColumn.length === 0 || rightColumn.length === 0) {
    return <p className="text-sm text-red-500 text-center">题目数据缺失</p>;
  }

  return (
    <div>
      <p className="text-xs text-slate-400 text-center mb-3">
        点击左侧再点击右侧进行配对，点击已配对项可取消
      </p>
      <div className="grid grid-cols-2 gap-3">
        {/* 左列 */}
        <div className="space-y-2">
          {leftColumn.map((item, i) => {
            const paired = pairedLeft.has(i);
            const selected = selectedLeft === i;
            const pairRightIdx = pairs.find(p => p[0] === i)?.[1];
            const status = paired ? getPairStatus(i, pairRightIdx!) : 'none';
            return (
              <button
                key={i}
                onClick={() => tapLeft(i)}
                disabled={showResult}
                className={cn(
                  'w-full p-3 rounded-xl border-2 text-sm font-medium transition-all text-left',
                  showResult && status === 'correct' ? 'border-emerald-400 bg-emerald-50' :
                  showResult && status === 'wrong' ? 'border-red-400 bg-red-50' :
                  selected ? 'border-star-400 bg-star-50 ring-2 ring-star-200' :
                  paired ? 'border-slate-300 bg-slate-50' : 'border-slate-200 bg-white hover:border-star-200'
                )}
              >
                <span className="text-xs text-slate-400 mr-2">{i + 1}.</span>
                {item}
              </button>
            );
          })}
        </div>

        {/* 右列 */}
        <div className="space-y-2">
          {rightColumn.map((item, i) => {
            const paired = pairedRight.has(i);
            const pairLeftIdx = pairs.find(p => p[1] === i)?.[0];
            const status = paired ? getPairStatus(pairLeftIdx!, i) : 'none';
            return (
              <button
                key={i}
                onClick={() => tapRight(i)}
                disabled={showResult}
                className={cn(
                  'w-full p-3 rounded-xl border-2 text-sm font-medium transition-all text-left',
                  showResult && status === 'correct' ? 'border-emerald-400 bg-emerald-50' :
                  showResult && status === 'wrong' ? 'border-red-400 bg-red-50' :
                  paired ? 'border-slate-300 bg-slate-50' : 'border-slate-200 bg-white hover:border-star-200'
                )}
              >
                <span className="text-xs text-slate-400 mr-2">{String.fromCharCode(65 + i)}.</span>
                {item}
              </button>
            );
          })}
        </div>
      </div>

      {/* 配对结果汇总 */}
      {showResult && (
        <div className="mt-4 p-3 rounded-xl bg-slate-50">
          <p className="text-sm font-medium text-slate-700 mb-2">配对详情：</p>
          {leftColumn.map((_, i) => {
            const pair = pairs.find(p => p[0] === i);
            if (!pair) return null;
            const rightIdx = pair[1];
            const isRight = correctPairs.get(i) === rightIdx;
            return (
              <div key={i} className="flex items-center gap-2 text-sm mb-1">
                {isRight ? <Check className="w-4 h-4 text-emerald-500" /> : <X className="w-4 h-4 text-red-500" />}
                <span className="text-slate-600">{leftColumn[i]}</span>
                <span className="text-slate-400">↔</span>
                <span className="text-slate-600">{rightColumn[rightIdx]}</span>
                {!isRight && (
                  <span className="text-red-400 text-xs ml-2">
                    (应为：{rightColumn[correctPairs.get(i) ?? -1] ?? '?'})
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
