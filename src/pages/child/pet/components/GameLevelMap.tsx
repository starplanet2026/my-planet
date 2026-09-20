import { useMemo } from 'react';
import { cn } from '../../../../lib/utils';
import { getLevelConfig } from '../../../../api/types';

export interface GameLevelMapProps {
  unlockedLevel: number;
  levelResults: Map<number, { stars: number; rewardStar: number }>;
  onSelectLevel: (level: number) => void;
}

const TOTAL_LEVELS = 100;
const COLS = 5;

const GameLevelMap = ({
  unlockedLevel,
  levelResults,
  onSelectLevel,
}) => {
  const levels = useMemo(
    () => Array.from({ length: TOTAL_LEVELS }, (_, i) => i + 1),
    []
  );

  const renderStars = (count: number) => (
    <div className="flex justify-center gap-0.5">
      {[1, 2, 3].map((i) => (
        <span
          key={i}
          className={cn(
            'text-[10px] leading-none',
            i <= count ? 'text-amber-400' : 'text-slate-300'
          )}
        >
          ⭐
        </span>
      ))}
    </div>
  );

  return (
    <div className="w-full">
      <div className="mx-auto grid max-h-[70vh] grid-cols-5 gap-3 overflow-y-auto p-2">
        {levels.map((level) => {
          const config = getLevelConfig(level);
          const rewardStar = config?.baseReward ?? 0;
          const result = levelResults.get(level);
          const isCompleted = !!result && result.stars > 0;
          const isLocked = level > unlockedLevel;

          const handleClick = () => {
            if (!isLocked) onSelectLevel(level);
          };

          return (
            <button
              key={level}
              type="button"
              onClick={handleClick}
              disabled={isLocked}
              className={cn(
                'relative flex aspect-square flex-col items-center justify-between rounded-xl border-2 p-2 transition-all',
                isLocked &&
                  'cursor-not-allowed bg-slate-50 border-slate-200 opacity-70',
                !isLocked &&
                  !isCompleted &&
                  'cursor-pointer bg-amber-50 border-amber-300 hover:scale-105 hover:border-amber-400 hover:shadow-md',
                isCompleted &&
                  'cursor-pointer bg-green-50 border-green-300 hover:scale-105 hover:border-green-400 hover:shadow-md'
              )}
            >
              {/* Top: stars for completed levels */}
              <div className="flex h-4 w-full items-center justify-center">
                {isCompleted ? renderStars(result!.stars) : null}
              </div>

              {/* Center: lock icon for locked, level number otherwise */}
              <div className="flex flex-1 items-center justify-center">
                {isLocked ? (
                  <span className="text-lg text-slate-400">🔒</span>
                ) : (
                  <span className="text-lg font-bold text-emerald-700">
                    {level}
                  </span>
                )}
              </div>

              {/* Bottom: reward (with star) for unlocked, level label for locked */}
              <div className="flex h-4 w-full items-center justify-center">
                {isLocked ? (
                  <span className="text-[10px] text-slate-400">Lv.{level}</span>
                ) : (
                  <span className="flex items-center gap-0.5 text-[11px] font-semibold text-amber-600">
                    <span>⭐</span>
                    <span>{rewardStar}</span>
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default GameLevelMap;
