import * as XLSX from 'xlsx';
import type { TaskCategory } from '../api/types';

// 成就清单统一上传模板（个人成就库 / 公共模板库共用）
// 列顺序：模块 | 类别 | 成就名称 | 成就描述 | 奖励星光值 | 循环
export interface ParsedAchievement {
  category: TaskCategory;
  subcategory: string | null;
  title: string;
  description: string | null;
  reward_coins: number;
  repeat_days: number[];
}

const MODULE_TO_CATEGORY: Record<string, TaskCategory> = {
  '每日成就': 'daily',
  '里程碑成就': 'stage',
  '里程碑': 'stage',
  '高光时刻': 'super',
  '成长挑战': 'black',
};

// 周几：0=周日，1=周一 … 6=周六（与 tasks.repeat_days 约定一致）
const WEEKDAY_MAP: Record<string, number> = {
  '周一': 1, '周二': 2, '周三': 3, '周四': 4, '周五': 5, '周六': 6, '周日': 0,
  '星期一': 1, '星期二': 2, '星期三': 3, '星期四': 4, '星期五': 5, '星期六': 6, '星期天': 0,
};

function parseRepeatDays(raw: string): number[] {
  const text = raw.trim();
  if (!text) return [];
  const tokens = text.split(/[\s,，、;；/]+/).filter(Boolean);
  const days = new Set<number>();
  for (const token of tokens) {
    const key = token.replace(/^每/, '');
    const day = WEEKDAY_MAP[key];
    if (day) days.add(day);
  }
  return [...days].sort((a, b) => a - b);
}

const cellText = (v: unknown) => String(v ?? '').trim();

// 解析成就 Excel，返回可直接入库的成就列表（空标题行自动跳过）
export function parseAchievementExcel(buffer: ArrayBuffer): ParsedAchievement[] {
  const wb = XLSX.read(buffer, { type: 'array' });
  const sheetName = wb.SheetNames.find(name => {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' }) as unknown[][];
    return rows.some(r => r.some(c => cellText(c) === '成就名称'));
  }) ?? wb.SheetNames[0];
  if (!sheetName) return [];

  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' }) as unknown[][];
  // 定位表头行（不假定固定行号，兼容标题行/空行）
  const headerIdx = rows.findIndex(r => r.some(c => cellText(c) === '成就名称'));
  if (headerIdx < 0) return [];

  const header = rows[headerIdx].map(cellText);
  const col = (name: string) => header.indexOf(name);
  const iModule = col('模块');
  const iSubcategory = col('类别');
  const iTitle = col('成就名称');
  const iDesc = col('成就描述');
  const iReward = col('奖励星光值');
  const iRepeat = col('循环');

  const result: ParsedAchievement[] = [];
  const seen = new Set<string>();

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const title = iTitle >= 0 ? cellText(row[iTitle]) : '';
    if (!title) continue;
    const dedupeKey = title.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const moduleName = iModule >= 0 ? cellText(row[iModule]) : '';
    const category = MODULE_TO_CATEGORY[moduleName] ?? 'daily';
    const rewardRaw = iReward >= 0 ? cellText(row[iReward]) : '';
    const reward = Number(rewardRaw);
    const repeatRaw = iRepeat >= 0 ? cellText(row[iRepeat]) : '';

    result.push({
      category,
      subcategory: iSubcategory >= 0 ? (cellText(row[iSubcategory]) || null) : null,
      title,
      description: iDesc >= 0 ? (cellText(row[iDesc]) || null) : null,
      reward_coins: Number.isFinite(reward) ? Math.trunc(reward) : 0,
      repeat_days: parseRepeatDays(repeatRaw),
    });
  }

  return result;
}
