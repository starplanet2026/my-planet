import { useState, useMemo, useCallback } from 'react';
import { cn } from '../../../../lib/utils';
import { getLevelConfig, type PetWord } from '../../../../api/types';

export interface GamePlayBoardProps {
  level: number;
  words: PetWord[]; // 本关的单词（已含复习词）
  onFinish: (result: {
    stars: number;
    wordIds: string[];
    wrongWordIds: string[];
    lastSelectedWordIds: string[];
  }) => void;
  onExit: () => void;
}

type Zone = 'en' | 'cn' | 'pos';

interface Tile {
  id: string; // tile 唯一 ID（zone + wordId）
  wordId: string;
  text: string;
  zone: Zone;
  eliminated: boolean;
  selected: boolean;
  flashing: 'correct' | 'wrong' | null;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 根据正确率计算星级
function calcStars(wordCount: number, wrongCount: number): number {
  const rate = wrongCount / wordCount;
  if (rate <= 0.25) return 3;
  if (rate <= 0.5) return 2;
  return 1;
}

const ZONE_LABELS: Record<Zone, string> = { en: 'English', cn: '中文', pos: '词性' };
const ZONE_COLORS: Record<Zone, string> = {
  en: 'from-sky-300 to-sky-400',
  cn: 'from-orange-300 to-orange-400',
  pos: 'from-purple-300 to-purple-400',
};

export function GamePlayBoard({ level, words, onFinish, onExit }: GamePlayBoardProps) {
  const config = getLevelConfig(level);

  // 生成 tile 列表：每个单词 3 个 tile（en/cn/pos），各自 shuffle
  const initialTiles = useMemo(() => {
    const enTiles: Tile[] = [];
    const cnTiles: Tile[] = [];
    const posTiles: Tile[] = [];
    for (const w of words) {
      enTiles.push({
        id: `en-${w.id}`, wordId: w.id, text: w.word_en, zone: 'en',
        eliminated: false, selected: false, flashing: null,
      });
      cnTiles.push({
        id: `cn-${w.id}`, wordId: w.id, text: w.word_cn, zone: 'cn',
        eliminated: false, selected: false, flashing: null,
      });
      posTiles.push({
        id: `pos-${w.id}`, wordId: w.id, text: w.part_of_speech || '—', zone: 'pos',
        eliminated: false, selected: false, flashing: null,
      });
    }
    return [...shuffle(enTiles), ...shuffle(cnTiles), ...shuffle(posTiles)];
  }, [words]);

  const [tiles, setTiles] = useState<Tile[]>(initialTiles);
  const [correctCount, setCorrectCount] = useState(0);
  const [wrongCount, setWrongCount] = useState(0);
  const [lastCorrectWords, setLastCorrectWords] = useState<string[]>([]); // 最后匹配正确的 wordId
  const [wrongWordIds, setWrongWordIds] = useState<string[]>([]); // 错误匹配涉及的 wordId
  const [checking, setChecking] = useState(false);

  const selectedTiles = tiles.filter(t => t.selected && !t.eliminated);
  const remainingCount = tiles.filter(t => !t.eliminated).length;
  const totalWords = words.length;

  // 处理点击
  const handleTileClick = useCallback((tileId: string) => {
    if (checking) return;
    setTiles(prev => {
      const next = [...prev];
      const idx = next.findIndex(t => t.id === tileId);
      if (idx === -1 || next[idx].eliminated) return prev;

      const tile = next[idx];

      // 已选中 → 取消
      if (tile.selected) {
        next[idx] = { ...tile, selected: false };
        return next;
      }

      // 同 zone 已有选中 → 替换
      const sameZoneIdx = next.findIndex(t => t.zone === tile.zone && t.selected && !t.eliminated);
      if (sameZoneIdx >= 0) {
        next[sameZoneIdx] = { ...next[sameZoneIdx], selected: false };
      }

      // 选中当前
      next[idx] = { ...tile, selected: true };
      return next;
    });
  }, [checking]);

  // 检查匹配（当 3 个 zone 都选中时触发）
  const tryCheck = useCallback(() => {
    const selected = tiles.filter(t => t.selected && !t.eliminated);
    if (selected.length !== 3) return;

    const zones = new Set(selected.map(t => t.zone));
    if (zones.size !== 3) return; // 必须来自 3 个不同 zone

    setChecking(true);

    const wordIds = selected.map(t => t.wordId);
    const isMatch = wordIds.every(id => id === wordIds[0]);
    const matchedWordId = wordIds[0];

    // 闪烁动画
    setTiles(prev => prev.map(t => {
      if (t.selected && !t.eliminated) {
        return { ...t, flashing: isMatch ? 'correct' : 'wrong' };
      }
      return t;
    }));

    // 600ms 后消除
    setTimeout(() => {
      setTiles(prev => prev.map(t => {
        if (t.selected && !t.eliminated) {
          return { ...t, eliminated: true, selected: false, flashing: null };
        }
        return t;
      }));

      if (isMatch) {
        setCorrectCount(c => c + 1);
        setLastCorrectWords(prev => {
          const next = [...prev, matchedWordId];
          return next.slice(-2); // 只保留最后 2 个
        });
      } else {
        setWrongCount(w => w + 1);
        setWrongWordIds(prev => {
          const newIds = wordIds.filter(id => !prev.includes(id));
          return [...prev, ...newIds];
        });
      }
      setChecking(false);
    }, 600);
  }, [tiles]);

  // 自动检查
  const selectedZoneCount = new Set(selectedTiles.map(t => t.zone)).size;
  if (selectedZoneCount === 3 && !checking) {
    // 使用 setTimeout 避免在 render 中 setState
    setTimeout(() => tryCheck(), 0);
  }

  // 游戏结束
  const isFinished = remainingCount === 0 && totalWords > 0;
  if (isFinished && !checking) {
    const stars = calcStars(totalWords, wrongCount);
    const allWordIds = words.map(w => w.id);
    setTimeout(() => {
      onFinish({
        stars,
        wordIds: allWordIds,
        wrongWordIds,
        lastSelectedWordIds: lastCorrectWords,
      });
    }, 500);
  }

  const stars = calcStars(totalWords, wrongCount);

  // 按 zone 分组渲染
  const renderZone = (zone: Zone) => {
    const zoneTiles = tiles.filter(t => t.zone === zone);
    return (
      <div className="flex-1 min-w-0">
        <div className={cn(
          'text-center py-1.5 rounded-lg mb-2 bg-gradient-to-b text-white text-xs font-bold shadow-sm',
          ZONE_COLORS[zone],
        )}>
          {ZONE_LABELS[zone]}
        </div>
        <div className="flex flex-col gap-1.5">
          {zoneTiles.map(tile => (
            <button
              key={tile.id}
              type="button"
              disabled={tile.eliminated || checking}
              onClick={() => handleTileClick(tile.id)}
              className={cn(
                'w-full px-2 py-2.5 rounded-lg border-2 text-sm font-medium transition-all active:scale-95',
                tile.eliminated && 'opacity-0 scale-50 pointer-events-none h-0 py-0 my-0 border-0',
                !tile.eliminated && !tile.selected && !tile.flashing &&
                  'bg-amber-50 border-amber-200 text-slate-700 hover:bg-amber-100 hover:border-amber-300',
                tile.selected && !tile.flashing &&
                  'bg-amber-200 border-amber-500 text-slate-900 scale-105 shadow-md ring-2 ring-amber-300',
                tile.flashing === 'correct' && 'bg-green-400 border-green-600 text-white scale-110',
                tile.flashing === 'wrong' && 'bg-red-400 border-red-600 text-white animate-pulse',
              )}
            >
              {tile.text}
            </button>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col">
      {/* 顶部信息栏 */}
      <div className="flex items-center justify-between mb-3 px-1">
        <button
          onClick={onExit}
          className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1"
        >
          ← 返回关卡
        </button>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-slate-600">第 {level} 关</span>
          <span className="text-green-600 font-medium">✓ {correctCount}/{totalWords}</span>
          <span className="text-red-500 font-medium">✗ {wrongCount}</span>
          <span className="text-amber-500">
            {'⭐'.repeat(stars)}{'☆'.repeat(3 - stars)}
          </span>
        </div>
      </div>

      {/* 进度条 */}
      <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden mb-3">
        <div
          className="h-full bg-gradient-to-r from-green-400 to-emerald-500 transition-all duration-300"
          style={{ width: `${((correctCount + wrongCount) / totalWords) * 100}%` }}
        />
      </div>

      {/* 游戏区域：绿草地背景 + 三分区 */}
      <div className="rounded-2xl bg-gradient-to-b from-green-300 to-green-400 p-3 shadow-inner">
        <div className="flex gap-2 min-h-[300px]">
          {renderZone('en')}
          {renderZone('cn')}
          {renderZone('pos')}
        </div>
      </div>

      {/* 底部提示 */}
      <p className="text-center text-xs text-slate-400 mt-3">
        从三列中各选一个属于同一单词的方块，正确消除得分，错误也会消除
      </p>
    </div>
  );
}
