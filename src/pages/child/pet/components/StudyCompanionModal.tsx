import { useState, useEffect, useRef, useCallback } from 'react';
import { Modal } from '../../../../components/common/Modal';
import { Button } from '../../../../components/common/Button';
import { useToastStore } from '../../../../store/toastStore';
import { useFamilyStore } from '../../../../store/familyStore';
import { useModeStore } from '../../../../store/modeStore';
import { usePetUiStore } from '../../../../store/petUiStore';
import { Minimize2 } from 'lucide-react';
import type { Pet } from '../../../../api/types';
import { supabase } from '../../../../api/client';
import {
  studyTaskReward, fetchStudyRecords,
  fetchStudyTaskTemplates, addStudyTaskTemplates,
  updateStudyTaskTemplate, deleteStudyTaskTemplate,
} from '../../../../api/pets';
import type { StudyRecord } from '../../../../api/pets';

// 心情恢复 = 分钟数（1分钟=1心情值）
const calcHappinessGain = (minutes: number) => minutes;

// 从任务文本中解析星光值奖励（如"英语学习 2星光值"或"背单词 3星"）
function parseReward(text: string): { label: string; reward: number } {
  // 匹配 "X星光值" / "X星光" / "X星" / "Xstar"
  const m = text.match(/\s*(\d+)\s*(?:星光值|星光|星|star)\s*$/i);
  if (m) {
    return { label: text.replace(/\s*\d+\s*(?:星光值|星光|星|star)\s*$/i, '').trim(), reward: parseInt(m[1], 10) };
  }
  return { label: text.trim(), reward: 0 };
}

// 陪伴学习鼓励语（每 10 分钟轮换）
const STUDY_MESSAGES = [
  '加油！专注的你最棒！',
  '你已经坚持很久了，继续！',
  '快完成啦，再坚持一下！',
  '学习让你更强大！💪',
  '你的宠物也在陪着你努力哦！',
];

interface StudyTask {
  id: string;
  text: string;
  reward: number;
  done: boolean;
  rewarded: boolean; // 是否已发放奖励（防止重复）
  selected?: boolean; // 任务模板是否被勾选（选择页使用）
}

