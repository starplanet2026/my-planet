// 音效引擎：基于 Web Audio API 程序合成，无需任何音频文件。
// 全局静音由 setMuted 控制；所有 play* 函数内部检查 muted 状态。

let ctx: AudioContext | null = null;
let muted = false;

// 获取/创建 AudioContext（懒加载，需在用户交互后调用）
function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    try {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      ctx = new AC();
    } catch {
      return null;
    }
  }
  // 某些浏览器需 resume 才能播放（autoplay policy）
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
  return ctx;
}

// 设置全局静音
export function setMuted(m: boolean) {
  muted = m;
  if (m) {
    // 静音时停止语音合成朗读（GamePlayBoard 的 Web Speech）
    try { speechSynthesis.cancel(); } catch {}
  }
}

export function isMuted() {
  return muted;
}

// 触发浏览器恢复 AudioContext（在首次用户交互时调用）
export function unlockAudio() {
  getCtx();
}

// ---- 基础：播放一个音 ----
function tone(freq: number, duration: number, type: OscillatorType = 'sine', volume = 0.15, delay = 0) {
  if (muted) return;
  const ac = getCtx();
  if (!ac) return;
  const t0 = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  // 包络：快速起音，平滑收尾，避免爆音
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(volume, t0 + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
  osc.connect(gain);
  gain.connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.05);
}

// 频率扫描（用于答错下降音）
function sweep(fromFreq: number, toFreq: number, duration: number, type: OscillatorType = 'sawtooth', volume = 0.12) {
  if (muted) return;
  const ac = getCtx();
  if (!ac) return;
  const t0 = ac.currentTime;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(fromFreq, t0);
  osc.frequency.exponentialRampToValueAtTime(toFreq, t0 + duration);
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(volume, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
  osc.connect(gain);
  gain.connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.05);
}

// ====== 公开音效 API ======

// 点击音效：短促清脆（方波 880Hz, 40ms）
export function playClick() {
  tone(880, 0.04, 'square', 0.08);
}

// 答对音效：上升三音 C5-E5-G5（523-659-784Hz），欢快感
export function playCorrect() {
  tone(523.25, 0.1, 'sine', 0.15, 0);     // C5
  tone(659.25, 0.1, 'sine', 0.15, 0.1);   // E5
  tone(783.99, 0.15, 'sine', 0.18, 0.2);  // G5
}

// 答错音效：下降扫描 400→150Hz（锯齿波），低沉
export function playWrong() {
  sweep(400, 150, 0.25, 'sawtooth', 0.1);
}

// 金币音效：两声叮（988Hz + 1319Hz），清脆
export function playCoin() {
  tone(988, 0.06, 'sine', 0.15, 0);
  tone(1319, 0.1, 'sine', 0.15, 0.06);
}

// 宠物点击音效：柔和短音（正弦 600Hz, 60ms）
export function playPetClick() {
  tone(600, 0.06, 'sine', 0.1);
}

// ====== 预留接口（素材确认后接入）======

// 背景音乐播放（预留：确认素材后在此接入 Audio 或循环播放逻辑）
export function playBGM() {
  // TODO: 素材确认后接入
  // const audio = new Audio('/sounds/bgm.mp3');
  // audio.loop = true;
  // audio.volume = 0.3;
  // audio.play();
}

// 停止背景音乐
export function stopBGM() {
  // TODO: 素材确认后接入
}

// ====== 宠物叫声（WebAudio 合成，无音频文件依赖）======

// 狗叫：单声「汪」—— 锯齿波快速下滑 + 噪声爆破（喉咙质感）
function barkOnce(ac: AudioContext, startAt: number, out: GainNode) {
  const dur = 0.16;

  // 主体：锯齿波 380Hz → 140Hz 快速下滑
  const osc = ac.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(380, startAt);
  osc.frequency.exponentialRampToValueAtTime(140, startAt + dur);
  const oscGain = ac.createGain();
  oscGain.gain.setValueAtTime(0.0001, startAt);
  oscGain.gain.exponentialRampToValueAtTime(0.5, startAt + 0.015);
  oscGain.gain.exponentialRampToValueAtTime(0.0001, startAt + dur);
  // 低通让声音更"厚"
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(1600, startAt);
  osc.connect(oscGain);
  oscGain.connect(lp);
  lp.connect(out);
  osc.start(startAt);
  osc.stop(startAt + dur + 0.02);

  // 噪声爆破
  const noiseLen = Math.floor(ac.sampleRate * 0.1);
  const buf = ac.createBuffer(1, noiseLen, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < noiseLen; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / noiseLen);
  const noise = ac.createBufferSource();
  noise.buffer = buf;
  const noiseGain = ac.createGain();
  noiseGain.gain.setValueAtTime(0.18, startAt);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.1);
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(700, startAt);
  bp.Q.setValueAtTime(0.8, startAt);
  noise.connect(noiseGain);
  noiseGain.connect(bp);
  bp.connect(out);
  noise.start(startAt);
}

// 小狗叫声：汪汪两声
export function playDogBark() {
  if (muted) return;
  const ac = getCtx();
  if (!ac) return;
  try {
    const out = ac.createGain();
    out.gain.setValueAtTime(0.9, ac.currentTime);
    out.connect(ac.destination);
    const t = ac.currentTime;
    barkOnce(ac, t, out);
    barkOnce(ac, t + 0.22, out);
  } catch { /* 静默降级 */ }
}

// 小猫叫声：一声拉长的「喵～」—— 三角波滑音（420→720→320Hz）+ 轻颤音 + 低通柔化
export function playMeow() {
  if (muted) return;
  const ac = getCtx();
  if (!ac) return;
  try {
    const t = ac.currentTime;
    const dur = 0.55;
    const out = ac.createGain();
    out.gain.setValueAtTime(0.8, t);
    out.connect(ac.destination);

    const osc = ac.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(420, t);
    osc.frequency.exponentialRampToValueAtTime(720, t + dur * 0.35);
    osc.frequency.exponentialRampToValueAtTime(320, t + dur);

    // 颤音
    const lfo = ac.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(9, t);
    const lfoGain = ac.createGain();
    lfoGain.gain.setValueAtTime(18, t);
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);

    // 振幅包络：快速起音，缓慢衰减
    const env = ac.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(0.5, t + 0.06);
    env.gain.setValueAtTime(0.5, t + dur * 0.6);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2400, t);

    osc.connect(env);
    env.connect(lp);
    lp.connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.02);
    lfo.start(t);
    lfo.stop(t + dur + 0.02);
  } catch { /* 静默降级 */ }
}

// 按物种播放宠物叫声：狗 → 汪汪；猫 → 喵；未知物种静默
export function playPetSound(species: 'dog' | 'cat' | null | undefined) {
  if (species === 'dog') playDogBark();
  else if (species === 'cat') playMeow();
}
