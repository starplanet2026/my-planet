import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { cn } from '../../../../lib/utils';
import { useToastStore } from '../../../../store/toastStore';
import { type PetWord } from '../../../../api/types';

export interface GamePlayBoardProps {
  level: number;
  words: PetWord[];
  onFinish: (result: {
    stars: number;
    wordIds: string[];
    wrongWordIds: string[];
    lastSelectedWordIds: string[];
  }) => Promise<{ success: boolean; rewardStar: number; newUnlockedLevel: number } | null>;
  onNextLevel: () => void;
  onExit: () => void;
}

// 固定词性按钮（十大词性 + 空格）
const POS_OPTIONS = [
  { label: '名词', abbr: 'n.' },
  { label: '代词', abbr: 'pron.' },
  { label: '形容词', abbr: 'adj.' },
  { label: '副词', abbr: 'adv.' },
  { label: '动词', abbr: 'v.' },
  { label: '数词', abbr: 'num.' },
  { label: '冠词', abbr: 'art.' },
  { label: '介词', abbr: 'prep.' },
  { label: '连词', abbr: 'conj.' },
  { label: '感叹词', abbr: 'int.' },
  { label: '空格', abbr: 'null' },
];

// 归一化词性，用于比较（兼容 n. / n / 名词 等写法）
function normalizePOS(pos: string | null): string {
  if (!pos || pos.trim() === '') return 'null';
  const p = pos.toLowerCase().trim().replace(/\.$/, '');
  const posMap: Record<string, string> = {
    'n': 'n', '名词': 'n',
    'pron': 'pron', '代词': 'pron',
    'adj': 'adj', '形容词': 'adj',
    'adv': 'adv', '副词': 'adv',
    'v': 'v', '动词': 'v', 'vt': 'v', 'vi': 'v',
    'num': 'num', '数词': 'num',
    'art': 'art', '冠词': 'art',
    'prep': 'prep', '介词': 'prep',
    'conj': 'conj', '连词': 'conj',
    'int': 'int', '感叹词': 'int', '感叹': 'int',
  };
  return posMap[p] ?? p;
}

function posButtonValue(abbr: string): string {
  if (abbr === 'null') return 'null';
  return normalizePOS(abbr);
}

