import { supabase } from './client';

export interface LuckyWheelReward {
  reward_key: string;
  reward_type: 'item' | 'star';
  name: string;
  description: string | null;
  image_url: string | null;
  weight: number;
}

export interface LuckyWheelSpinResult {
  reward_type: 'item' | 'star';
  reward_key: string;
  reward_name: string;
  remaining_spins: number;
  message: string;
}

export interface LuckyWheelClaimResult {
  reward_type: 'item' | 'star';
  reward_key: string;
  reward_name: string;
  wish_hit: boolean;
  coin_refunded: boolean;
  message: string;
}

export interface LuckyWheelDailyStatus {
  used_coin_today: boolean;
  ticket_count: number;
}

// 获取奖池列表
export async function fetchLuckyWheelPool(familyId: string): Promise<LuckyWheelReward[]> {
  const { data, error } = await supabase.rpc('get_lucky_wheel_pool', { p_family_id: familyId });
  if (error) throw error;
  return (data ?? []) as LuckyWheelReward[];
}

// 获取今日付费状态
export async function fetchLuckyWheelDailyStatus(memberId: string): Promise<LuckyWheelDailyStatus> {
  const { data, error } = await supabase.rpc('get_lucky_wheel_daily_status', { p_member_id: memberId });
  if (error) throw error;
  return (data?.[0] ?? { used_coin_today: false, ticket_count: 0 }) as LuckyWheelDailyStatus;
}

// 开启一轮转盘
export async function startLuckyWheel(
  memberId: string,
  payType: 'coin' | 'ticket',
  wishRewardKey?: string
): Promise<{ session_id: string; remaining_spins: number; message: string }> {
  const { data, error } = await supabase.rpc('start_lucky_wheel', {
    p_member_id: memberId,
    p_pay_type: payType,
    p_wish_reward_key: wishRewardKey ?? null,
  });
  if (error) throw error;
  return (data?.[0] ?? { session_id: '', remaining_spins: 0, message: 'error' }) as any;
}

// 单次抽取
export async function spinLuckyWheel(sessionId: string): Promise<LuckyWheelSpinResult> {
  const { data, error } = await supabase.rpc('spin_lucky_wheel', { p_session_id: sessionId });
  if (error) throw error;
  return (data?.[0] ?? {}) as LuckyWheelSpinResult;
}

// 领取奖励
export async function claimLuckyWheelReward(sessionId: string): Promise<LuckyWheelClaimResult> {
  const { data, error } = await supabase.rpc('claim_lucky_wheel_reward', { p_session_id: sessionId });
  if (error) throw error;
  return (data?.[0] ?? {}) as LuckyWheelClaimResult;
}

// 关闭弹窗兜底
export async function abandonLuckyWheel(sessionId: string): Promise<{ reward_type: string | null; reward_name: string | null; message: string }> {
  const { data, error } = await supabase.rpc('abandon_lucky_wheel', { p_session_id: sessionId });
  if (error) throw error;
  return (data?.[0] ?? {}) as any;
}

// 更新权重（后台）
export async function updateLuckyWheelWeights(familyId: string, configs: { reward_key: string; weight: number }[]): Promise<void> {
  const { error } = await supabase.rpc('update_lucky_wheel_weights', {
    p_family_id: familyId,
    p_configs: configs,
  });
  if (error) throw error;
}
