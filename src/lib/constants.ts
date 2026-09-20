import type { TaskCategory, TaskStatus, PurchaseStatus, CoinRecordCategory } from '../api/types';

// 双货币图标（金币 / 星光值）
import coinIconUrl from '../assets/icons/coin-icon-sm.jpg';
import coinIconLgUrl from '../assets/icons/coin-icon.jpg';
import starIconUrl from '../assets/icons/star-icon-sm.jpg';
import starIconLgUrl from '../assets/icons/star-icon.jpg';

export const COIN_ICON_SM = coinIconUrl;
export const COIN_ICON_LG = coinIconLgUrl;
export const STAR_ICON_SM = starIconUrl;
export const STAR_ICON_LG = starIconLgUrl;

// 任务类别配置
export const TASK_CATEGORIES: Record<TaskCategory, { label: string; subtitle: string; emoji: string; color: string; iconKey: string }> = {
  daily: { label: '每日成就', subtitle: '每天刷新，达成即得星！', emoji: '☀️', color: 'blue', iconKey: '每日成就' },
  stage: { label: '里程碑成就', subtitle: '中长期目标，达成超有成就感！', emoji: '🎯', color: 'purple', iconKey: '里程碑成就' },
  super: { label: '高光时刻', subtitle: '学霸级成就，达成超酷！', emoji: '⭐', color: 'amber', iconKey: '高光时刻' },
  black: { label: '成长挑战', subtitle: '不小心触发会扣星，注意规避！', emoji: '⚡', color: 'red', iconKey: '成长挑战' },
};

export const TASK_CATEGORY_LIST = Object.entries(TASK_CATEGORIES) as [TaskCategory, typeof TASK_CATEGORIES[TaskCategory]][];

// 任务状态
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  draft: '待发布',
  active: '待完成',
  pending_approval: '待确认',
  completed: '已完成',
  expired: '已过期',
  deleted: '已删除',
};

// 购买状态
export const PURCHASE_STATUS_LABELS: Record<PurchaseStatus, string> = {
  pending: '待使用',
  redeemed: '已兑换',
  expired: '已过期',
  cancelled: '已取消',
  sold: '已出售',
};

// 流水类别
export const COIN_RECORD_CATEGORIES: Record<CoinRecordCategory, { label: string; color: string }> = {
  task: { label: '任务', color: 'blue' },
  purchase: { label: '特权', color: 'orange' },
  manual: { label: '家长调整', color: 'purple' },
  system: { label: '系统', color: 'gray' },
};

// 路由常量
export const ROUTES = {
  HOME: '/',
  TASKS: '/tasks',
  SHOP: '/shop',
  PROFILE: '/profile',
  CHALLENGE: '/challenge',
  WRONG_BOOK: '/wrong-book',
  SETUP: '/setup',
  PARENT: '/parent',
  PARENT_DASHBOARD: '/parent/dashboard',
  PARENT_TASKS: '/parent/tasks',
  PARENT_VERIFICATION: '/parent/verification',
  PARENT_SHOP: '/parent/shop',
  PARENT_REDEEM: '/parent/redeem',
  PARENT_MEMBERS: '/parent/members',
  PARENT_CHALLENGES: '/parent/challenges',
  PARENT_PETS: '/parent/pets',
  PET: '/pet',
} as const;

// 孩子 emoji 选项
export const CHILD_EMOJIS = ['🦁', '🐯', '🐰', '🦊', '🐻', '🐼', '🐨', '🐸', '🦄', '🐲', '🦖', '🐙'];

// 任务图标库（星星人主题图片）
// 使用 import.meta.glob 批量加载 task-icons 目录下的图片
const taskIconModules = import.meta.glob('../assets/task-icons/**/*.{jpg,jpeg,png}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

// 构建图标名 → 图片URL 的映射
// key 为去掉扩展名的文件名，例如 "早起小太阳"
export const TASK_ICON_MAP: Record<string, string> = Object.entries(taskIconModules).reduce(
  (map, [path, url]) => {
    // path 格式: ../assets/task-icons/生活/早起小太阳.png
    const fileName = path.split('/').pop() ?? '';
    const key = fileName.replace(/\.(jpg|jpeg|png)$/i, '');
    map[key] = url;
    return map;
  },
  {} as Record<string, string>
);

// 获取图标图片URL，未找到时返回 null
export function getTaskIconUrl(icon: string | null | undefined): string | null {
  if (!icon) return null;
  // base64 数据 URL 或 http URL 直接返回
  if (icon.startsWith('data:') || icon.startsWith('http')) return icon;
  return TASK_ICON_MAP[icon] ?? null;
}

// 按文件夹分类构建图标库
// 文件夹中文名 → 分类标签
const FOLDER_LABELS: Record<string, string> = {
  '生活': '生活',
  '学习': '学习',
  '黑色事件': '黑色事件',
};

// 从 glob 路径提取分类
function getGroupFromPath(path: string): string {
  // path: ../assets/task-icons/学习/校内作业小火箭.jpg
  const parts = path.split('/');
  const folder = parts[parts.length - 2] ?? '';
  return FOLDER_LABELS[folder] ?? folder;
}

// 分组后的图标库
const groupedIcons = Object.entries(taskIconModules).reduce(
  (groups, [path, url]) => {
    const fileName = path.split('/').pop() ?? '';
    const name = fileName.replace(/\.(jpg|jpeg|png)$/i, '');
    const group = getGroupFromPath(path);
    if (!groups[group]) groups[group] = [];
    groups[group].push({ name, url });
    return groups;
  },
  {} as Record<string, { name: string; url: string }[]>
);

// 按固定顺序输出分类（生活 → 学习 → 黑色事件）
export const TASK_ICONS: { label: string; icons: { name: string; url: string }[] }[] = [
  '生活', '学习', '黑色事件',
].map(label => ({
  label,
  icons: groupedIcons[label] ?? [],
}));

// 所有图标名扁平列表
export const TASK_ICON_LIST = TASK_ICONS.flatMap(g => g.icons.map(i => i.name));

// 星星人主题默认图标（使用第一个生活图标）
export const STAR_PERSON_DEFAULT_ICON = TASK_ICON_LIST[0] ?? '早起小太阳';

// 默认任务模板
export const DEFAULT_TASK_TEMPLATES = [
  { title: '背单词 20 个', description: '正确背诵 20 个英语单词', category: 'daily' as TaskCategory, reward_coins: 5 },
  { title: '完成数学口算', description: '完成 50 道口算题', category: 'daily' as TaskCategory, reward_coins: 5 },
  { title: '阅读 30 分钟', description: '课外阅读至少 30 分钟', category: 'daily' as TaskCategory, reward_coins: 3 },
  { title: '整理房间', description: '整理自己的房间', category: 'daily' as TaskCategory, reward_coins: 2 },
  { title: '考试 90 分以上', description: '单科考试 90 分以上', category: 'super' as TaskCategory, reward_coins: 20 },
  { title: '迟到', description: '上学迟到', category: 'black' as TaskCategory, reward_coins: -5 },
  { title: '忘带作业', description: '忘记带作业本', category: 'black' as TaskCategory, reward_coins: -3 },
];
