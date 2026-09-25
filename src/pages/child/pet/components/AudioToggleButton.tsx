// 全局静音开关按钮：inline 样式，放入右侧图标列（背景/帮助/消息/声音）
import { usePetUiStore } from '../../../../store/petUiStore';
import { unlockAudio } from '../../../../lib/audio';
import { Volume2, VolumeX } from 'lucide-react';
import { useEffect } from 'react';

export function AudioToggleButton() {
  const muted = usePetUiStore(s => s.audioMuted);
  const toggleMute = usePetUiStore(s => s.toggleAudioMute);

  // 首次点击页面时解锁 AudioContext + 尝试播放 BGM（受浏览器 autoplay policy 限制）
  useEffect(() => {
    const onFirstClick = () => {
      unlockAudio();
      // BGM 预留：素材确认后取消注释
      // if (!muted) playBGM();
      window.removeEventListener('click', onFirstClick, true);
    };
    window.addEventListener('click', onFirstClick, true);
    return () => window.removeEventListener('click', onFirstClick, true);
  }, []);

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        unlockAudio();
        toggleMute();
      }}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/70 backdrop-blur-sm border border-white/60 text-green-600 hover:bg-white/90 shadow-sm transition-colors active:scale-95"
      title={muted ? '点击开启音效' : '点击静音'}
    >
      {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
      <span className="text-xs font-medium">声音</span>
    </button>
  );
}
