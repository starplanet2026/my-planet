import { useState, useRef, useCallback } from 'react';
import { cn } from '../../../../lib/utils';
import { Mic, Square, Volume2 } from 'lucide-react';
import { Button } from '../../../../components/common/Button';
import type { QuestionComponentProps } from './QuestionRenderer';

// Web Speech API 类型声明
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

function getRecognition(): SpeechRecognitionLike | null {
  const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SR) return null;
  const rec = new SR();
  rec.lang = 'zh-CN';
  rec.continuous = true;
  rec.interimResults = true;
  return rec as SpeechRecognitionLike;
}

export function ReciteQuestion({ question: q, answer, setAnswer, showResult, isCorrect, disabled }: QuestionComponentProps) {
  const [recording, setRecording] = useState(false);
  const [interim, setInterim] = useState('');
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const finalRef = useRef('');

  // 初始化识别器
  const ensureRec = useCallback(() => {
    if (recRef.current) return recRef.current;
    const rec = getRecognition();
    if (!rec) return null;
    rec.onresult = (e) => {
      let finalText = finalRef.current;
      let interimText = '';
      for (let i = 0; i < Object.keys(e.results).length; i++) {
        const result = e.results[i];
        if (result[0]) {
          if (result.isFinal) {
            finalText += result[0].transcript;
          } else {
            interimText += result[0].transcript;
          }
        }
      }
      finalRef.current = finalText;
      setInterim(interimText);
      setAnswer(finalText);
    };
    rec.onend = () => {
      setRecording(false);
    };
    rec.onerror = () => {
      setRecording(false);
    };
    recRef.current = rec;
    return rec;
  }, [setAnswer]);

  const startRecording = () => {
    if (showResult || disabled) return;
    const rec = ensureRec();
    if (!rec) {
      // 不支持语音识别，提示手动输入
      alert('当前浏览器不支持语音识别，请手动输入背诵内容');
      return;
    }
    finalRef.current = answer || '';
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

  // 播放参考文本（仅提交后可听）
  const speakRef = () => {
    if ('speechSynthesis' in window) {
      const utter = new SpeechSynthesisUtterance(q.correct_answer);
      utter.lang = 'zh-CN';
      utter.rate = 0.8;
      window.speechSynthesis.speak(utter);
    }
  };

  const displayText = answer + (recording ? interim : '');

  return (
    <div>
      {/* 提示 */}
      {q.metadata?.hint && (
        <p className="text-sm text-slate-500 mb-3 text-center">💡 {q.metadata.hint}</p>
      )}

      {/* 识别中状态 */}
      {recording && (
        <div className="mb-3 flex items-center justify-center gap-2 text-red-500 text-sm">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          正在录音...
        </div>
      )}

      {/* 文本编辑区 */}
      <textarea
        value={displayText}
        onChange={e => {
          finalRef.current = e.target.value;
          setInterim('');
          setAnswer(e.target.value);
        }}
        disabled={showResult || disabled}
        placeholder="点击麦克风开始背诵，或手动输入"
        rows={4}
        className="w-full p-4 rounded-xl border-2 border-slate-200 text-base text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-star-400 focus:border-transparent transition-all resize-none disabled:bg-slate-50"
      />

      {/* 答案对比 */}
      {showResult && (
        <div className={cn('mt-3 p-3 rounded-xl', isCorrect ? 'bg-emerald-50' : 'bg-red-50')}>
          <p className={cn('text-sm font-medium', isCorrect ? 'text-emerald-600' : 'text-red-600')}>
            {isCorrect ? '✅ 背诵正确！' : '❌ 与参考答案不符'}
          </p>
          <div className="mt-2">
            <p className="text-xs text-slate-400 mb-1">参考答案：</p>
            <p className="text-sm text-slate-700">{q.correct_answer}</p>
          </div>
          <button onClick={speakRef} className="mt-2 flex items-center gap-1 text-sm text-star-600 hover:underline">
            <Volume2 className="w-4 h-4" /> 播放参考朗读
          </button>
        </div>
      )}

      {/* 录音按钮 */}
      {!showResult && (
        <div className="mt-4 flex justify-center">
          <Button
            onClick={recording ? stopRecording : startRecording}
            variant={recording ? 'danger' : 'primary'}
            className="flex items-center gap-2"
          >
            {recording ? <Square className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            {recording ? '停止录音' : '开始录音'}
          </Button>
        </div>
      )}
    </div>
  );
}
