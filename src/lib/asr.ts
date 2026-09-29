// 音频工具：浏览器录音 → WAV PCM 16kHz 单声道（豆包ASR推荐格式）
// 同时提供流式分块识别与结束录音后完整识别的能力

// 国内访问 vercel.app 不稳定，ASR 代理统一部署在 Supabase Edge Functions
// 地址：{VITE_SUPABASE_URL}/functions/v1/asr
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

/**
 * 获取 ASR 接口地址（Supabase Edge Function，国内可达）
 */
export function getAsrApiUrl(): string {
  if (SUPABASE_URL) {
    return `${SUPABASE_URL}/functions/v1/asr`;
  }
  // 本地开发兜底
  return 'http://127.0.0.1:54321/functions/v1/asr';
}

/**
 * 将 AudioBuffer 转为 16kHz 单声道 PCM WAV 的 base64 字符串
 */
export async function audioBufferToWavBase64(
  buffer: AudioBuffer,
  targetSampleRate = 16000,
): Promise<string> {
  const numChannels = 1; // 单声道
  // 重采样到目标采样率
  const offlineCtx = new OfflineAudioContext(numChannels, Math.ceil(buffer.duration * targetSampleRate), targetSampleRate);
  const source = offlineCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(offlineCtx.destination);
  source.start();
  const resampled = await offlineCtx.startRendering();

  const channelData = resampled.getChannelData(0);
  const wavBuffer = encodeWav(channelData, targetSampleRate, 16);
  return arrayBufferToBase64(wavBuffer);
}

/**
 * 将 Float32 PCM 数据编码为 WAV 格式（16-bit PCM）
 */
function encodeWav(samples: Float32Array, sampleRate: number, bitsPerSample: number): ArrayBuffer {
  const numChannels = 1;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = samples.length * (bitsPerSample / 8);
  const bufferSize = 44 + dataSize;
  const buffer = new ArrayBuffer(bufferSize);
  const view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');

  // fmt sub-chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data sub-chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // PCM samples (16-bit)
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  return buffer;
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize) as any);
  }
  return btoa(binary);
}

/**
 * 将 Blob（webm/opus 等浏览器录音格式）解码为 AudioBuffer
 */
export async function blobToAudioBuffer(blob: Blob): Promise<AudioBuffer> {
  const arrayBuffer = await blob.arrayBuffer();
  const audioCtx = new AudioContext();
  try {
    return await audioCtx.decodeAudioData(arrayBuffer.slice(0));
  } finally {
    audioCtx.close();
  }
}

/**
 * 对识别结果做简单去重：检测连续重复片段并裁剪
 * 仅在录音结束拿到完整文本后执行，不干预实时预览
 */
export function deduplicateText(text: string): string {
  if (!text) return '';
  let result = text;
  // 1. 去除首尾空白
  result = result.trim();
  // 2. 连续重复的整段文字（长度>=3的片段连续出现2次以上）裁剪为一次
  //    例如 "床前明月光床前明月光床前明月光" → "床前明月光"
  result = removeRepeatedSegments(result, 3);
  // 3. 句末重复的短句裁剪
  result = trimRepeatedSuffix(result);
  return result;
}

/**
 * 移除连续重复的片段（按最短重复单元匹配）
 */
function removeRepeatedSegments(text: string, minLen: number): string {
  let result = text;
  // 从最长到最短尝试匹配重复单元
  for (let len = Math.floor(result.length / 2); len >= minLen; len--) {
    const pattern = result.slice(0, len);
    // 检查是否整段由该pattern重复组成
    if (pattern && result.length % len === 0) {
      const repeats = result.length / len;
      let allMatch = true;
      for (let i = 1; i < repeats; i++) {
        if (result.slice(i * len, (i + 1) * len) !== pattern) {
          allMatch = false;
          break;
        }
      }
      if (allMatch) return pattern;
    }
  }
  // 非整段重复：检查末尾是否有重复
  return result;
}

/**
 * 裁剪末尾重复的短句（常见于ASR幻觉："。好的好的好的"）
 */
function trimRepeatedSuffix(text: string): string {
  let result = text;
  // 尝试匹配末尾 2-20 字的重复
  for (let len = 2; len <= 20; len++) {
    if (result.length < len * 2) break;
    const suffix = result.slice(-len);
    const prev = result.slice(-len * 2, -len);
    if (suffix === prev) {
      // 继续往前检查是否有更多重复
      let count = 2;
      while (result.length >= len * (count + 1)) {
        const morePrev = result.slice(-len * (count + 1), -len * count);
        if (morePrev === suffix) count++;
        else break;
      }
      // 只保留一份
      result = result.slice(0, -len * (count - 1));
      break;
    }
  }
  return result;
}
