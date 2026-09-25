import { useState, useEffect, useCallback } from 'react';
import { useToastStore } from '../../../../store/toastStore';
import { usePetUiStore } from '../../../../store/petUiStore';
import { STAR_ICON_SM } from '../../../../lib/constants';
import {
  fetchPetWords, fetchGameLevelResults, finishGameLevel,
  fetchWordBooks, fetchPetWordProgress, updatePetWordProgressBookId,
  fetchGameWordStats,
} from '../../../../api/pets';
import {
  getLevelConfig, type PetWord, type PetWordBook, type GameWordStat,
} from '../../../../api/types';
import GameLevelMap from './GameLevelMap';
import { GamePlayBoard } from './GamePlayBoard';

interface WordMatchGameProps {
  familyId: string;
  memberId: string;
  onReward: () => void;
}

// 判断词书是否通关：所有单词 challenge_count>0 且 wrong_count===0
function isBookCleared(words: PetWord[], stats: Record<string, GameWordStat>): boolean {
  if (words.length === 0) return false;
  return words.every(w => {
    const s = stats[w.id];
    return s && s.challenge_count > 0 && s.wrong_count === 0;
  });
}

export function WordMatchGame({ familyId, memberId, onReward }: WordMatchGameProps) {
  const toast = useToastStore();

  // 词书 + 词书内单词（快照）
  const [currentBook, setCurrentBook] = useState<PetWordBook | null>(null);
  const [bookWords, setBookWords] = useState<PetWord[]>([]);
  const [allCleared, setAllCleared] = useState(false);

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

  // 把当前关卡/单词/词书同步到 store（让 PetPage 卸载后可恢复）
  const syncToStore = useCallback((level: number | null, w: PetWord[], bookId?: string | null, bookTitle?: string) => {
    if (level === null) clearGameState();
    else setGameState(level, w, bookId, bookTitle);
  }, [setGameState, clearGameState]);

  // ===== 切换到下一本词书（通关后调用） =====
  // 拉取后台最新词书排序，从当前位置向后找第一本有单词的词书
  const advanceToNextBook = useCallback(async (completedBook: PetWordBook): Promise<void> => {
    // ③ 通关后拉取后台最新词书排序
    const freshBooks = await fetchWordBooks();
    if (freshBooks.length === 0) {
      setAllCleared(true);
      return;
    }

    // 找到刚通关的词书在最新列表中的位置
    const completedIdx = freshBooks.findIndex(b => b.id === completedBook.id);
    // 如果词书被删了，从第一本开始；否则从下一本开始
    const startIdx = completedIdx === -1 ? 0 : completedIdx + 1;

    // 向后找第一本有单词的词书
    for (let i = startIdx; i < freshBooks.length; i++) {
      const book = freshBooks[i];
      await updatePetWordProgressBookId(memberId, book.id);
      setCurrentBook(book);

      const wordList = await fetchPetWords(book.id);
      if (wordList.length > 0) {
        setBookWords(wordList);

        // 重新加载统计
        const stats = await fetchGameWordStats(memberId);
        const statsMap: Record<string, GameWordStat> = {};
        for (const s of stats) statsMap[s.word_id] = s;

        toast.success(`恭喜通关「${completedBook.title}」！进入下一本「${book.title}」`);
        return;
      }
      // 这本没单词，继续找下一本
    }

    // 没有更多有单词的词书了
    setBookWords([]);
    setAllCleared(true);
  }, [memberId, toast]);

  // ===== 初始加载 =====
  const loadData = useCallback(async () => {
    if (!familyId || !memberId) return;
    setLoading(true);
    try {
      // ① 读取后台最新词书整体排序
      const bookList = await fetchWordBooks();

      if (bookList.length === 0) {
        setCurrentBook(null);
        setBookWords([]);
        return;
      }

      // ② 读取用户当前词书进度
      const progress = await fetchPetWordProgress(memberId);
      let bookId = progress?.current_book_id ?? null;

      // 校验 current_book_id 是否在词书列表中
      let book = bookId ? bookList.find(b => b.id === bookId) ?? null : null;
      if (!book) {
        book = bookList[0];
        bookId = book.id;
        await updatePetWordProgressBookId(memberId, bookId);
      }
      setCurrentBook(book);

      // ③ 加载当前词书的单词 + 关卡结果 + 统计
      const [wordList, results, stats] = await Promise.all([
        fetchPetWords(bookId!),
        fetchGameLevelResults(memberId),
        fetchGameWordStats(memberId),
      ]);
      setBookWords(wordList);

      const statsMap: Record<string, GameWordStat> = {};
      for (const s of stats) statsMap[s.word_id] = s;

      const resultMap = new Map<number, { stars: number; rewardStar: number }>();
      let maxUnlocked = 1;
      for (const r of results) {
        resultMap.set(r.level, { stars: r.stars, rewardStar: r.reward_star });
        if (r.level >= maxUnlocked) maxUnlocked = r.level + 1;
      }
      setLevelResults(resultMap);
      setUnlockedLevel(Math.min(maxUnlocked, 100));

      // ④ 如果当前词书已通关（首次进入时检测），自动切换到下一本
      if (wordList.length === 0) {
        // 当前词书没有单词，直接切到下一本
        await advanceToNextBook(book);
      } else if (isBookCleared(wordList, statsMap)) {
        await advanceToNextBook(book);
      }
    } catch (e: any) {
      toast.error(e?.message ?? '加载失败');
    } finally {
      setLoading(false);
    }
  }, [familyId, memberId, toast, advanceToNextBook]);

  useEffect(() => { loadData(); }, [loadData]);

  // 同步当前关卡到全局 store（切换 tab 后回来可恢复）
  useEffect(() => {
    syncToStore(currentLevel, currentWords, currentBook?.id ?? null, currentBook?.title ?? '');
  }, [currentLevel, currentWords, currentBook, syncToStore]);

  // 选择关卡：按 display_order 升序取前 N 个词
  // ④ 同一词书内部严格使用词书预设单词顺序生成关卡
  // （错词 + 最后1个消除词已被 finish_game_level 推到队尾，等待后续重复复习）
  const handleSelectLevel = useCallback(async (level: number) => {
    if (bookWords.length === 0) {
      toast.warning('词书暂无单词，请联系家长导入');
      return;
    }
    const config = getLevelConfig(level);
    const wordCount = config.wordCount;

    // 按 display_order 升序取前 N 个
    const sorted = [...bookWords].sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0));
    const picked = sorted.slice(0, wordCount);

    if (picked.length === 0) {
      toast.warning('没有足够的单词，请联系家长导入更多');
      return;
    }

    setCurrentWords(picked);
    setCurrentLevel(level);
  }, [bookWords, toast]);

  // 闯关结束：保存结果并返回给 GamePlayBoard 显示完成画面
  const handleFinish = useCallback(async (result: {
    stars: number;
    wordIds: string[];
    wrongWordIds: string[];
    lastSelectedWordIds: string[];
  }): Promise<{ success: boolean; rewardStar: number; newUnlockedLevel: number } | null> => {
    if (!currentLevel || finishing || !currentBook) return null;
    setFinishing(true);
    try {
      const res = await finishGameLevel(
        memberId, familyId, currentLevel,
        result.stars, result.wordIds, result.wrongWordIds, result.lastSelectedWordIds,
      );
      onReward();

      // 重新加载当前词书的单词：错词+最后1个消除词已被 RPC 推到队尾，下一关要按新顺序取词
      // ② 快照锁定：只重载当前词书的单词（复习机制），不拉取其他词书
      let freshWords: PetWord[] = [];
      try {
        freshWords = await fetchPetWords(currentBook.id);
        setBookWords(freshWords);
      } catch { /* 静默：词库刷新失败不阻塞结算 */ }

      // 重新加载统计（用于通关检测）
      let freshStatsMap: Record<string, GameWordStat> = {};
      try {
        const freshStats = await fetchGameWordStats(memberId);
        for (const s of freshStats) freshStatsMap[s.word_id] = s;
      } catch { /* 静默 */ }

      // 刷新关卡结果
      setLevelResults(prev => {
        const next = new Map(prev);
        next.set(currentLevel, { stars: 3, rewardStar: res.reward_star });
        return next;
      });
      setUnlockedLevel(prev => Math.max(prev, res.new_unlocked_level));

      // 通关检测：当前词书所有单词 challenge_count>0 且 wrong_count===0
      if (freshWords.length > 0 && isBookCleared(freshWords, freshStatsMap)) {
        await advanceToNextBook(currentBook);
      }

      return { success: res.success, rewardStar: res.reward_star, newUnlockedLevel: res.new_unlocked_level };
    } catch (e: any) {
      toast.error(e?.message ?? '结算失败');
      return null;
    } finally {
      setFinishing(false);
    }
  }, [currentLevel, finishing, currentBook, memberId, familyId, toast, onReward, advanceToNextBook]);

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

  // 全部通关
  if (allCleared) {
    return (
      <div className="text-center py-12">
        <div className="text-5xl mb-3">🏆</div>
        <p className="text-sm font-semibold text-slate-700 mb-1">恭喜全部通关！</p>
        <p className="text-xs text-slate-400">所有词书已完成，等待家长添加新词书</p>
      </div>
    );
  }

  // 无词书或词书无单词
  if (!currentBook || bookWords.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="text-5xl mb-3">📚</div>
        <p className="text-sm text-slate-500 mb-1">词书暂无单词</p>
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
          <span className="text-xs text-slate-500">
            {currentBook.title} · 闯关赢星光值
          </span>
        </div>
        <span className="text-xs text-slate-400">已解锁 {unlockedLevel}/100</span>
      </div>
      <GameLevelMap
        unlockedLevel={unlockedLevel}
        levelResults={levelResults}
        onSelectLevel={handleSelectLevel}
        focusLevel={(() => {
          // 首个已解锁但未通关的关卡；若已解锁关卡全部通关，则定位到最新已解锁关
          for (let lv = 1; lv <= unlockedLevel; lv++) {
            if (!levelResults.has(lv)) return lv;
          }
          return unlockedLevel;
        })()}
      />
    </div>
  );
}
