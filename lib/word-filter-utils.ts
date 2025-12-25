// lib/word-filter-utils.ts
import { WordsSearch } from '@/lib/vendor/toolgood/ToolGood.Words.WordsSearch.mjs';
import { Translate } from '@/lib/vendor/toolgood/ToolGood.Words.Translate.mjs';

export type WordSearchMatch = {
  Keyword: string;
  Success: boolean;
  End: number;
  Start: number;
  Index: number;
};

const translatorSingleton: { instance: InstanceType<typeof Translate> | null } = { instance: null };

export const toSimplifiedChinese = (text: string): string => {
  if (!translatorSingleton.instance) {
    translatorSingleton.instance = new Translate() as InstanceType<typeof Translate>;
  }
  // 上游 JS 定义为 (text, type)，虽然文档示例允许省略 type，但 TS 会要求传参；这里固定用 0 表示默认转换。
  return translatorSingleton.instance.ToSimplifiedChinese(text, 0);
};

export const normalizeLatin = (text: string): string => {
  // 1) 兼容全角/组合音标；2) 去除音标；3) 去除分隔符；4) 统一 ü/v/u: 的常见写法
  const nfkc = text.normalize('NFKC');
  const noMarks = nfkc.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  return noMarks
    .toLowerCase()
    .replace(/u:/g, 'u')
    .replace(/ü/g, 'u')
    .replace(/v/g, 'u')
    .replace(/[^a-z0-9]/g, '');
};

export const foldFullwidthAscii = (text: string): string => {
  // 将全角 A-Z a-z 0-9 折叠为半角；长度保持一致（便于用原文索引做替换）
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    // ０-９
    if (code >= 0xff10 && code <= 0xff19) {
      out += String.fromCharCode(code - 0xfee0);
      continue;
    }
    // Ａ-Ｚ
    if (code >= 0xff21 && code <= 0xff3a) {
      out += String.fromCharCode(code - 0xfee0);
      continue;
    }
    // ａ-ｚ
    if (code >= 0xff41 && code <= 0xff5a) {
      out += String.fromCharCode(code - 0xfee0);
      continue;
    }
    out += text[i];
  }
  return out;
};

const stripCombiningMarks = (text: string): string => text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');

/**
 * 为“纯拼音绕过”检测构造拉丁字符映射：
 * - 只保留能归一化为 [a-z0-9] 的字符（全角折叠、去音标、统一大小写、v/ü/u: -> u）
 * - 同时记录 token 边界（token 由原文中连续的拉丁/数字组成）
 *
 * 重要：拼音检测必须基于 token 边界做“整 token 命中”，否则会在驼峰/长英文标识符里产生大量误报
 * （例如 `setUniversalProc` 会包含 `setu`，而 `setu` 恰好是“涩图”的拼音）。
 */
export const buildLatinTokenMappingForPinyinCheck = (
  text: string
): { normalized: string; indexMap: number[]; isTokenStart: boolean[]; isTokenEnd: boolean[] } => {
  const normalizedChars: string[] = [];
  const indexMap: number[] = [];
  const tokenStarts: number[] = [];
  const tokenEnds: number[] = [];

  let inToken = false;

  for (let i = 0; i < text.length; i++) {
    const raw = text[i];
    const folded = foldFullwidthAscii(raw);
    const noMarks = stripCombiningMarks(folded);

    // 允许某些字符展开为多个 ASCII（例如 NFKC 的合字），每个展开字符都映射回同一原始索引
    const outChars: string[] = [];
    for (const ch of noMarks) {
      if (/[a-zA-Z0-9]/.test(ch)) {
        let lowered = ch.toLowerCase();
        if (lowered === 'v') lowered = 'u';
        outChars.push(lowered);
      }
    }

    if (outChars.length === 0) {
      if (inToken) {
        tokenEnds.push(normalizedChars.length - 1);
        inToken = false;
      }
      continue;
    }

    if (!inToken) {
      tokenStarts.push(normalizedChars.length);
      inToken = true;
    }

    for (const ch of outChars) {
      normalizedChars.push(ch);
      indexMap.push(i);
    }
  }

  if (inToken) {
    tokenEnds.push(normalizedChars.length - 1);
  }

  const isTokenStart = new Array(normalizedChars.length).fill(false);
  const isTokenEnd = new Array(normalizedChars.length).fill(false);
  for (const s of tokenStarts) {
    if (s >= 0 && s < isTokenStart.length) isTokenStart[s] = true;
  }
  for (const e of tokenEnds) {
    if (e >= 0 && e < isTokenEnd.length) isTokenEnd[e] = true;
  }

  return { normalized: normalizedChars.join(''), indexMap, isTokenStart, isTokenEnd };
};

export const buildKeepCharsMapping = (
  text: string,
  keepChar: (ch: string) => boolean
): { normalized: string; indexMap: number[] } => {
  const normalizedChars: string[] = [];
  const indexMap: number[] = [];

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (!keepChar(ch)) continue;
    normalizedChars.push(ch);
    indexMap.push(i);
  }

  return { normalized: normalizedChars.join(''), indexMap };
};

export const keepHanOrAsciiWordChar = (ch: string): boolean => /[\u4e00-\u9fa5a-zA-Z0-9]/.test(ch);
export const keepAsciiWordChar = (ch: string): boolean => /[a-zA-Z0-9]/.test(ch);

export const createWordsSearch = (keywords: string[]): InstanceType<typeof WordsSearch> => {
  const ws = new (WordsSearch as any)() as InstanceType<typeof WordsSearch>;
  ws.SetKeywords(keywords);
  return ws;
};

export const uniqBy = <T>(items: T[], keyOf: (item: T) => string): T[] => {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = keyOf(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
};
