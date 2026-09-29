// Supabase Edge Function: 豆包大模型语音识别代理（录音文件识别 HTTP 接口）
// 流程：接收 base64 音频 → 上传 Supabase Storage → 获取签名 URL → 提交识别 → 轮询结果 → 返回文本
// 环境变量：DOUBAO_ASR_APPID, DOUBAO_ASR_TOKEN

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

// 豆包录音文件识别接口
const SUBMIT_URL = 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit'
const QUERY_URL = 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/query'
// 资源 ID：豆包录音文件识别模型2.0
const RESOURCE_ID = 'volc.seedasr.auc'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const appid = Deno.env.get('DOUBAO_ASR_APPID')
  const token = Deno.env.get('DOUBAO_ASR_TOKEN')
  if (!appid || !token) {
    return new Response(
      JSON.stringify({ error: 'ASR 服务未配置（缺少 DOUBAO_ASR_APPID / DOUBAO_ASR_TOKEN）' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

  try {
    const body = await req.json()
    const { audio, format = 'wav', rate = 16000, subject = 'chinese' } = body
    if (!audio) {
      return new Response(
        JSON.stringify({ error: '缺少音频数据' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const language = subject === 'english' ? 'en-US' : 'zh-CN'

    // 1. 解码 base64 音频
    const binaryString = atob(audio)
    const audioBytes = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i++) {
      audioBytes[i] = binaryString.charCodeAt(i)
    }

    // 2. 上传到 Supabase Storage
    const supabase = createClient(supabaseUrl, serviceRoleKey)
    const fileName = `asr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.wav`

    const { error: uploadError } = await supabase.storage
      .from('asr-temp')
      .upload(fileName, audioBytes, { contentType: 'audio/wav', upsert: true })

    if (uploadError) {
      return new Response(
        JSON.stringify({ error: '音频上传失败: ' + uploadError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 3. 获取签名 URL（5 分钟有效）
    const { data: signedData, error: signedError } = await supabase.storage
      .from('asr-temp')
      .createSignedUrl(fileName, 300)

    if (signedError || !signedData) {
      await supabase.storage.from('asr-temp').remove([fileName])
      return new Response(
        JSON.stringify({ error: '获取音频URL失败: ' + (signedError?.message || 'unknown') }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const audioUrl = signedData.signedUrl

    // 4. 提交识别任务
    const taskId = crypto.randomUUID()
    const headers = {
      'X-Api-App-Key': appid,
      'X-Api-Access-Key': token,
      'X-Api-Resource-Id': RESOURCE_ID,
      'X-Api-Request-Id': taskId,
      'X-Api-Sequence': '-1',
      'Content-Type': 'application/json',
    }

    const submitBody = {
      user: { uid: 'recitation_user' },
      audio: {
        url: audioUrl,
        format,
        codec: 'raw',
        rate,
        bits: 16,
        channel: 1,
        language,
      },
      request: {
        model_name: 'bigmodel',
        enable_itn: true,
        enable_ddc: true,
        enable_punc: true,
        show_utterances: false,
      },
    }

    const submitRes = await fetch(SUBMIT_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(submitBody),
    })

    const submitStatus = submitRes.headers.get('X-Api-Status-Code')
    if (submitStatus !== '20000000') {
      const submitText = await submitRes.text()
      await supabase.storage.from('asr-temp').remove([fileName])
      return new Response(
        JSON.stringify({ error: `提交识别失败: ${submitStatus} ${submitText.slice(0, 200)}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 5. 轮询查询结果（最多 60 秒，每 500ms 查一次）
    let resultText = ''
    let gotResult = false
    const maxAttempts = 120
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, 500))

      const queryRes = await fetch(QUERY_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({ task_id: taskId }),
      })

      const queryStatus = queryRes.headers.get('X-Api-Status-Code')
      const queryData = await queryRes.json() as any

      if ((queryStatus === '20000000' || queryStatus === '20000003') && queryData.result) {
        resultText = queryData.result.text || ''
        gotResult = true
        break
      }

      // 任务还在处理中，继续轮询
      if (queryStatus === '20000001' || queryData.code === 20000001) {
        continue
      }

      // 其他错误
      if (queryStatus && queryStatus !== '20000000' && queryStatus !== '20000001' && queryStatus !== '20000003') {
        await supabase.storage.from('asr-temp').remove([fileName])
        return new Response(
          JSON.stringify({ error: `识别失败: ${queryStatus} ${JSON.stringify(queryData).slice(0, 200)}` }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    // 6. 清理临时文件
    await supabase.storage.from('asr-temp').remove([fileName])

    if (!gotResult) {
      return new Response(
        JSON.stringify({ error: '识别超时，请重试' }),
        { status: 504, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({ text: resultText }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: 'ASR服务异常: ' + (e?.message || String(e)) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
