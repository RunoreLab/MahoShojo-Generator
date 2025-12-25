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
