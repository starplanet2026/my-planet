import { useState, useRef, useCallback, useEffect } from 'react';
import { cn } from '../../../../lib/utils';
import { Mic, Square, Volume2, Pause, Play } from 'lucide-react';
import { Button } from '../../../../components/common/Button';
import { blobToAudioBuffer, audioBufferToWavBase64, deduplicateText, getAsrApiUrl } from '../../../../lib/asr';
import type { QuestionComponentProps } from './QuestionRenderer';

export function ReciteQuestion({ question: q, answer, setAnswer, showResult, isCorrect, disabled }: QuestionComponentProps) {
  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [recognizing, setRecognizing] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const finalRef = useRef(answer || '');

  // 调用豆包ASR接口识别音频
  const recognizeAudio = useCallback(async (blob: Blob): Promise<string> => {
    const audioBuffer = await blobToAudioBuffer(blob);
    const base64 = await audioBufferToWavBase64(audioBuffer, 16000);
    const res = await fetch(getAsrApiUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio: base64, format: 'wav', rate: 16000, subject: 'chinese' }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `识别失败(${res.status})`);
    }
    const data = await res.json();
    return data.text || '';
  }, []);

  // 清理所有录音资源
  const cleanupRecording = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (mediaRecorderRef.current) {
      try {
        if (mediaRecorderRef.current.state !== 'inactive') mediaRecorderRef.current.stop();
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

  useEffect(() => () => cleanupRecording(), [cleanupRecording]);

  const startRecording = async () => {
    if (showResult || disabled) return;
    cleanupRecording();
    finalRef.current = answer || '';

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

      timerRef.current = setInterval(() => {
        setRecordSeconds(s => s + 1);
      }, 1000);
    } catch (e: any) {
      if (e?.name === 'NotAllowedError' || e?.name === 'PermissionDeniedError') {
        alert('请在浏览器设置中开启麦克风权限后重试');
      } else {
        alert('录音启动失败：' + (e?.message || '未知错误'));
      }
      cleanupRecording();
    }
  };

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

  const stopRecording = async () => {
    const recorder = mediaRecorderRef.current;
    const stream = streamRef.current;

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

    if (audioChunksRef.current.length === 0) return;
    const blob = new Blob(audioChunksRef.current, { type: recorder?.mimeType || 'audio/webm' });
    setRecognizing(true);
    try {
      let text = await recognizeAudio(blob);
      text = deduplicateText(text);
      finalRef.current = text;
      setAnswer(text);
    } catch {
      // 最终识别失败，保留已有内容
    } finally {
      setRecognizing(false);
      mediaRecorderRef.current = null;
      audioChunksRef.current = [];
    }
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

  return (
    <div>
      {/* 提示 */}
      {q.metadata?.hint && (
        <p className="text-sm text-slate-500 mb-3 text-center">💡 {q.metadata.hint}</p>
      )}

      {/* 识别中状态 */}
      {(recording || recognizing) && (
        <div className="mb-3 flex items-center justify-center gap-2 text-red-500 text-sm">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          {recognizing ? '识别中，请稍候...' : paused ? '已暂停' : `正在录音 ${String(Math.floor(recordSeconds/60)).padStart(2,'0')}:${String(recordSeconds%60).padStart(2,'0')}`}
        </div>
      )}

      {/* 文本编辑区 */}
      <textarea
        value={finalRef.current}
        onChange={e => {
          finalRef.current = e.target.value;
          setAnswer(e.target.value);
        }}
        disabled={showResult || disabled || recording}
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
        <div className="mt-4 flex justify-center gap-2 flex-wrap">
          {!recording ? (
            <Button
              onClick={startRecording}
              variant="primary"
              className="flex items-center gap-2"
              disabled={recognizing}
            >
              <Mic className="w-5 h-5" /> 开始录音
            </Button>
          ) : (
            <>
              <Button onClick={togglePause} variant="secondary" className="flex items-center gap-2">
                {paused ? <><Play className="w-4 h-4" /> 继续</> : <><Pause className="w-4 h-4" /> 暂停</>}
              </Button>
              <Button onClick={stopRecording} variant="danger" className="flex items-center gap-2">
                <Square className="w-5 h-5" /> 停止录音
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