export function StudyCompanionModal({
  pets,
  onClose,
  onCompleted,
}: {
  pets: Pet[];
  onClose: () => void;
  onCompleted: () => void;
}) {
  const toast = useToastStore();
  const refreshMembers = useFamilyStore(s => s.refreshMembers);
  const currentChildId = useModeStore(s => s.currentChildId);
  const childId = currentChildId ?? '';

  const [step, setStep] = useState<'select' | 'timer' | 'done' | 'records'>('select');
  const [selectedPet, setSelectedPet] = useState<Pet | null>(null);
  const [minutes, setMinutes] = useState(15);
  const [studyTask, setStudyTask] = useState('');
  const [taskList, setTaskList] = useState<StudyTask[]>([]);
  const [taskTemplates, setTaskTemplates] = useState<StudyTask[]>([]);
  const [templatesLoaded, setTemplatesLoaded] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const [studying, setStudying] = useState(false);
  const [paused, setPaused] = useState(false);
  const [happinessGain, setHappinessGain] = useState(0);
  const [totalStarEarned, setTotalStarEarned] = useState(0);
  // 倒计时归零后停留在页面等待领取奖励；rewardClaimed 标记是否已领取
  const [studyEnded, setStudyEnded] = useState(false);
  const [rewardClaimed, setRewardClaimed] = useState(false);
  const [records, setRecords] = useState<StudyRecord[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 从全局 store 恢复学习状态（切换 tab 回来后续上）
  const persistedStep = usePetUiStore(s => s.studyStep);
  const persistedPetId = usePetUiStore(s => s.studyPetId);
  const persistedMinutes = usePetUiStore(s => s.studyMinutes);
  const persistedTaskText = usePetUiStore(s => s.studyTaskText);
  const persistedTaskList = usePetUiStore(s => s.studyTaskList);
  const persistedRemaining = usePetUiStore(s => s.studyRemaining);
  const persistedStudying = usePetUiStore(s => s.studyStudying);
  const persistedPaused = usePetUiStore(s => s.studyPaused);
  const persistedEndsAt = usePetUiStore(s => s.studyEndsAt);
  const persistedPausedAccumMs = usePetUiStore(s => s.studyPausedAccumMs);
  const persistedPauseStartAt = usePetUiStore(s => s.studyPauseStartAt);
  const persistedMinimized = usePetUiStore(s => s.studyMinimized);
  const persistedTotalStar = usePetUiStore(s => s.studyTotalStarEarned);
  const persistedStudyEnded = usePetUiStore(s => s.studyEnded);
  const persistedRewardClaimed = usePetUiStore(s => s.studyRewardClaimed);
  const setStudyState = usePetUiStore(s => s.setStudyState);
  const clearStudyState = usePetUiStore(s => s.clearStudyState);
  const restoredRef = useRef(false);
  // 跳过首次渲染的 store 同步，避免初始空状态覆盖已持久化的学习进度
  const skipSyncRef = useRef(true);
  // 防止同一任务快速重复点击触发多次发奖（同步锁）
  const rewardingRef = useRef<Set<string>>(new Set());
  // 时间戳驱动：学习应结束的绝对时间（ms），null 表示未在学习
  const [endsAt, setEndsAt] = useState<number | null>(null);
  // 累计已暂停时长（ms）
  const [pausedAccumMs, setPausedAccumMs] = useState(0);
  // 本次暂停开始时间戳（ms），null 表示未暂停
  const [pauseStartAt, setPauseStartAt] = useState<number | null>(null);
  // 最小化标志
  const [minimized, setMinimized] = useState(false);

  // 首次挂载时从 store 恢复
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    if (persistedStep !== 'select' || persistedPetId) {
      setStep(persistedStep);
      setMinutes(persistedMinutes);
      setStudyTask(persistedTaskText);
      setTaskList(persistedTaskList as StudyTask[]);
      setTotalStarEarned(persistedTotalStar);
      setEndsAt(persistedEndsAt);
      setPausedAccumMs(persistedPausedAccumMs);
      setPauseStartAt(persistedPauseStartAt);
      setMinimized(persistedMinimized);
      setStudyEnded(persistedStudyEnded);
      setRewardClaimed(persistedRewardClaimed);
      const pet = pets.find(p => p.id === persistedPetId);
      if (pet) setSelectedPet(pet);
      // 时间戳驱动恢复：若 endsAt 在未来，继续倒计时（不暂停）
      if (persistedEndsAt) {
        const now = Date.now();
        if (now < persistedEndsAt) {
          setRemaining(Math.max(0, Math.round((persistedEndsAt - now) / 1000)));
          setStudying(true);
          setPaused(false);
        } else {
          // 最小化/切走期间已到期，留待 timer effect 触发结算
          setRemaining(0);
          setStudying(true);
          setPaused(false);
        }
      } else {
        setRemaining(persistedRemaining);
        setStudying(false);
        setPaused(true);
      }
    }
  }, []);

  // 同步状态到 store（切换 tab 后可恢复）；跳过首次渲染避免覆盖已恢复的进度
  useEffect(() => {
    if (skipSyncRef.current) {
      skipSyncRef.current = false;
      return;
    }
    setStudyState({
      studyStep: step,
      studyPetId: selectedPet?.id ?? null,
      studyMinutes: minutes,
      studyTaskText: studyTask,
      studyTaskList: taskList,
      studyRemaining: remaining,
      studyStudying: studying,
      studyPaused: paused,
      studyEndsAt: endsAt,
      studyPausedAccumMs: pausedAccumMs,
      studyPauseStartAt: pauseStartAt,
      studyMinimized: minimized,
      studyTotalStarEarned: totalStarEarned,
      studyEnded,
      studyRewardClaimed: rewardClaimed,
    });
  }, [step, selectedPet, minutes, studyTask, taskList, remaining, studying, paused, endsAt, pausedAccumMs, pauseStartAt, minimized, totalStarEarned, studyEnded, rewardClaimed, setStudyState]);

  // 从数据库加载任务模板（多端同步）
  useEffect(() => {
    if (!childId || templatesLoaded) return;
    fetchStudyTaskTemplates(childId).then(list => {
      setTaskTemplates(list.map(t => ({
        id: t.id, text: t.text, reward: t.reward,
        done: false, rewarded: false, selected: t.selected,
      })));
      setTemplatesLoaded(true);
    }).catch(() => setTemplatesLoaded(true));
  }, [childId, templatesLoaded]);

  // 用户主动关闭：清空 store 中的学习状态，下次打开从 select 开始
  const handleClose = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    clearStudyState();
    onClose();
  }, [clearStudyState, onClose]);

  // 最小化：仅隐藏为小浮窗，倒计时与心情奖励继续（不暂停、不清状态）
  const handleMinimize = useCallback(() => {
    setMinimized(true);
  }, []);

  // 从最小化恢复完整视图
  const handleRestore = useCallback(() => {
    setMinimized(false);
  }, []);

  // 倒计时（时间戳驱动；暂停时停止累计。最小化期间继续）
  useEffect(() => {
    if (!studying || paused || !endsAt) return;
    // 立即校验是否已到期
    const tick = () => {
      const rem = Math.max(0, Math.round((endsAt - Date.now()) / 1000));
      setRemaining(rem);
      if (rem <= 0) {
        // 倒计时归零：停留在页面，不自动关闭，等待用户点击小狗领取奖励
        if (intervalRef.current) clearInterval(intervalRef.current);
        setStudying(false);
        setStudyEnded(true);
      }
    };
    tick();
    intervalRef.current = setInterval(tick, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
    // 最小化切换也纳入依赖，确保从最小化恢复时计时器一定重启
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studying, paused, endsAt, minimized]);

  // 自动生成任务：将输入框每行解析为任务条目，写入数据库（多端同步）
  const handleGenerateTasks = async () => {
    const lines = studyTask
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(s => s.length > 0);
    if (lines.length === 0) {
      toast.info('请在输入框中输入任务，每行一个');
      return;
    }
    const items = lines.map(line => {
      const { label, reward } = parseReward(line);
      return { text: label, reward };
    });
    try {
      const created = await addStudyTaskTemplates(childId, items);
      setTaskTemplates(prev => [...prev, ...created.map(t => ({
        id: t.id, text: t.text, reward: t.reward,
        done: false, rewarded: false, selected: t.selected,
      }))]);
      setStudyTask('');
      toast.success(`已生成 ${created.length} 个任务`);
    } catch (e: any) {
      toast.error(e?.message ?? '生成失败');
    }
  };

  // 勾选/取消勾选任务模板
  const handleToggleSelect = async (taskId: string) => {
    const task = taskTemplates.find(t => t.id === taskId);
    if (!task) return;
    const newSelected = !task.selected;
    setTaskTemplates(prev => prev.map(t =>
      t.id === taskId ? { ...t, selected: newSelected } : t
    ));
    try {
      await updateStudyTaskTemplate(taskId, { selected: newSelected });
    } catch (e: any) {
      // 失败回退
      setTaskTemplates(prev => prev.map(t =>
        t.id === taskId ? { ...t, selected: !newSelected } : t
      ));
      toast.error(e?.message ?? '更新失败');
    }
  };

  // 删除单个任务模板
  const handleDeleteTask = async (taskId: string) => {
    setTaskTemplates(prev => prev.filter(t => t.id !== taskId));
    try {
      await deleteStudyTaskTemplate(taskId);
    } catch (e: any) {
      toast.error(e?.message ?? '删除失败');
      // 重新加载
      if (childId) {
        fetchStudyTaskTemplates(childId).then(list => {
          setTaskTemplates(list.map(t => ({
            id: t.id, text: t.text, reward: t.reward,
            done: false, rewarded: false, selected: t.selected,
          })));
        });
      }
    }
  };

  const handleStart = () => {
    if (!selectedPet) return;
    // 取已勾选的任务模板作为本次学习任务
    const selectedTasks = taskTemplates.filter(t => t.selected);
    if (selectedTasks.length === 0) {
      toast.info('请至少勾选一个任务');
      return;
    }
    const tasks: StudyTask[] = selectedTasks.map((t, i) => ({
      id: String(i), text: t.text, reward: t.reward, done: false, rewarded: false,
    }));
    const totalSec = minutes * 60;
    setTaskList(tasks);
    setTotalStarEarned(0);
    setRemaining(totalSec);
    setPausedAccumMs(0);
    setPauseStartAt(null);
    setMinimized(false);
    setStudyEnded(false);
    setRewardClaimed(false);
    setEndsAt(Date.now() + totalSec * 1000);
    setStudying(true);
    setPaused(false);
    setStep('timer');
  };

  // 勾选/取消勾选任务（单任务只发一次星光值：首次完成发奖，后续恢复/再完成不重复发）
  const handleToggleTask = async (taskId: string) => {
    const task = taskList.find(t => t.id === taskId);
    if (!task) return;
    const willBeDone = !task.done;

    // 首次完成 + 有奖励 + 未发过 + 未在发奖中：才触发发奖
    const shouldReward = willBeDone && task.reward > 0 && !task.rewarded && !rewardingRef.current.has(taskId);
    if (shouldReward) {
      // 同步加锁，防止快速重复点击在 await 期间多次进入发奖分支
      rewardingRef.current.add(taskId);
    }

    // 同步更新 done 与 rewarded（乐观标记 rewarded，避免重复发奖）
    setTaskList(prev => prev.map(x => x.id === taskId ? {
      ...x,
      done: willBeDone,
      rewarded: shouldReward ? true : x.rewarded,
    } : x));

    if (shouldReward) {
      try {
        const result = await studyTaskReward(childId, task.reward);
        if (result.success) {
          setTotalStarEarned(prev => prev + task.reward);
          toast.success(`完成任务！获得 ${task.reward} 星光值`);
          refreshMembers();
          onCompleted();
        } else {
          // 后端未成功：回退勾选与 rewarded
          setTaskList(prev => prev.map(x => x.id === taskId ? { ...x, done: false, rewarded: false } : x));
        }
      } catch (e: any) {
        toast.error(e?.message ?? '奖励领取失败');
        // 失败则回退勾选状态与 rewarded
        setTaskList(prev => prev.map(x => x.id === taskId ? { ...x, done: false, rewarded: false } : x));
      } finally {
        rewardingRef.current.delete(taskId);
      }
    }
  };

  // 完成学习：按实际学习分钟数结算（学了多久就恢复多少心情值）
  const finishStudy = async (actualMinutes: number) => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setStudying(false);
    setMinimized(false);
    setEndsAt(null);
    // 实际学习分钟数至少为 0（不足 1 分钟不记录不发奖）
    const minutes2 = Math.max(0, Math.round(actualMinutes));
    if (minutes2 <= 0) {
      // 不足 1 分钟，不记录、不发奖，直接关闭
      handleClose();
      return;
    }
    try {
      const tasksForRecord = taskList.map(t => ({ text: t.text, reward: t.reward, done: t.done }));
      const { data, error } = await supabase.rpc('study_reward', {
        p_member_id: childId,
        p_minutes: minutes2,
        p_reward: 0,
        p_pet_id: selectedPet?.id ?? null,
        p_tasks: tasksForRecord,
        p_star_earned: totalStarEarned,
      });
      if (error) throw error;
      const result = Array.isArray(data) ? data[0] : data;
      const gain = (result as any)?.happiness_gain ?? minutes2;
      setHappinessGain(gain);
      if (result?.success) {
        refreshMembers();
        onCompleted();
      }
    } catch (e: any) {
      toast.error(e?.message ?? '领取奖励失败');
    }
    setStep('done');
  };

  // 倒计时归零后：点击小狗领取本次心情值奖励（记录一次学习，不关闭页面）
  const handleClaimReward = async () => {
    if (rewardClaimed || !studyEnded) return;
    try {
      const tasksForRecord = taskList.map(t => ({ text: t.text, reward: t.reward, done: t.done }));
      const { data, error } = await supabase.rpc('study_reward', {
        p_member_id: childId,
        p_minutes: minutes,
        p_reward: 0,
        p_pet_id: selectedPet?.id ?? null,
        p_tasks: tasksForRecord,
        p_star_earned: totalStarEarned,
      });
      if (error) throw error;
      const result = Array.isArray(data) ? data[0] : data;
      const gain = (result as any)?.happiness_gain ?? minutes;
      setHappinessGain(gain);
      setRewardClaimed(true);
      refreshMembers();
      onCompleted();
      toast.success(`领取成功：心情 +${gain}，星光 +${totalStarEarned}`);
    } catch (e: any) {
      toast.error(e?.message ?? '领取奖励失败');
    }
  };

  const handleComplete = async () => {
    // 倒计时归零，实际学习 = 设置的时长（不含暂停）
    await finishStudy(minutes);
  };

  // 加载学习记录
  const loadRecords = async () => {
    setRecordsLoading(true);
    try {
      const list = await fetchStudyRecords(childId, 50);
      setRecords(list);
    } catch (e: any) {
      toast.error(e?.message ?? '加载记录失败');
    } finally {
      setRecordsLoading(false);
    }
  };

  // 计算实际学习分钟数（总时长 - 已暂停累计 - 当前正在暂停的时长）
  const computeActualMinutes = () => {
    if (!endsAt) return 0;
    const now = Date.now();
    const totalMs = minutes * 60 * 1000;
    const elapsedMs = Math.min(totalMs, Math.max(0, now - (endsAt - totalMs)));
    let pausedMs = pausedAccumMs;
    if (paused && pauseStartAt) {
      pausedMs += now - pauseStartAt;
    }
    const studyMs = Math.max(0, elapsedMs - pausedMs);
    return studyMs / 1000 / 60;
  };

  const handlePauseToggle = () => {
    if (!endsAt) return;
    if (paused) {
      // 恢复：累计本次暂停时长，并把 endsAt 后移（补回暂停时间）
      if (pauseStartAt) {
        const pausedMs = Date.now() - pauseStartAt;
        setPausedAccumMs(prev => prev + pausedMs);
        setEndsAt(prev => prev ? prev + pausedMs : prev);
      }
      setPauseStartAt(null);
      setPaused(false);
    } else {
      // 暂停：记录开始时间
      setPauseStartAt(Date.now());
      setPaused(true);
    }
  };

  const handleQuit = async () => {
    // 用户主动结束：按实际学习分钟数结算（学了多久就恢复多少心情值，且记录一次）
    const actualMinutes = computeActualMinutes();
    if (actualMinutes >= 1) {
      toast.info(`学习了 ${Math.round(actualMinutes)} 分钟，已记录并恢复心情`);
    } else {
      toast.info('学习时间不足 1 分钟');
    }
    await finishStudy(actualMinutes);
  };

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  // 最小化浮窗：学习继续，仅显示剩余时间，点击恢复
  if (minimized && step === 'timer' && endsAt) {
    return (
      <button
        onClick={handleRestore}
        title="点击恢复陪伴学习"
        className="fixed bottom-4 right-4 z-50 flex items-center gap-2 px-4 py-2.5 rounded-full bg-white shadow-lg border border-green-200 hover:bg-green-50 transition-colors"
      >
        <span className="text-lg">{studyEnded ? '🎁' : '📚'}</span>
        <div className="flex flex-col items-start leading-tight">
          <span className="text-[10px] text-slate-400">{studyEnded ? (rewardClaimed ? '奖励已领取' : '点击领取奖励') : '陪伴学习中'}</span>
          <span className="text-sm font-bold text-green-600 tabular-nums">{studyEnded ? '完成' : formatTime(remaining)}</span>
        </div>
      </button>
    );
  }

  // 选择宠物+时长
  if (step === 'select') {
    return (
      <Modal open onClose={handleClose} title="陪伴学习" size="md">
        <div className="space-y-4">
          {/* 选择宠物 */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">选择陪伴宠物</label>
            {pets.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-4">还没有领养宠物，先去领养一只吧</p>
            ) : (
              <div className="grid grid-cols-4 gap-2">
                {pets.map(pet => (
                  <button
                    key={pet.id}
                    onClick={() => setSelectedPet(pet)}
                    className={`flex flex-col items-center p-2 rounded-xl border-2 transition-colors ${
                      selectedPet?.id === pet.id
                        ? 'border-green-400 bg-green-50'
                        : 'border-slate-100 bg-white'
                    }`}
                  >
                    {pet.image_url ? (
                      <img src={pet.image_url} alt="" className="w-10 h-10 object-contain" />
                    ) : (
                      <span className="text-2xl">{pet.emoji || '🐾'}</span>
                    )}
                    <span className="text-[10px] text-slate-500 mt-1 truncate w-full text-center">{pet.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 今日任务 */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">今日任务</label>
            <textarea
              value={studyTask}
              onChange={e => setStudyTask(e.target.value)}
              placeholder={'如：\n英语学习 2星光值\n背20个单词 3星光值\n阅读课文第3课 1星光值'}
              maxLength={300}
              rows={4}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:border-green-400 focus:outline-none resize-none"
            />
            <p className="text-[10px] text-slate-400 mt-1">每行一个任务，可在任务名后加"X星光值"设置奖励；支持多次粘贴追加</p>
            <button
              type="button"
              onClick={handleGenerateTasks}
              disabled={!studyTask.trim()}
              className="mt-2 w-full py-2 rounded-xl bg-green-50 text-green-600 text-sm font-medium hover:bg-green-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              自动生成任务
            </button>

            {/* 已生成的任务模板列表 */}
            {taskTemplates.length > 0 && (
              <div className="mt-3 space-y-1.5">
                <p className="text-[11px] text-slate-400">
                  已生成 {taskTemplates.length} 个任务，已勾选 {taskTemplates.filter(t => t.selected).length} 个
                </p>
                <ul className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                  {taskTemplates.map(t => (
                    <li
                      key={t.id}
                      className={`flex items-center gap-2 p-2 rounded-lg border transition-colors ${
                        t.selected ? 'border-green-300 bg-green-50' : 'border-slate-100 bg-white'
                      }`}
                    >
                      {/* 勾选框 */}
                      <button
                        type="button"
                        onClick={() => handleToggleSelect(t.id)}
                        className={`flex-shrink-0 w-5 h-5 rounded-md border-2 flex items-center justify-center text-xs transition-colors ${
                          t.selected ? 'bg-green-400 border-green-400 text-white' : 'border-slate-300 hover:border-green-300'
                        }`}
                      >
                        {t.selected ? '✓' : ''}
                      </button>
                      {/* 任务名称 + 奖励 */}
                      <span className="flex-1 min-w-0 text-sm text-slate-700 truncate">
                        {t.text}
                        {t.reward > 0 && (
                          <span className="text-amber-500 text-xs ml-1">⭐{t.reward}</span>
                        )}
                      </span>
                      {/* 删除按钮 */}
                      <button
                        type="button"
                        onClick={() => handleDeleteTask(t.id)}
                        className="flex-shrink-0 w-6 h-6 rounded-md text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors"
                        title="删除任务"
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* 选择时长 */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              学习时长：<span className="text-green-600 font-bold">{minutes} 分钟</span>
              <span className="text-xs text-slate-400 ml-2">恢复宠物心情 {calcHappinessGain(minutes)} 点</span>
            </label>
            <input
              type="range"
              min={5}
              max={120}
              step={5}
              value={minutes}
              onChange={e => setMinutes(Number(e.target.value))}
              className="w-full accent-green-500"
            />
            <div className="flex justify-between text-[10px] text-slate-400 mt-1">
              <span>5分钟</span>
              <span>30分钟</span>
              <span>60分钟</span>
              <span>120分钟</span>
            </div>
          </div>

          <Button onClick={handleStart} disabled={!selectedPet} className="w-full">
            开始陪伴学习
          </Button>

          {/* 学习记录入口 */}
          <button
            onClick={() => { setStep('records'); loadRecords(); }}
            className="w-full flex items-center justify-center gap-1.5 py-2 text-sm text-slate-500 hover:text-slate-700 transition-colors"
          >
            <span>📋</span>
            <span>学习记录</span>
          </button>
        </div>
      </Modal>
    );
  }

  // 学习记录页
  if (step === 'records') {
    return (
      <Modal open onClose={handleClose} title="陪伴学习记录" size="md">
        <div className="space-y-3">
          <button
            onClick={() => setStep('select')}
            className="text-sm text-slate-500 hover:text-slate-700 flex items-center gap-1"
          >
            <span>←</span> 返回
          </button>

          {recordsLoading ? (
            <p className="text-sm text-slate-400 text-center py-8">加载中...</p>
          ) : records.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">还没有学习记录</p>
          ) : (
            <div className="space-y-2 max-h-[60vh] overflow-y-auto">
              {records.map(r => {
                const date = new Date(r.created_at);
                const dateStr = `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
                return (
                  <div key={r.id} className="rounded-xl border border-slate-100 p-3 bg-white">
                    {/* 头部：时间 + 时长 */}
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-slate-400">{dateStr}</span>
                      <div className="flex items-center gap-2 text-[10px]">
                        <span className="px-1.5 py-0.5 rounded-full bg-green-50 text-green-600">
                          ⏱ {r.minutes}分钟
                        </span>
                        {r.happiness_gain > 0 && (
                          <span className="px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-600">
                            💚 心情+{r.happiness_gain}
                          </span>
                        )}
                        {r.star_earned > 0 && (
                          <span className="px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600">
                            ⭐ +{r.star_earned}
                          </span>
                        )}
                      </div>
                    </div>
                    {/* 陪伴宠物 */}
                    {r.pet_name && (
                      <p className="text-[10px] text-slate-400 mb-1">陪伴宠物：{r.pet_name}</p>
                    )}
                    {/* 任务列表 */}
                    {r.tasks && r.tasks.length > 0 && (
                      <ul className="space-y-1 mt-1">
                        {r.tasks.map((t, i) => (
                          <li key={i} className="flex items-center gap-1.5 text-xs">
                            <span className={`w-3 h-3 rounded border flex items-center justify-center text-[8px] ${
                              t.done ? 'bg-green-400 border-green-400 text-white' : 'border-slate-300'
                            }`}>
                              {t.done ? '✓' : ''}
                            </span>
                            <span className={t.done ? 'text-slate-400 line-through' : 'text-slate-600'}>
                              {t.text}
                            </span>
                            {t.reward > 0 && (
                              <span className="text-amber-500 text-[10px]">⭐{t.reward}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Modal>
    );
  }

  // 倒计时全屏锁定
  if (step === 'timer') {
    const elapsedSeconds = minutes * 60 - remaining;
    const elapsedMinutes = Math.floor(elapsedSeconds / 60);
    const messageIdx = Math.floor(elapsedMinutes / 10) % STUDY_MESSAGES.length;
    const currentMessage = STUDY_MESSAGES[messageIdx];
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'linear-gradient(to bottom, #E8F5E9, #C8E6C9)' }}>
        {/* 最小化按钮（左上角） */}
        <button
          onClick={handleMinimize}
          title="最小化（可去其他页面，回来点陪伴学习继续）"
          className="absolute top-4 left-4 flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/80 text-slate-600 text-sm font-medium hover:bg-white shadow-sm z-10"
        >
          <Minimize2 className="w-4 h-4" />
          <span>最小化</span>
        </button>
        <div className="flex flex-col md:flex-row items-center justify-center gap-10 md:gap-20 w-full h-full max-w-5xl">
          {/* 左侧：时间（上）+ 对话框（中）+ 宠物（下） */}
          <div className="flex flex-col items-center gap-3 flex-shrink-0">
            {/* 倒计时（大） */}
            <div className="bg-white/95 rounded-3xl px-10 py-4 shadow-lg">
              <p className="text-6xl md:text-7xl font-bold text-slate-700 tabular-nums text-center leading-none">
                {formatTime(remaining)}
              </p>
              <div className="flex items-center justify-center gap-3 mt-2 text-xs text-slate-400">
                <span>恢复心情 {calcHappinessGain(minutes)} 点</span>
                {totalStarEarned > 0 && (
                  <span className="text-amber-500 font-medium">已获 ⭐ {totalStarEarned}</span>
                )}
              </div>
            </div>
            {/* 对话框：小狗说的话 */}
            <div className="bg-white/95 rounded-2xl px-6 py-3 max-w-xs shadow-md relative">
              <p className="text-base md:text-lg text-slate-600 text-center leading-relaxed">
                {studyEnded
                  ? (rewardClaimed ? '奖励已领取，下次再一起学习吧' : '学习结束啦，快来领取奖励吧')
                  : currentMessage}
              </p>
              <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-white/95 rotate-45" />
            </div>
            {/* 宠物（倒计时归零后可点击领取奖励） */}
            {selectedPet && (
              <button
                type="button"
                onClick={studyEnded && !rewardClaimed ? handleClaimReward : undefined}
                disabled={!(studyEnded && !rewardClaimed)}
                className={`flex flex-col items-center ${studyEnded && !rewardClaimed ? 'cursor-pointer animate-pulse' : 'cursor-default'}`}
                title={studyEnded && !rewardClaimed ? '点击领取奖励' : ''}
              >
                {selectedPet.image_url ? (
                  <img src={selectedPet.image_url} alt="" className="w-56 h-64 object-contain" />
                ) : (
                  <span className="text-9xl">{selectedPet.emoji || '🐾'}</span>
                )}
                <span className="text-sm text-slate-500">
                  {studyEnded
                    ? (rewardClaimed ? '奖励已领取' : '点击我领取奖励')
                    : `${selectedPet.name} 陪伴你学习中`}
                </span>
              </button>
            )}
          </div>

          {/* 右侧：学习任务 + 按钮（更大） */}
          <div className="flex flex-col items-center gap-5 md:flex-1 md:max-w-md w-full h-full max-h-screen py-4 min-h-0">
            {/* 学习任务列表（可逐条勾选完成，内部滚动，不会把按钮顶出画面） */}
            {taskList.length > 0 && (
              <div className="w-full bg-white/80 rounded-2xl p-4 shadow-sm flex-1 min-h-0 flex flex-col overflow-hidden">
                <p className="text-sm text-slate-500 mb-3 flex items-center justify-between flex-shrink-0">
                  <span className="font-medium">📚 学习任务</span>
                  <span className="text-xs text-slate-400">
                    已完成 {taskList.filter(t => t.done).length}/{taskList.length}
                  </span>
                </p>
                <ul className="space-y-2.5 overflow-y-auto flex-1 min-h-0 pr-1">
                  {taskList.map(t => (
                    <li key={t.id}>
                      <button
                        onClick={() => handleToggleTask(t.id)}
                        className={`w-full flex items-start gap-3 text-left p-2.5 rounded-xl transition-colors ${
                          t.done ? 'bg-green-50' : 'bg-white/70 hover:bg-white'
                        }`}
                      >
                        <span className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded-md border-2 flex items-center justify-center text-xs ${
                          t.done ? 'bg-green-400 border-green-400 text-white' : 'border-slate-300'
                        }`}>
                          {t.done ? '✓' : ''}
                        </span>
                        <div className="flex-1 min-w-0">
                          <span className={`text-base leading-snug block ${t.done ? 'text-slate-400 line-through' : 'text-slate-700'}`}>
                            {t.text}
                          </span>
                          {t.reward > 0 && (
                            <span className={`text-xs inline-flex items-center gap-0.5 mt-1 ${t.done ? 'text-amber-300' : 'text-amber-500'}`}>
                              ⭐ {t.reward} 星光值
                            </span>
                          )}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {/* 横向按钮（固定在底部，不被任务顶出画面） */}
            <div className="flex gap-4 mt-2 flex-shrink-0">
              {/* 倒计时归零后隐藏暂停按钮 */}
              {!studyEnded && (
                <button
                  onClick={handlePauseToggle}
                  className="px-8 py-3 rounded-xl bg-white/80 text-slate-700 text-base font-medium hover:bg-white shadow-sm"
                >
                  {paused ? '继续' : '暂停一下'}
                </button>
              )}
              <button
                onClick={studyEnded ? handleClose : handleQuit}
                className="px-8 py-3 rounded-xl bg-red-100/80 text-red-600 text-base font-medium hover:bg-red-100 shadow-sm"
              >
                结束学习
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 完成
  if (step === 'done') {
    return (
      <Modal open onClose={handleClose} title="学习完成" size="sm">
        <div className="text-center space-y-4 py-4">
          <div className="text-6xl">🎉</div>
          <p className="text-lg font-bold text-slate-700">太棒了！</p>
          <div className="space-y-1 text-sm text-slate-500">
            <p>本次陪伴学习 {happinessGain} 分钟</p>
            {selectedPet && happinessGain > 0 && (
              <p>宠物心情恢复 <span className="text-green-600 font-bold">{happinessGain}</span> 点</p>
            )}
            {totalStarEarned > 0 && (
              <p>完成任务获得 <span className="text-amber-500 font-bold">⭐ {totalStarEarned}</span> 星光值</p>
            )}
          </div>
          <Button onClick={handleClose} className="w-full">返回</Button>
        </div>
      </Modal>
    );
  }

  return null;
}
