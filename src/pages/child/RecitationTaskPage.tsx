import { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useModeStore } from '../../store/modeStore';
import { useFamilyStore } from '../../store/familyStore';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Loading } from '../../components/common/Loading';
import { EmptyState } from '../../components/common/EmptyState';
import { useToastStore } from '../../store/toastStore';
import { ROUTES } from '../../lib/constants';
import { cn } from '../../lib/utils';
import { ArrowLeft, Mic, Square, RotateCcw, Send, Award, Pause, Play, Edit3, Check } from 'lucide-react';
import { getInstance, submitRecitationResult } from '../../api/recitation';
import { compareRecitation, type CompareResult } from '../../lib/recitationCompare';
import { blobToAudioBuffer, audioBufferToWavBase64, deduplicateText, getAsrApiUrl } from '../../lib/asr';
import type { RecitationInstance } from '../../api/types';

// 奖励档位（从模板读取的三档配置）
interface RewardTier {
  min: number | null;
  max: number | null;
  stars: number | null;
}

export function RecitationTaskPage() {
  const { pathname } = useLocation();
  const instanceId = pathname.split('/')[3] ?? '';
  const navigate = useNavigate();
  const currentChildId = useModeStore(s => s.currentChildId);
  const memberId = currentChildId ?? '';
  const refreshMembers = useFamilyStore(s => s.refreshMembers);
  const toast = useToastStore();

  const [inst, setInst] = useState<RecitationInstance | null>(null);
  const [loading, setLoading] = useState(true);
  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  // finalText: 识别定稿文本
  const [finalText, setFinalText] = useState('');
  // editableText: 用户可编辑的识别文本
  const [editableText, setEditableText] = useState('');
  const [editing, setEditing] = useState(false);
  const [recognizing, setRecognizing] = useState(false);
  const [result, setResult] = useState<CompareResult | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);

  // 录音相关 ref
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const finalRef = useRef(''); // 已确认定稿文本
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const reload = useCallback(async () => {
    if (!instanceId) return;
    setLoading(true);
    try {
      const data = await getInstance(instanceId);
      setInst(data);
      setSubmitted(data.status === 'submitted');
      // 已提交时回填识别文本与结果
      if (data.status === 'submitted' && data.recognized_text && data.task) {
        finalRef.current = data.recognized_text;
        setFinalText(data.recognized_text);
        setEditableText(data.recognized_text);
        setResult(compareRecitation(data.task.answer_text, data.recognized_text, data.task.match_mode, data.task.subject));
      }
    } catch (e: any) {
      toast.error('加载失败：' + e.message);
    } finally {
      setLoading(false);
    }
  }, [instanceId]);

  useEffect(() => { reload(); }, [reload]);

  const task = inst?.task;

  // 清理所有录音资源（开始新录音前强制调用，防止多会话并发）
  const cleanupRecording = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (mediaRecorderRef.current) {
      try {
        if (mediaRecorderRef.current.state !== 'inactive') {
          mediaRecorderRef.current.stop();
        }
      } catch {}
      mediaRecorderRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    audioChunksRef.current = [];
    setPaused(false);
    setRecordSeconds(0);
  }, []);

  // 组件卸载时清理
  useEffect(() => {
    return () => cleanupRecording();
  }, [cleanupRecording]);

  // 调用豆包ASR接口识别音频
  const recognizeAudio = useCallback(async (blob: Blob): Promise<string> => {
    try {
      const audioBuffer = await blobToAudioBuffer(blob);
      const base64 = await audioBufferToWavBase64(audioBuffer, 16000);
      const res = await fetch(getAsrApiUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audio: base64,
          format: 'wav',
          rate: 16000,
          subject: task?.subject ?? 'chinese',
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `识别失败(${res.status})`);
      }
      const data = await res.json();
      return data.text || '';
    } catch (e: any) {
      throw e;
    }
  }, [task?.subject]);

  // 开始录音
  const startRecording = async () => {
    if (submitted || !task) return;

    // 关键：开始录音前强制销毁上一次的所有连接/会话，防止多会话并发造成重复回传
    cleanupRecording();

    // 清空上一次结果（重录）
    finalRef.current = '';
    setFinalText('');
    setEditableText('');
    setResult(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.start(500);
      setRecording(true);
      setPaused(false);
      setRecordSeconds(0);

      // 录音计时器
      timerRef.current = setInterval(() => {
        setRecordSeconds(s => s + 1);
      }, 1000);
    } catch (e: any) {
      if (e?.name === 'NotAllowedError' || e?.name === 'PermissionDeniedError') {
        toast.error('请在浏览器设置中开启麦克风权限后重试');
      } else {
        toast.error('录音启动失败：' + (e?.message || '未知错误'));
      }
      cleanupRecording();
    }
  };

  // 暂停/继续录音
  const togglePause = () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;
    if (paused) {
      recorder.resume();
      setPaused(false);
      timerRef.current = setInterval(() => setRecordSeconds(s => s + 1), 1000);
    } else {
      recorder.pause();
      setPaused(true);
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    }
  };

  // 结束录音
  const stopRecording = async () => {
    if (!recording) return;
    const recorder = mediaRecorderRef.current;
    const stream = streamRef.current;

    // 停止计时器
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (recorder && recorder.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
        try { recorder.stop(); } catch { resolve(); }
      });
    }

    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }

    setRecording(false);
    setPaused(false);

    // 用完整音频做最终识别（仅一次请求，避免QPS超限）
    if (audioChunksRef.current.length === 0) {
      toast.error('未录到音频，请重试');
      return;
    }
    const blob = new Blob(audioChunksRef.current, { type: recorder?.mimeType || 'audio/webm' });
    setRecognizing(true);
    try {
      let text = await recognizeAudio(blob);
      // 服务端兜底去重：检测连续重复片段并裁剪
      text = deduplicateText(text);
      finalRef.current = text;
      setFinalText(text);
      setEditableText(text);
      // 自动算分
      if (task && !submitted) {
        setResult(compareRecitation(task.answer_text, text, task.match_mode, task.subject));
      }
    } catch (e: any) {
      toast.error('识别失败：' + (e?.message || '请检查网络后重试'));
    } finally {
      setRecognizing(false);
      mediaRecorderRef.current = null;
      audioChunksRef.current = [];
    }
  };

  // 重录
  const reRecord = () => {
    if (submitted) return;
    cleanupRecording();
    finalRef.current = '';
    setFinalText('');
    setEditableText('');
    setResult(null);
    setEditing(false);
  };

  // 保存编辑后的文本并重新算分
  const saveEdit = () => {
    finalRef.current = editableText;
    setFinalText(editableText);
    setEditing(false);
    if (task) {
      setResult(compareRecitation(task.answer_text, editableText, task.match_mode, task.subject));
    }
  };

  const submit = async () => {
    if (!inst || !task || !memberId) return;
    if (!result) { toast.error('请先完成录音'); return; }
    setSubmitting(true);
    try {
      const res = await submitRecitationResult(inst.id, memberId, result.score, finalRef.current);
      if (res.success) {
        toast.success(`已提交！${res.passed ? '通过' : '未通过'}${res.awarded_stars > 0 ? `，获得 ${res.awarded_stars} 颗星光` : ''}`);
        setSubmitted(true);
        refreshMembers();
        await reload();
      } else {
        toast.error(res.message || '提交失败');
      }
    } catch (e: any) {
      toast.error('提交失败：' + e.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <Loading />;

  if (!inst || !task) {
    return (
      <div className="max-w-3xl mx-auto py-6 px-4">
        <EmptyState icon="📭" title="任务不存在" description="该背诵任务可能已下线或删除" />
      </div>
    );
  }

  const score = result?.score ?? 0;
  const passed = result ? score >= task.pass_threshold : false;
  const subjectLabel = task.subject === 'english' ? '英语' : '语文';

  // 奖励档位（从模板读取）
  const tiers: RewardTier[] = [
    { min: task.reward_tier1_min, max: task.reward_tier1_max, stars: task.reward_tier1_stars },
    { min: task.reward_tier2_min, max: task.reward_tier2_max, stars: task.reward_tier2_stars },
    { min: task.reward_tier3_min, max: task.reward_tier3_max, stars: task.reward_tier3_stars },
  ].filter(t => t.min !== null && t.min !== undefined);

  // 最高星光奖励
  const maxStars = tiers.reduce((mx, t) => Math.max(mx, t.stars ?? 0), 0);

  return (
    <div className="max-w-3xl mx-auto py-4 px-4">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => navigate(ROUTES.CHALLENGE)} className="p-2 hover:bg-slate-100 rounded-lg">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-xl font-bold flex items-center gap-2">📖 {task.title}</h1>
      </div>

      <p className="text-xs text-slate-500 mb-3">{subjectLabel} · {task.match_mode === 'fuzzy' ? '模糊匹配' : '严格匹配'}</p>

      {/* 任务奖励规则区域 */}
      <Card className="p-4 mb-3 bg-gradient-to-br from-amber-50 to-orange-50 border-amber-200">
        <div className="flex items-center justify-center gap-2 mb-3">
          <Award className="w-5 h-5 text-amber-500" />
          <h3 className="font-bold text-base text-amber-800">任务奖励规则</h3>
        </div>
        <p className="text-center text-sm text-amber-700 mb-3 font-medium">
          🎯 任务通过门槛：≥{task.pass_threshold}分
        </p>
        {tiers.length > 0 && maxStars > 0 ? (
          <div className="space-y-2">
            {tiers.map((t, i) => (
              <div key={i} className="flex items-center justify-center gap-2 bg-white/60 rounded-lg px-3 py-1.5">
                <span className="text-sm font-medium text-amber-700">{t.min}{t.max !== null && t.max !== undefined ? `-${t.max}` : '+'}分</span>
                <span className="text-amber-400">→</span>
                <span className="text-sm font-bold text-orange-600">⭐ {t.stars} 星光</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-center text-sm text-slate-400">本任务无星光奖励</p>
        )}
      </Card>

      {/* 提示 */}
      <div className="mb-3 p-3 rounded-xl bg-amber-50 text-amber-700 text-sm">
        💡 请发音准确，避免识别不清，尽量在安静环境下录制
      </div>

      {/* 录音区 */}
      {!submitted && (
        <Card className="p-4 mb-4">
          {(recording || recognizing) && (
            <div className="mb-3 flex items-center justify-center gap-2 text-red-500 text-sm">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              {recognizing ? '识别中，请稍候...' : paused ? '已暂停' : `正在录音 ${String(Math.floor(recordSeconds/60)).padStart(2,'0')}:${String(recordSeconds%60).padStart(2,'0')}`}
            </div>
          )}
          <div className="flex justify-center gap-2 flex-wrap">
            {!recording ? (
              <Button variant="primary" onClick={startRecording} disabled={recognizing}>
                <Mic className="w-4 h-4" /> 开始录音
              </Button>
            ) : (
              <>
                <Button variant="secondary" onClick={togglePause}>
                  {paused ? <><Play className="w-4 h-4" /> 继续</> : <><Pause className="w-4 h-4" /> 暂停</>}
                </Button>
                <Button variant="danger" onClick={stopRecording}>
                  <Square className="w-4 h-4" /> 结束录音
                </Button>
              </>
            )}
            {finalText && !recording && !recognizing && (
              <Button variant="secondary" onClick={reRecord}><RotateCcw className="w-4 h-4" /> 重录</Button>
            )}
          </div>
          {/* 识别结果（可编辑） */}
          {finalText && !recording && (
            <div className="mt-4">
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs text-slate-400">识别结果（可点击编辑修正）：</p>
                {!editing ? (
                  <button onClick={() => setEditing(true)} className="text-xs text-blue-500 hover:underline flex items-center gap-1">
                    <Edit3 className="w-3 h-3" /> 编辑
                  </button>
                ) : (
                  <button onClick={saveEdit} className="text-xs text-emerald-600 hover:underline flex items-center gap-1">
                    <Check className="w-3 h-3" /> 保存
                  </button>
                )}
              </div>
              {editing ? (
                <textarea
                  value={editableText}
                  onChange={(e) => setEditableText(e.target.value)}
                  className="w-full text-sm text-slate-700 p-2 rounded bg-slate-50 min-h-[4rem] leading-relaxed border border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  rows={3}
                />
              ) : (
                <p className="text-sm text-slate-700 p-2 rounded bg-slate-50 min-h-[2.5rem] leading-relaxed whitespace-pre-wrap">
                  {finalText}
                </p>
              )}
            </div>
          )}
        </Card>
      )}

      {/* 对照结果 */}
      {result && (
        <Card className="p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <span className={cn('text-lg font-bold', passed ? 'text-emerald-600' : 'text-red-500')}>
              {score}分 · {passed ? '已通过' : '未通过'}
            </span>
            {submitted && inst.passed !== null && (
              <span className="text-sm text-amber-600">+{inst.awarded_stars}⭐</span>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-slate-400 mb-1">你的背诵：</p>
              <div className="p-3 rounded-xl bg-slate-50 text-base leading-loose min-h-[4rem] whitespace-pre-wrap">
                {result.diff.map((t, i) => (
                  <span key={i} className={cn(
                    t.status === 'matched' && 'text-emerald-600 font-medium',
                    t.status === 'missing' && 'text-red-500 bg-red-50 rounded',
                    t.status === 'extra' && 'text-slate-400 bg-slate-200/50 rounded line-through',
                  )}>{t.text}</span>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs text-slate-400 mb-1">标准答案：</p>
              <div className="p-3 rounded-xl bg-slate-50 text-base leading-loose text-slate-700 whitespace-pre-wrap min-h-[4rem]">
                {task.answer_text}
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* 操作按钮 */}
      {result && !submitted && (
        <div className="flex flex-wrap gap-2 justify-center">
          <Button variant="secondary" onClick={reRecord}><RotateCcw className="w-4 h-4" /> 再做一次</Button>
          {passed && (
            <Button variant="primary" onClick={submit} disabled={submitting}>
              <Send className="w-4 h-4" /> 提交任务
            </Button>
          )}
          {!passed && (
            <p className="text-sm text-slate-500 self-center">得分未达通过阈值，请重录后再次提交</p>
          )}
        </div>
      )}

      {submitted && (
        <div className="text-center">
          <p className="text-sm text-slate-500 mb-2">该作业已提交，不可再修改</p>
          <Button variant="secondary" onClick={() => navigate(ROUTES.CHALLENGE)}>返回</Button>
        </div>
      )}
    </div>
  );
}
