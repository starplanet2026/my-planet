import { useState, useEffect, useCallback } from 'react';
import { cn } from '../../../../lib/utils';
import { useToastStore } from '../../../../store/toastStore';
import { STAR_ICON_SM } from '../../../../lib/constants';
import {
  fetchPetWords, fetchGameLevelResults, fetchGameLevelResult, finishGameLevel,
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

  // 当前闯关状态
  const [currentLevel, setCurrentLevel] = useState<number | null>(null);
  const [currentWords, setCurrentWords] = useState<PetWord[]>([]);
  const [finishing, setFinishing] = useState(false);

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

  // 选择关卡：准备单词并进入游戏
  const handleSelectLevel = useCallback(async (level: number) => {
    if (words.length === 0) {
      toast.warning('词库暂无单词，请联系家长导入');
      return;
    }
    const config = getLevelConfig(level);
    const wordCount = config.wordCount;

    // 收集已用过的 wordId（之前关卡用过的）
    const usedWordIds = new Set<string>();
    for (const [lv] of levelResults) {
      if (lv < level) {
        const prevResult = await fetchGameLevelResult(memberId, lv);
        if (prevResult) {
          prevResult.word_ids.forEach(id => usedWordIds.add(id));
        }
      }
    }

    // 新词：词库中还没用过的
    const newWords = words.filter(w => !usedWordIds.has(w.id)).slice(0, wordCount);

    // 复习词：第 N-2 关的错词 + 最后选的 2 个词
    let reviewWords: PetWord[] = [];
    if (level >= 3) {
      try {
        const prevResult = await fetchGameLevelResult(memberId, level - 2);
        if (prevResult) {
          const reviewIds = new Set<string>([
            ...prevResult.wrong_word_ids,
            ...prevResult.last_selected_word_ids,
          ]);
          reviewWords = words.filter(w => reviewIds.has(w.id));
        }
      } catch { /* 静默 */ }
    }

    // 合并：复习词优先，新词补齐
    const merged: PetWord[] = [];
    const mergedIds = new Set<string>();
    for (const w of reviewWords) {
      if (merged.length >= wordCount) break;
      merged.push(w);
      mergedIds.add(w.id);
    }
    for (const w of newWords) {
      if (merged.length >= wordCount) break;
      if (mergedIds.has(w.id)) continue;
      merged.push(w);
      mergedIds.add(w.id);
    }

    // 不够则用词库前面未用的补
    if (merged.length < wordCount) {
      for (const w of words) {
        if (merged.length >= wordCount) break;
        if (mergedIds.has(w.id)) continue;
        merged.push(w);
        mergedIds.add(w.id);
      }
    }

    if (merged.length === 0) {
      toast.warning('没有足够的单词，请联系家长导入更多');
      return;
    }

    setCurrentWords(merged);
    setCurrentLevel(level);
  }, [words, levelResults, memberId, toast]);

  // 闯关结束
  const handleFinish = useCallback(async (result: {
    stars: number;
    wordIds: string[];
    wrongWordIds: string[];
    lastSelectedWordIds: string[];
  }) => {
    if (!currentLevel || finishing) return;
    setFinishing(true);
    try {
      const res = await finishGameLevel(
        memberId, familyId, currentLevel,
        result.stars, result.wordIds, result.wrongWordIds, result.lastSelectedWordIds,
      );
      toast.success(`通关！获得 ${res.reward_star} 星光值（${result.stars}星）`);
      onReward();
      // 刷新关卡结果
      setLevelResults(prev => {
        const next = new Map(prev);
        const existing = next.get(currentLevel);
        if (!existing || existing.stars < result.stars) {
          next.set(currentLevel, { stars: result.stars, rewardStar: res.reward_star });
        }
        return next;
      });
      setUnlockedLevel(prev => Math.max(prev, res.new_unlocked_level));
      setCurrentLevel(null);
      setCurrentWords([]);
    } catch (e: any) {
      toast.error(e?.message ?? '结算失败');
    } finally {
      setFinishing(false);
    }
  }, [currentLevel, finishing, memberId, familyId, toast, onReward]);

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