interface Tile {
  id: string;
  wordId: string;
  text: string;
  zone: 'cn' | 'en';
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

export function GamePlayBoard({ level, words, onFinish, onNextLevel, onExit }: GamePlayBoardProps) {
  const toast = useToastStore();

  // 生成 tile 列表：中文和英文各一列，各自 shuffle
  const initialTiles = useMemo(() => {
    const cnTiles: Tile[] = [];
    const enTiles: Tile[] = [];
    for (const w of words) {
      cnTiles.push({
        id: `cn-${w.id}`, wordId: w.id, text: w.word_cn, zone: 'cn',
        eliminated: false, selected: false, flashing: null,
      });
      enTiles.push({
        id: `en-${w.id}`, wordId: w.id, text: w.word_en, zone: 'en',
        eliminated: false, selected: false, flashing: null,
      });
    }
    return { cn: shuffle(cnTiles), en: shuffle(enTiles) };
  }, [words]);

  const [cnTiles, setCnTiles] = useState<Tile[]>(initialTiles.cn);
  const [enTiles, setEnTiles] = useState<Tile[]>(initialTiles.en);
  const [selectedCN, setSelectedCN] = useState<string | null>(null);
  const [selectedEN, setSelectedEN] = useState<string | null>(null);
  const [selectedPOS, setSelectedPOS] = useState<string | null>(null);
  // 仅保留必要的中间状态：错词ID列表 + 最后1个消除词ID（用于后端排序复习）
  const [lastCorrectWord, setLastCorrectWord] = useState<string | null>(null);
  const [wrongWordIds, setWrongWordIds] = useState<string[]>([]);
  const [checking, setChecking] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [finishResult, setFinishResult] = useState<{ success: boolean; rewardStar: number; newUnlockedLevel: number } | null>(null);

  const totalWords = words.length;
  const eliminatedCount = cnTiles.filter(t => t.eliminated).length;
  const hasNextLevel = level < 100;

  // 用 ref 防止重复触发
  const checkingRef = useRef(false);
  const finishedRef = useRef(false);

  // 点击中文/英文 tile
  // 关键改动：只更新当前 zone 的 selected 状态，不清除另一 zone 的 selected，
  // 让用户能看到正在配对的两个词
  const handleTileClick = useCallback((tileId: string, zone: 'cn' | 'en') => {
    if (checking || completed) return;
    const tiles = zone === 'cn' ? cnTiles : enTiles;
    const tile = tiles.find(t => t.id === tileId);
    if (!tile || tile.eliminated) return;

    const setter = zone === 'cn' ? setSelectedCN : setSelectedEN;
    const setTiles = zone === 'cn' ? setCnTiles : setEnTiles;
    const current = zone === 'cn' ? selectedCN : selectedEN;
    if (current === tileId) {
      // 再次点击同一 tile：取消选中
      setter(null);
      setTiles(prev => prev.map(t => ({ ...t, selected: false })));
      return;
    }
    // 选新 tile：仅更新本 zone，清除本 zone 的 wrong 闪烁，
    // 不动另一 zone 的 selected 状态（保持高亮）
    setTiles(prev => prev.map(t => ({
      ...t,
      flashing: t.flashing === 'wrong' ? null : t.flashing,
      selected: t.id === tileId,
    })));
    setter(tileId);
  }, [checking, completed, cnTiles, enTiles, selectedCN, selectedEN]);

  // 点击词性按钮
  const handlePOSClick = useCallback((abbr: string) => {
    if (checking || completed) return;
    if (!selectedCN || !selectedEN) {
      toast.warning('请先选择中文和英文');
      return;
    }
    setSelectedPOS(abbr);
  }, [checking, completed, selectedCN, selectedEN, toast]);

  // 当三个都选中后，触发检查（用 useEffect 替代 setTimeout，修复连击 bug）
  useEffect(() => {
    if (!selectedCN || !selectedEN || !selectedPOS) return;
    if (checkingRef.current) return;
    checkingRef.current = true;
    setChecking(true);

    const cnTile = cnTiles.find(t => t.id === selectedCN);
    const enTile = enTiles.find(t => t.id === selectedEN);
    if (!cnTile || !enTile) {
      checkingRef.current = false;
      setChecking(false);
      return;
    }

    const cnWord = words.find(w => w.id === cnTile.wordId);
    if (!cnWord) {
      checkingRef.current = false;
      setChecking(false);
      return;
    }

    // 判断：中英文是同一单词 + 词性匹配
    const isSameWord = cnTile.wordId === enTile.wordId;
    const posMatch = normalizePOS(cnWord.part_of_speech) === posButtonValue(selectedPOS);
    const isCorrect = isSameWord && posMatch;

    // 闪烁动画
    const flashStyle: 'correct' | 'wrong' = isCorrect ? 'correct' : 'wrong';
    setCnTiles(prev => prev.map(t => t.id === selectedCN ? { ...t, flashing: flashStyle } : t));
    setEnTiles(prev => prev.map(t => t.id === selectedEN ? { ...t, flashing: flashStyle } : t));

    setTimeout(() => {
      if (isCorrect) {
        // 正确：消除中英文方块
        setCnTiles(prev => prev.map(t => t.id === selectedCN ? { ...t, eliminated: true, selected: false, flashing: null } : t));
        setEnTiles(prev => prev.map(t => t.id === selectedEN ? { ...t, eliminated: true, selected: false, flashing: null } : t));
        // 记录最后1个消除词（仅保留最后1个）
        setLastCorrectWord(cnTile.wordId);
        // 正确才清空选择状态
        setSelectedCN(null);
        setSelectedEN(null);
        setSelectedPOS(null);
        checkingRef.current = false;
        setChecking(false);
      } else {
        // 错误：不消除，不弹文字提醒；红色闪烁保留在错误方块上，
        // 等待用户重新点击中文/英文时由 handleTileClick 清除 wrong 闪烁
        setWrongWordIds(prev => {
          const newIds = [cnTile.wordId, enTile.wordId].filter(id => !prev.includes(id));
          return [...prev, ...newIds];
        });
        // 仅取消选中状态（保持错误闪烁），并立即解除 checking 锁，允许用户重选
        setCnTiles(prev => prev.map(t => t.id === selectedCN ? { ...t, selected: false } : t));
        setEnTiles(prev => prev.map(t => t.id === selectedEN ? { ...t, selected: false } : t));
        setSelectedCN(null);
        setSelectedEN(null);
        setSelectedPOS(null);
        checkingRef.current = false;
        setChecking(false);
      }
    }, isCorrect ? 500 : 400);
  }, [selectedCN, selectedEN, selectedPOS, cnTiles, enTiles, words]);

  // 游戏结束检测：全部消除即通关（不再判断星级）
  useEffect(() => {
    if (completed || finishedRef.current) return;
    const remaining = cnTiles.filter(t => !t.eliminated).length;
    if (remaining === 0 && totalWords > 0 && !checking) {
      finishedRef.current = true;
      const allWordIds = words.map(w => w.id);
      // stars 字段保留兼容签名（RPC 已忽略，固定传 3）
      onFinish({
        stars: 3,
        wordIds: allWordIds,
        wrongWordIds,
        lastSelectedWordIds: lastCorrectWord ? [lastCorrectWord] : [],
      }).then(res => {
        setFinishResult(res);
        setTimeout(() => setCompleted(true), 300);
      });
    }
  }, [cnTiles, checking, completed, totalWords, words, wrongWordIds, lastCorrectWord, onFinish]);

  // 渲染方块列（去掉中文/English 标题 bar）
  const renderTiles = (tiles: Tile[]) => {
    return (
      <div className="flex-1 min-w-0">
        <div className="flex flex-col gap-1.5">
          {tiles.map(tile => (
            <button
              key={tile.id}
              type="button"
              disabled={tile.eliminated || checking}
              onClick={() => handleTileClick(tile.id, tile.zone)}
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

  // 完成画面（去掉星级判断，只要消除完成就通关给星光值）
  if (completed && finishResult) {
    const isSuccess = finishResult.success;
    return (
      <div className="flex flex-col items-center justify-center py-10 px-4">
        <div className="text-6xl mb-4">{isSuccess ? '🎉' : '🙏'}</div>
        <h2 className="text-2xl font-bold text-slate-800 mb-3">
          {isSuccess ? '闯关成功！' : '闯关结束'}
        </h2>
        {isSuccess && (
          <p className="text-sm text-slate-500 mb-6">
            获得 <span className="text-amber-500 font-bold">{finishResult.rewardStar}</span> 星光值
          </p>
        )}
        <div className="flex gap-3">
          <button
            onClick={onExit}
            className="px-6 py-2.5 rounded-xl bg-slate-100 text-slate-600 text-sm font-medium hover:bg-slate-200"
          >
            返回关卡
          </button>
          {isSuccess && hasNextLevel && (
            <button
              onClick={onNextLevel}
              className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-green-400 to-emerald-500 text-white text-sm font-bold shadow-md hover:shadow-lg active:scale-95"
            >
              下一关 →
            </button>
          )}
        </div>
      </div>
    );
  }

  // 正在结算
  if (finishedRef.current && !completed) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-3 border-amber-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {/* 顶部信息栏：只保留返回 + 关号（去掉正确/错误计数 + 星级） */}
      <div className="flex items-center justify-between mb-3 px-1">
        <button
          onClick={onExit}
          className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1"
        >
          ← 返回关卡
        </button>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-slate-600">第 {level} 关</span>
        </div>
      </div>

      {/* 进度条：消除进度 */}
      <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden mb-2">
        <div
          className="h-full bg-gradient-to-r from-green-400 to-emerald-500 transition-all duration-300"
          style={{ width: `${(eliminatedCount / totalWords) * 100}%` }}
        />
      </div>

      {/* 玩法提示（顶部） */}
      <p className="text-center text-xs text-slate-500 mb-2">
        中英文匹配，词性也要选择哦！无词性选空格
      </p>

      {/* 游戏区域：绿草地背景 + 左右阵营（无中文/English 标题 bar） */}
      <div className="rounded-2xl bg-gradient-to-b from-green-300 to-green-400 p-3 shadow-inner">
        <div className="flex gap-3 min-h-[280px]">
          {renderTiles(cnTiles)}
          {renderTiles(enTiles)}
        </div>
      </div>

      {/* 底部固定词性按钮 */}
      <div className="mt-3">
        <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
          {POS_OPTIONS.map(pos => {
            const isSelectable = !!selectedCN && !!selectedEN;
            return (
              <button
                key={pos.abbr}
                type="button"
                disabled={checking || !isSelectable || completed}
                onClick={() => handlePOSClick(pos.abbr)}
                className={cn(
                  'px-1 py-2 rounded-lg border-2 text-xs font-medium transition-all active:scale-95',
                  selectedPOS === pos.abbr
                    ? 'bg-purple-400 border-purple-600 text-white scale-105 shadow-md'
                    : 'bg-purple-50 border-purple-200 text-purple-700 hover:bg-purple-100 hover:border-purple-300',
                  !isSelectable && 'opacity-50 cursor-not-allowed',
                )}
              >
                <div className="font-bold">{pos.label}</div>
                <div className="text-[10px] opacity-75">{pos.abbr}</div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
