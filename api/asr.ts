// Vercel Serverless Function: 豆包大模型语音识别代理
// POST /api/asr
// Body: { audio: base64音频数据, format: 'wav'|'webm'|'mp3', rate: 16000, subject: 'chinese'|'english' }
// 用途：前端录音后上传音频，服务端调用豆包ASR接口返回识别文本，避免API Key暴露在前端
// 环境变量：DOUBAO_ASR_APPID, DOUBAO_ASR_TOKEN

export const config = {
  maxDuration: 30,
};

// 使用 any 避免依赖 @vercel/node 类型包（Vercel 运行时提供真实类型）
export default async function handler(req: any, res: any) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const appid = process.env.DOUBAO_ASR_APPID;
  const token = process.env.DOUBAO_ASR_TOKEN;
  if (!appid || !token) {
    res.status(500).json({ error: 'ASR 服务未配置（缺少 DOUBAO_ASR_APPID / DOUBAO_ASR_TOKEN）' });
    return;
  }

  try {
    const { audio, format = 'wav', rate = 16000, subject = 'chinese' } = req.body || {};
    if (!audio) {
      res.status(400).json({ error: '缺少音频数据' });
      return;
    }

    // 语言：中文用 zh-CN，英文用 en-US
    const language = subject === 'english' ? 'en-US' : 'zh-CN';

    // 豆包大模型ASR HTTP接口
    const url = 'https://openspeech.bytedance.com/api/v3/auc/bigmodel';
    const body = {
      app: {
        appid,
        token,
        cluster: 'volcengine_input_common',
      },
      user: {
        uid: 'recitation_user',
      },
      audio: {
        format,
        rate,
        bits: 16,
        channel: 1,
        codec: 'raw',
        language,
      },
      request: {
        reqid: `rec_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
        sequence: -1,
        nbest: 1,
        result_type: 'full',
        enable_itn: true,
        // 语义顺滑：过滤识别产生的语义重复、幻觉片段
        enable_ddc: true,
        // VAD静音判停相关参数
        enable_vad: true,
        max_silence_duration: 800,
      },
      data: audio, // base64编码的音频数据
    };

    const asrRes = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer; ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const asrData = await asrRes.json() as any;

    if (asrData.code !== 1000 && asrData.code !== 0) {
      res.status(500).json({ error: `ASR识别失败: ${asrData.message || asrData.code}` });
      return;
    }

    const text = asrData.result || asrData.text || '';
    res.status(200).json({ text });
  } catch (e: any) {
    res.status(500).json({ error: 'ASR服务异常: ' + (e?.message || 'unknown') });
  }
}
