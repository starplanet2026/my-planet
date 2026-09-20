import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  console.warn(
    '缺少 Supabase 环境变量。请复制 .env.example 为 .env.local 并填入正确的值。\n' +
    '本地开发：npx supabase start 后查看输出的 URL 和 anon key'
  );
}

export const supabase = createClient(
  url ?? 'http://127.0.0.1:54321',
  anonKey ?? 'placeholder-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
    realtime: {
      params: { eventsPerSecond: 10 },
    },
  }
);
