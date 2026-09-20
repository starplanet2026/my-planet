import { supabase } from './client';
import type { Family, Member, InitFamilyResult } from './types';

// 初始化家庭（首次设置）——只需邮箱+密码+家庭名称
export async function initFamily(
  name: string, email: string, password: string
): Promise<{ family: Family; childMember: Member }> {
  // 1. 注册家长账号
  const { data: authData, error: authErr } = await supabase.auth.signUp({ email, password });
  if (authErr) throw new Error(`注册失败：${authErr.message}`);
  if (!authData.user) throw new Error('注册失败：未返回用户信息');

  // 2. 如果注册后没有 session，自动登录
  if (!authData.session) {
    const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
    if (signInErr) throw new Error(`自动登录失败：${signInErr.message}`);
  }

  // 3. 调用 init_family RPC（v2：只需家庭名称）
  const { data, error } = await supabase.rpc('init_family', { p_name: name });
  if (error) throw new Error(`创建家庭失败：${error.message}`);

  const result = (Array.isArray(data) ? data[0] : data) as InitFamilyResult;
  if (!result?.family_id) throw new Error('创建家庭失败：未返回家庭 ID');

  // 4. 查询创建的 family 和 child member
  const { data: family, error: famErr } = await supabase
    .from('families').select('*').eq('id', result.family_id).single();
  if (famErr) throw new Error(`查询家庭失败：${famErr.message}`);

  const { data: childMember, error: memErr } = await supabase
    .from('members').select('*').eq('id', result.member_id).single();
  if (memErr) throw new Error(`查询成员失败：${memErr.message}`);

  return { family: family as Family, childMember: childMember as Member };
}

// 登录
export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

// 登出
export async function signOut() {
  await supabase.auth.signOut();
}

// 验证家长 PIN
export async function verifyParentPin(pin: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('verify_parent_pin', { p_pin: pin });
  if (error) throw error;
  return !!data;
}

// 设置家长 PIN（首次设置或更新）
export async function setParentPin(pin: string): Promise<void> {
  const { error } = await supabase.rpc('set_parent_pin', { p_pin: pin });
  if (error) throw error;
}

// 检查是否已设置家长 PIN
export async function hasParentPin(): Promise<boolean> {
  const { data, error } = await supabase.rpc('has_parent_pin');
  if (error) throw error;
  return !!data;
}

// 加载当前家庭信息
export async function loadFamily(): Promise<{ family: Family; members: Member[] } | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: family } = await supabase
    .from('families').select('*').eq('owner_user_id', user.id).single();
  if (!family) return null;

  const { data: members } = await supabase
    .from('members').select('*').eq('family_id', family.id).order('display_order');

  return { family: family as Family, members: (members ?? []) as Member[] };
}

// 修改家长密码
export async function changePassword(newPassword: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw new Error(`修改密码失败：${error.message}`);
}

// 重置所有数据（删除家庭+所有关联数据）
export async function resetAllData(): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('未登录');

  const { data: family } = await supabase
    .from('families').select('id').eq('owner_user_id', user.id).single();
  if (!family) throw new Error('未找到家庭');

  // 删除家庭（级联删除 members, tasks, items, purchases, coin_records）
  const { error: delErr } = await supabase
    .from('families').delete().eq('id', family.id);
  if (delErr) throw new Error(`删除失败：${delErr.message}`);

  // 删除 auth 账号
  const { error: signOutErr } = await supabase.auth.signOut();
  if (signOutErr) console.warn('登出失败', signOutErr);
}
