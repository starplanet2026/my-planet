import { useState, useRef, useCallback, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useModeStore } from '../../store/modeStore';
import { useFamilyStore } from '../../store/familyStore';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Loading } from '../../components/common/Loading';
import { EmptyState } from '../../components/common/EmptyState';
import { useToastStore } from '../../store/toastStore';
import { ROUTES } from '../../lib/constants';
import { cn } from '../../lib/utils';
import { ArrowLeft, Mic, Square, RotateCcw, Send } from 'lucide-react';
import { getInstance, submitRecitationResult } from '../../api/recitation';
import { compareRecitation, type CompareResult } from '../../lib/recitationCompare';
import type { RecitationInstance } from '../../api/types';

// Web Speech API 类型声明（参考 ReciteQuestion.tsx）
interface SpeechRecognitionEventLike {
  results: { [key: number]: { 0: { transcript: string }; isFinal: boolean }[] };
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
}

function getRecognition(lang: string): SpeechRecognitionLike | null {
  const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SR) return null;
  const rec = new SR();
  rec.lang = lang;
  rec.continuous = true;
  rec.interimResults = true;
  return rec as SpeechRecognitionLike;
}

export function RecitationTaskPage() {
  const { instanceId } = useParams<{ instanceId: string }>();
  const navigate = useNavigate();
  const currentChildId = useModeStore(s => s.currentChildId);
  const memberId = currentChildId ?? '';
  const refreshMembers = useFamilyStore(s => s.refreshMembers);
  const toast = useToastStore();

  const [inst, setInst] = useState<RecitationInstance | null>(null);
  const [loading, setLoading] = useState(true);
  const [recording, setRecording] = useState(false);
  const [recognized, setRecognized] = useState('');
  const [interim, setInterim] = useState('');
  const [result, setResult] = useState<CompareResult | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const finalRef = useRef('');

  const reload = useCallback(async () => {
    if (!instanceId) return;
    setLoading(true);
    try {
      const data = await getInstance(instanceId);
      setInst(data);
      setSubmitted(data.status === 'submitted');
      // 已提交时回填识别文本与结果
      if (data.status === 'submitted' && data.recognized_text && data.task) {
        setRecognized(data.recognized_text);
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

  const ensureRec = useCallback(() => {
    if (recRef.current) return recRef.current;
    if (!task) return null;
    const rec = getRecognition(task.subject === 'english' ? 'en-US' : 'zh-CN');
    if (!rec) return null;
    rec.onresult = (e) => {
      let finalText = finalRef.current;
      let interimText = '';
      for (let i = 0; i < Object.keys(e.results).length; i++) {
        const r = e.results[i];
        if (r[0]) {
          if (r.isFinal) finalText += r[0].transcript;
          else interimText += r[0].transcript;
        }
      }
      finalRef.current = finalText;
      setInterim(interimText);
      setRecognized(finalText);
    };
    rec.onend = () => {
      setRecording(false);
      // 录音结束自动算分（仅在未提交且已有识别文本时）
      const text = finalRef.current;
      if (text && task && !submitted) {
        setResult(compareRecitation(task.answer_text, text, task.match_mode, task.subject));
      }
    };
    rec.onerror = () => {
      setRecording(false);
      toast.error('录音识别失败，请检查网络后重试');
    };
    recRef.current = rec;
    return rec;
  }, [task, submitted, toast]);

  const startRecording = () => {
    if (submitted || !task) return;
    // 清空上一次结果（重录）
    finalRef.current = '';
    setRecognized('');
    setInterim('');
    setResult(null);
    const rec = ensureRec();
    if (!rec) {
      toast.error('当前浏览器不支持语音识别，请使用 Chrome 浏览器');
      return;
    }
    try {
      rec.start();
      setRecording(true);
    } catch {
      // 已在录音中
    }
  };

  const stopRecording = () => {
    const rec = recRef.current;
    if (rec) {
      try { rec.stop(); } catch {}
    }
    setRecording(false);
  };

  const reRecord = () => {
    if (submitted) return;
    stopRecording();
    finalRef.current = '';
    setRecognized('');
    setInterim('');
    setResult(null);
  };

  const submit = async () => {
    if (!inst || !task || !memberId) return;
    if (!result) { toast.error('请先完成录音'); return; }
    setSubmitting(true);
    try {
      const res = await submitRecitationResult(inst.id, memberId, result.score, recognized);
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

  return (
    <div className="max-w-3xl mx-auto py-4 px-4">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => navigate(ROUTES.CHALLENGE)} className="p-2 hover:bg-slate-100 rounded-lg">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-xl font-bold flex items-center gap-2">📖 {task.title}</h1>
      </div>

      <p className="text-xs text-slate-500 mb-3">{subjectLabel} · {task.match_mode === 'fuzzy' ? '模糊匹配' : '严格匹配'} · 通过阈值 {task.pass_threshold}分</p>

      {/* 提示 */}
      <div className="mb-3 p-3 rounded-xl bg-amber-50 text-amber-700 text-sm">
        💡 请发音准确，避免识别不清，尽量在安静环境下录制
      </div>

      {/* 录音区 */}
      {!submitted && (
        <Card className="p-4 mb-4">
          {recording && (
            <div className="mb-3 flex items-center justify-center gap-2 text-red-500 text-sm">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              正在录音...
            </div>
          )}
          <div className="flex justify-center gap-2">
            {!recording ? (
              <Button variant="primary" onClick={startRecording}><Mic className="w-4 h-4" /> 开始录音</Button>
            ) : (
              <Button variant="danger" onClick={stopRecording}><Square className="w-4 h-4" /> 结束录音</Button>
            )}
            {recognized && !recording && (
              <Button variant="secondary" onClick={reRecord}><RotateCcw className="w-4 h-4" /> 重录</Button>
            )}
          </div>
          {/* 实时识别文本 */}
          {(recognized || interim) && (
            <div className="mt-4">
              <p className="text-xs text-slate-400 mb-1">识别中：</p>
              <p className="text-sm text-slate-600 p-2 rounded bg-slate-50 min-h-[2.5rem]">
                {recognized}{recording && <span className="text-slate-400">{interim}</span>}
              </p>
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
              <div className="p-3 rounded-xl bg-slate-50 text-base leading-loose min-h-[4rem]">
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
