// 工具函数

// className 合并（简易版，不引入 clsx 依赖）
export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

// 格式化金币数字（千分位）
export function formatCoins(n: number): string {
  return Math.abs(n).toLocaleString('zh-CN');
}

// 格式化日期
export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  const diff = d.getTime() - now.getTime();
  const day = 24 * 60 * 60 * 1000;

  if (Math.abs(diff) < day && d.getDate() === now.getDate()) {
    // 今天
    return `今天 ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  }
  if (diff > 0 && diff < 2 * day && d.getDate() === now.getDate() + 1) {
    return `明天 ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  }
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

// 格式化完整日期时间
export function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

// 相对时间（"刚刚"、"5分钟前"、"2小时前"）
export function timeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const diff = Date.now() - d.getTime();
  const min = 60 * 1000;
  const hour = 60 * min;
  const day = 24 * hour;

  if (diff < min) return '刚刚';
  if (diff < hour) return `${Math.floor(diff / min)}分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)}小时前`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}天前`;
  return formatDate(dateStr);
}

// 券码格式化（每 4 位加空格）
export function formatVoucherCode(code: string): string {
  return code.replace(/(.{4})/g, '$1 ').trim();
}

// 检查是否过期
export function isExpired(dateStr: string | null | undefined): boolean {
  if (!dateStr) return false;
  return new Date(dateStr).getTime() < Date.now();
}

// 检查是否今天
export function isToday(dateStr: string | null | undefined): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const now = new Date();
  return d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();
}

// 获取今日日期范围
export function getTodayRange(): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  return { start, end };
}

// 格式化金币带正负号
export function formatSignedCoins(n: number): string {
  return `${n >= 0 ? '+' : '-'}${formatCoins(n)}`;
}
