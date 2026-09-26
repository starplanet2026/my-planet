// 背诵任务文本对比算法
// 输入：(标准答案, 识别文本, 模式) → 输出 { score, diff }
// - fuzzy 模式：LCS 相似度，语文语气助词容错不扣分
// - strict 模式：位置敏感逐字/词比对，英文大小写敏感
//
// diff 条目结构：
//   { text: 单字/单词, status: 'matched'(绿) | 'missing'(红，标准答案有但识别漏) | 'extra'(灰，识别多) }

import type { RecitationMatchMode, RecitationSubject } from '../api/types';

export interface DiffToken {
  text: string;
  status: 'matched' | 'missing' | 'extra';
}

export interface CompareResult {
  score: number;            // 0-100 整数
  diff: DiffToken[];        // 标准答案视角的差异序列（供左侧识别文本红绿标注）
  standardDiff: DiffToken[];// 标准答案序列的差异（供右侧标红漏背）
}

// 语文语气助词/常见口语冗余词，fuzzy 模式预处理剔除（不扣分）
const CN_FILLER_CHARS = new Set(['啊', '呢', '吧', '了', '的', '呀', '哦', '哈', '嘛', '哎', '嗯', '呃']);

// 标点符号集合
const PUNCT_RE = /[\s.,;:!?'，。；：！？、""''（）()【】《》\-—…]/g;

function cleanText(text: string): string {
  return (text || '').replace(PUNCT_RE, '');
}

// 按学科拆分 token：语文按字符，英语按空格分词并小写
function tokenize(text: string, subject: RecitationSubject): string[] {
  const cleaned = cleanText(text);
  if (subject === 'english') {
    return cleaned.split(/\s+/).filter(Boolean).map(w => w.toLowerCase());
  }
  // 语文按字符拆分（已去标点空白）
  return Array.from(cleaned).filter(Boolean);
}

// 语文 fuzzy 模式：剔除语气助词后比对，避免少量助词大幅扣分
function stripCnFiller(tokens: string[]): string[] {
  return tokens.filter(t => !CN_FILLER_CHARS.has(t));
}

// LCS 长度（动态规划）
function lcsLength(a: string[], b: string[]): number {
  const m = a.length, n = b.length;
  // 用一维滚动数组节省内存
  let prev = new Array<number>(n + 1).fill(0);
  let curr = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = prev[j - 1] + 1;
      } else {
        curr[j] = Math.max(prev[j], curr[j - 1]);
      }
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

// LCS 回溯生成 diff：基于标准答案视角
//   matched：标准答案该 token 在识别文本中匹配到 → 绿
//   missing：标准答案该 token 未在识别文本中匹配到 → 红（漏背）
//   extra：识别文本中多出的 token（不在标准答案） → 灰
function buildLcsDiff(standard: string[], recognized: string[]): DiffToken[] {
  const m = standard.length, n = recognized.length;
  // dp 表
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (standard[i - 1] === recognized[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  // 回溯：从标准答案视角产出 diff
  const diff: DiffToken[] = [];
  const matchedRecognized: boolean[] = new Array(n).fill(false);
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (standard[i - 1] === recognized[j - 1]) {
      diff.unshift({ text: standard[i - 1], status: 'matched' });
      matchedRecognized[j - 1] = true;
      i--; j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      diff.unshift({ text: standard[i - 1], status: 'missing' });
      i--;
    } else {
      j--;
    }
  }
  while (i > 0) {
    diff.unshift({ text: standard[i - 1], status: 'missing' });
    i--;
  }
  // 标记识别文本中未匹配的多余 token 为 extra，插入到对应位置
  // 简化：extra 统一追加在 diff 末尾（标灰）
  const extras: DiffToken[] = [];
  for (let k = 0; k < n; k++) {
    if (!matchedRecognized[k]) extras.push({ text: recognized[k], status: 'extra' });
  }
  return [...diff, ...extras];
}

// strict 模式：位置敏感逐 token 比对
//   标准答案第 i 个 token 与识别文本第 i 个 token 对齐比对
//   匹配→绿；标准答案有但识别文本对应位置错/缺→红；识别文本多出的尾部→灰
function buildStrictDiff(standard: string[], recognized: string[]): { diff: DiffToken[]; matched: number } {
  const diff: DiffToken[] = [];
  let matched = 0;
  const maxLen = Math.max(standard.length, recognized.length);
  for (let i = 0; i < maxLen; i++) {
    const s = standard[i];
    const r = recognized[i];
    if (s !== undefined && r !== undefined && s === r) {
      diff.push({ text: s, status: 'matched' });
      matched++;
    } else if (s !== undefined && r !== undefined) {
      // 标准答案该位置 token 与识别不匹配 → 标准答案标红（漏背/错）
      diff.push({ text: s, status: 'missing' });
    } else if (s !== undefined) {
      diff.push({ text: s, status: 'missing' });
    }
    // r 存在但 s 不存在 → extra（标灰），仅在标准答案视角下不显示，记录到末尾
  }
  // 多出的识别 token 标灰追加
  if (recognized.length > standard.length) {
    for (let i = standard.length; i < recognized.length; i++) {
      diff.push({ text: recognized[i], status: 'extra' });
    }
  }
  return { diff, matched };
}

/**
 * 背诵文本对比主函数
 * @param standardText 标准答案原文
 * @param recognizedText 语音识别文本
 * @param mode fuzzy | strict
 * @param subject chinese | english（决定分词方式）
 */
export function compareRecitation(
  standardText: string,
  recognizedText: string,
  mode: RecitationMatchMode,
  subject: RecitationSubject,
): CompareResult {
  let standard = tokenize(standardText, subject);
  let recognized = tokenize(recognizedText, subject);

  // fuzzy 模式：语文剔除语气助词，避免少量助词大幅扣分
  if (mode === 'fuzzy' && subject === 'chinese') {
    standard = stripCnFiller(standard);
    recognized = stripCnFiller(recognized);
  }

  const total = standard.length;
  if (total === 0) {
    return { score: 0, diff: [], standardDiff: [] };
  }

  if (mode === 'strict') {
    const { diff, matched } = buildStrictDiff(standard, recognized);
    const score = Math.round((matched / total) * 100);
    return {
      score: clampScore(score),
      diff,
      standardDiff: diff.filter(t => t.status !== 'extra'),
    };
  }

  // fuzzy 模式：基于 LCS 相似度
  const lcs = lcsLength(standard, recognized);
  const score = Math.round((lcs / total) * 100);
  const diff = buildLcsDiff(standard, recognized);
  return {
    score: clampScore(score),
    diff,
    standardDiff: diff.filter(t => t.status !== 'extra'),
  };
}

function clampScore(n: number): number {
  if (n < 0) return 0;
  if (n > 100) return 100;
  return n;
}
