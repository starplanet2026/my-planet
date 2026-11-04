import * as XLSX from 'xlsx';
import type { Medal, MedalInput, MedalSeries } from '../api/medals';

// 勋章库统一 Excel 模板（个人勋章库 / 公共勋章模板库共用）
// 列：编号 | 勋章系列 | 成就分类 | 档位/等级 | 勋章名称 | 达成条件（触发规则） | 获取路径 | 勋章简介 | 发放奖励 | 初始状态
export interface ParsedMedal extends MedalInput {
  rowNumber: number;
}

export interface MedalParseResult {
  rows: ParsedMedal[];
  errors: string[];
}

const cellText = (v: unknown) => String(v ?? '').trim();

function parseSeries(text: string): MedalSeries | null {
  if (text.includes('连续')) return 'streak';
  if (text.includes('分类') || text.includes('集齐')) return 'collect';
  if (text.includes('当日') || text.includes('活跃')) return 'daily';
  return null;
}

function parseThreshold(text: string): number {
  const m = text.match(/(\d+)/);
  return m ? Number(m[1]) : 0;
}

// 通用（单条成就独立统计）→ null；好表现与成就清单统一为「好努力」
function parseSubcategory(text: string): string | null {
  const clean = text.replace(/[（(].*?[）)]/g, '').trim();
  if (!clean || clean === '通用') return null;
  return clean === '好表现' ? '好努力' : clean;
}

function parseReward(text: string): { name: string | null; count: number } {
  const t = text.trim();
  if (!t) return { name: null, count: 0 };
  let count = 1;
  const numMatch = t.match(/(\d+)\s*张/);
  if (numMatch) count = Number(numMatch[1]);
  else if (t.includes('两张')) count = 2;
  else if (t.includes('三张')) count = 3;
  return { name: t, count };
}

export function parseMedalExcel(buffer: ArrayBuffer): MedalParseResult {
  const wb = XLSX.read(buffer, { type: 'array' });
  const sheetName = wb.SheetNames.find(name => {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' }) as unknown[][];
    return rows.some(r => r.some(c => cellText(c) === '勋章名称'));
  }) ?? wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' }) as unknown[][];
  const headerIdx = rows.findIndex(r => r.some(c => cellText(c) === '勋章名称'));

  const errors: string[] = [];
  if (headerIdx < 0) {
    return { rows: [], errors: ['未找到「勋章名称」表头，请使用标准勋章清单模板'] };
  }

  const header = rows[headerIdx].map(cellText);
  const col = (name: string) => header.findIndex(h => h === name || h.startsWith(name));
  const iCode = col('编号');
  const iSeries = col('勋章系列');
  const iSub = col('成就分类');
  const iTier = col('档位');
  const iName = col('勋章名称');
  const iCondition = col('达成条件');
  const iDesc = col('勋章简介');
  const iReward = col('发放奖励');
  const iStatus = col('初始状态');

  const result: ParsedMedal[] = [];
  const seenCodes = new Set<string>();

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const name = iName >= 0 ? cellText(row[iName]) : '';
    if (!name) continue;
    const rowNumber = i + 1; // Excel 行号（1 基）
    const seriesText = iSeries >= 0 ? cellText(row[iSeries]) : '';
    const series = parseSeries(seriesText);
    if (!series) {
      errors.push(`第 ${rowNumber} 行：勋章系列「${seriesText || '空'}」无法识别，应为 连续打卡 / 分类集齐 / 当日活跃`);
      continue;
    }
    const tier = iTier >= 0 ? cellText(row[iTier]) : '';
    const threshold = parseThreshold(tier);
    if (!threshold) {
      errors.push(`第 ${rowNumber} 行：档位「${tier || '空'}」无法解析出阈值天数/数量`);
      continue;
    }
    const code = iCode >= 0 ? cellText(row[iCode]) : '';
    if (code) {
      if (seenCodes.has(code)) {
        errors.push(`第 ${rowNumber} 行：编号「${code}」在文件内重复`);
        continue;
      }
      seenCodes.add(code);
    }
    const subcategory = iSub >= 0 ? parseSubcategory(cellText(row[iSub])) : null;
    if (series === 'collect' && !subcategory) {
      errors.push(`第 ${rowNumber} 行：分类集齐勋章必须填写成就分类`);
      continue;
    }
    const reward = iReward >= 0 ? parseReward(cellText(row[iReward])) : { name: null, count: 0 };
    const statusText = iStatus >= 0 ? cellText(row[iStatus]) : '';

    result.push({
      rowNumber,
      code: code || null,
      name,
      series,
      threshold,
      subcategory: series === 'collect' ? subcategory : null,
      tier: tier || null,
      condition_text: iCondition >= 0 ? (cellText(row[iCondition]) || null) : null,
      description: iDesc >= 0 ? (cellText(row[iDesc]) || null) : null,
      icon: null,
      reward_stars: 0,
      reward_card_name: reward.name,
      reward_card_count: reward.count,
      is_active: !statusText.includes('停用'),
      priority: result.length + 1,
    });
  }

  return { rows: result, errors };
}

// 导出个人勋章库为 Excel（与导入模板格式一致）
export function exportMedalsExcel(medals: Medal[]): Blob {
  const header = ['编号', '勋章系列', '成就分类', '档位/等级', '勋章名称', '达成条件（触发规则）', '获取路径', '勋章简介', '发放奖励', '初始状态'];
  const seriesLabel: Record<MedalSeries, string> = {
    streak: '连续打卡系列',
    collect: '分类集齐系列',
    daily: '当日活跃系列',
  };
  const tierOf = (m: Medal) => m.tier || (m.series === 'daily' ? `单日≥${m.threshold}条` : `${m.threshold}`);
  const subOf = (m: Medal) => (m.series === 'collect' ? (m.subcategory ?? '') : '通用');
  const rewardOf = (m: Medal) => {
    if (!m.reward_card_name && !m.reward_stars) return '';
    const card = m.reward_card_name
      ? `${m.reward_card_name}${m.reward_card_count > 1 ? `${m.reward_card_count}张` : ''}`
      : '';
    const stars = m.reward_stars ? `${m.reward_stars}星光值` : '';
    return [card, stars].filter(Boolean).join(' + ');
  };

  const rows = medals.map(m => [
    m.code ?? '',
    seriesLabel[m.series],
    subOf(m),
    tierOf(m),
    m.name,
    m.condition_text ?? '',
    '',
    m.description ?? '',
    rewardOf(m),
    m.is_active ? '未解锁' : '停用',
  ]);

  const ws = XLSX.utils.aoa_to_sheet([['我的勋章库'], header, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '勋章清单');
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
