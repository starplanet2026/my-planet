import { useState, useEffect, useCallback } from 'react';
import { cn } from '../../../../lib/utils';
import { useToastStore } from '../../../../store/toastStore';
import { usePetUiStore } from '../../../../store/petUiStore';
import { STAR_ICON_SM } from '../../../../lib/constants';
import {
  fetchPetWords, fetchGameLevelResults, finishGameLevel,
} from '../../../../api/pets';
import { getLevelConfig, type PetWord, type GameLevelResult } from '../../../../api/types';
import GameLevelMap from './GameLevelMap';
import { GamePlayBoard } from './GamePlayBoard';

interface WordMatchGameProps {
  familyId: string;
  memberId: string;
  onReward: () => void;
}

export function WordMatchGame({ familyId, memberId, onReward }: WordMatchGameProps) {
  const toast = useToastStore();
  const [words, setWords] = useState<PetWord[]>([]); // 词库
  const [levelResults, setLevelResults] = useState<Map<number, { stars: number; rewardStar: number }>>(new Map());
  const [unlockedLevel, setUnlockedLevel] = useState(1);
  const [loading, setLoading] = useState(true);

  // 当前闯关状态：从全局 store 恢复（切换 tab 回来后能续上）
  const storeGameLevel = usePetUiStore(s => s.gameLevel);
  const storeGameWords = usePetUiStore(s => s.gameWords);
  const setGameState = usePetUiStore(s => s.setGameState);
  const clearGameState = usePetUiStore(s => s.clearGameState);

  const [currentLevel, setCurrentLevel] = useState<number | null>(storeGameLevel);
  const [currentWords, setCurrentWords] = useState<PetWord[]>(storeGameWords);
  const [finishing, setFinishing] = useState(false);

  // 把当前关卡/单词同步到 store（让 PetPage 卸载后可恢复）
  const syncToStore = useCallback((level: number | null, w: PetWord[]) => {
    if (level === null) clearGameState();
    else setGameState(level, w);
  }, [setGameState, clearGameState]);

  // 加载词库 + 关卡结果
  const loadData = useCallback(async () => {
    if (!familyId || !memberId) return;
    setLoading(true);
    try {
      const [wordList, results] = await Promise.all([
        fetchPetWords(familyId),
        fetchGameLevelResults(memberId),
      ]);
      setWords(wordList);

      const resultMap = new Map<number, { stars: number; rewardStar: number }>();
      let maxUnlocked = 1;
      for (const r of results) {
        resultMap.set(r.level, { stars: r.stars, rewardStar: r.reward_star });
        if (r.level >= maxUnlocked) maxUnlocked = r.level + 1;
      }
      setLevelResults(resultMap);
      setUnlockedLevel(Math.min(maxUnlocked, 100));
    } catch (e: any) {
      toast.error(e?.message ?? '加载失败');
    } finally {
      setLoading(false);
    }
  }, [familyId, memberId, toast]);

  useEffect(() => { loadData(); }, [loadData]);

  // 同步当前关卡到全局 store（切换 tab 后回来可恢复）
  useEffect(() => {
    syncToStore(currentLevel, currentWords);
  }, [currentLevel, currentWords, syncToStore]);

  // 选择关卡：按 display_order 升序取前 N 个词
  // （错词 + 最后1个消除词已被 finish_game_level 推到队尾，等待后续重复复习）
  const handleSelectLevel = useCallback(async (level: number) => {
    if (words.length === 0) {
      toast.warning('词库暂无单词，请联系家长导入');
      return;
    }
    const config = getLevelConfig(level);
    const wordCount = config.wordCount;

    // 按 display_order 升序取前 N 个
    const sorted = [...words].sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0));
    const picked = sorted.slice(0, wordCount);

    if (picked.length === 0) {
      toast.warning('没有足够的单词，请联系家长导入更多');
      return;
    }

    setCurrentWords(picked);
    setCurrentLevel(level);
  }, [words, toast]);

  // 闯关结束：保存结果并返回给 GamePlayBoard 显示完成画面
  const handleFinish = useCallback(async (result: {
    stars: number;
    wordIds: string[];
    wrongWordIds: string[];
    lastSelectedWordIds: string[];
  }): Promise<{ success: boolean; rewardStar: number; newUnlockedLevel: number } | null> => {
    if (!currentLevel || finishing) return null;
    setFinishing(true);
    try {
      const res = await finishGameLevel(
        memberId, familyId, currentLevel,
        result.stars, result.wordIds, result.wrongWordIds, result.lastSelectedWordIds,
      );
      onReward();
      // 重新加载词库：错词+最后1个消除词已被 RPC 推到队尾，下一关要按新顺序取词
      try {
        const freshWords = await fetchPetWords(familyId);
        setWords(freshWords);
      } catch { /* 静默：词库刷新失败不阻塞结算 */ }
      // 刷新关卡结果（stars 固定为 3，仅用于UI兼容显示）
      setLevelResults(prev => {
        const next = new Map(prev);
        next.set(currentLevel, { stars: 3, rewardStar: res.reward_star });
        return next;
      });
      setUnlockedLevel(prev => Math.max(prev, res.new_unlocked_level));
      return { success: res.success, rewardStar: res.reward_star, newUnlockedLevel: res.new_unlocked_level };
    } catch (e: any) {
      toast.error(e?.message ?? '结算失败');
      return null;
    } finally {
      setFinishing(false);
    }
  }, [currentLevel, finishing, memberId, familyId, toast, onReward]);

  // 下一关
  const handleNextLevel = useCallback(() => {
    if (!currentLevel) return;
    const next = currentLevel + 1;
    if (next > 100) return;
    setCurrentLevel(null);
    setCurrentWords([]);
    setTimeout(() => handleSelectLevel(next), 100);
  }, [currentLevel, handleSelectLevel]);

  // 加载中
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-3 border-amber-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // 词库为空
  if (words.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="text-5xl mb-3">📚</div>
        <p className="text-sm text-slate-500 mb-1">词库暂无单词</p>
        <p className="text-xs text-slate-400">请联系家长在后台导入单词</p>
      </div>
    );
  }

  // 闯关中
  if (currentLevel !== null) {
    return (
      <div className="relative">
        {finishing && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60 rounded-xl">
            <div className="w-8 h-8 border-3 border-amber-400 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        <GamePlayBoard
          level={currentLevel}
          words={currentWords}
          onFinish={handleFinish}
          onNextLevel={handleNextLevel}
          onExit={() => { setCurrentLevel(null); setCurrentWords([]); }}
        />
      </div>
    );
  }

  // 关卡列表
  return (
    <div>
      {/* 顶部说明 */}
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="flex items-center gap-1.5">
          <img src={STAR_ICON_SM} alt="星光值" className="w-4 h-4 rounded-full" />
          <span className="text-xs text-slate-500">闯关赢星光值，100 关等你挑战</span>
        </div>
        <span className="text-xs text-slate-400">已解锁 {unlockedLevel}/100</span>
      </div>
      <GameLevelMap
        unlockedLevel={unlockedLevel}
        levelResults={levelResults}
        onSelectLevel={handleSelectLevel}
      />
    </div>
  );
}
