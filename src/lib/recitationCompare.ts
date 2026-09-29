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

// 标点符号集合（不含空白符，空白由分词器处理）
const PUNCT_RE = /[.,;:!?'，。；：！？、""''（）()【】《》\-—…]/g;

function cleanText(text: string): string {
  return (text || '').replace(PUNCT_RE, '');
}

// 按学科拆分 token：语文按字符，英语按空格分词并小写
function tokenize(text: string, subject: RecitationSubject): string[] {
  const cleaned = cleanText(text);
  if (subject === 'english') {
    return cleaned.split(/\s+/).filter(Boolean).map(w => w.toLowerCase());
  }
  // 语文按字符拆分（过滤空白字符）
  return Array.from(cleaned).filter(c => c.trim() !== '');
}

// 语文 fuzzy 模式：剔除语气助词后比对，避免少量助词大幅扣分
function stripCnFiller(tokens: string[]): string[] {
  return tokens.filter(t => !CN_FILLER_CHARS.has(t));
}

// LCS 长度（动态规划），eq 为自定义相等判断（默认严格相等）
function lcsLength(a: string[], b: string[], eq?: (x: string, y: string) => boolean): number {
  const equal = eq ?? ((x, y) => x === y);
  const m = a.length, n = b.length;
  let prev = new Array<number>(n + 1).fill(0);
  let curr = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (equal(a[i - 1], b[j - 1])) {
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
function buildLcsDiff(standard: string[], recognized: string[], eq?: (x: string, y: string) => boolean): DiffToken[] {
  const equal = eq ?? ((x, y) => x === y);
  const m = standard.length, n = recognized.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (equal(standard[i - 1], recognized[j - 1])) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  const diff: DiffToken[] = [];
  const matchedRecognized: boolean[] = new Array(n).fill(false);
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (equal(standard[i - 1], recognized[j - 1])) {
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

  // 英文：保留原始文本（大小写、标点、空格、换行）用于显示
  // 比对时大小写不敏感，评分取单词级与字符级较高者
  if (subject === 'english') {
    const eqCI = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

    // 单词级评分（按空白分词，保留原始单词）
    const stdWords = standardText.trim().split(/\s+/).filter(Boolean);
    const recWords = recognizedText.trim().split(/\s+/).filter(Boolean);
    const wordTotal = stdWords.length;
    const wordLcs = lcsLength(stdWords, recWords, eqCI);
    const wordScore = wordTotal === 0 ? 0 : (wordLcs === wordTotal ? 100 : Math.round((wordLcs / wordTotal) * 100));

    // 字符级评分+显示（保留原始字符，含空格、换行、标点、大小写）
    const stdChars = Array.from(standardText);
    const recChars = Array.from(recognizedText);
    const charTotal = stdChars.length;
    const charLcs = lcsLength(stdChars, recChars, eqCI);
    const charScore = charTotal === 0 ? 0 : (charLcs === charTotal ? 100 : Math.round((charLcs / charTotal) * 100));

    const finalScore = Math.max(wordScore, charScore);

    // 用字符级 diff 显示，保留原始文本的大小写、标点、空格、换行
    const charDiff = buildLcsDiff(stdChars, recChars, eqCI);
    return {
      score: clampScore(finalScore),
      diff: charDiff,
      standardDiff: charDiff.filter(t => t.status !== 'extra'),
    };
  }

  if (mode === 'strict') {
    const { diff, matched } = buildStrictDiff(standard, recognized);
    const score = matched === total ? 100 : Math.round((matched / total) * 100);
    return {
      score: clampScore(score),
      diff,
      standardDiff: diff.filter(t => t.status !== 'extra'),
    };
  }

  // fuzzy 模式：基于 LCS 相似度
  const lcs = lcsLength(standard, recognized);
  const score = lcs === total ? 100 : Math.round((lcs / total) * 100);
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
