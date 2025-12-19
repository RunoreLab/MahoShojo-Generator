// lib/shield-word-filter.ts

/**
 * 说明：
 * - “屏蔽词”不会触发逮捕；只会在文本中被和谐（默认使用 ❀ 遮罩，或按配置替换为指定文本）。
 * - 屏蔽词词表使用 base64 编码，避免被直接扫描。
 * - 替换词不需要 base64，可明文存储。
 */

interface ShieldWordsConfig {
  mask: string;
  words: string[];
  replace?: Record<string, string>;
  encoding?: 'base64';
}

export interface ShieldWordFilterResult {
  hasShieldWords: boolean;
  detectedWords: string[];
  filteredText: string;
  originalText: string;
}

// 防止屏蔽，所以用 base64 编码并直接扔文件里
const shieldWordsConfig: ShieldWordsConfig = {
  // 使用非 Markdown 特殊字符作为遮罩，避免 `*` 触发强调/列表等解析
  mask: '❀',
  words: [
    // 默认使用 ❀ 遮罩
    // '5YWr5Lmd',
    '5Y+R5oOF',
    '5a+E55Sf',
    '5a2Q5a6r',
    // '5rSX6ISR',
    // 替换词
    '5Lit5Zu9',
  ],
  replace: {
    // key 为 base64 编码的屏蔽词，value 为明文替换词
    '5Lit5Zu9': '【国度】',
  },
  encoding: 'base64',
};

const base64Decode = (str: string): string => {
  try {
    if (typeof atob === 'function') {
      const binaryString = atob(str);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return new TextDecoder('utf-8').decode(bytes);
    }

    const BufferCtor = (globalThis as any).Buffer as
      | { from: (input: string, encoding: string) => { toString: (encoding: string) => string } }
      | undefined;
    if (BufferCtor?.from) {
      return BufferCtor.from(str, 'base64').toString('utf8');
    }
  } catch (error) {
    console.error('Base64解码失败:', error);
  }
  return '';
};

const escapeRegExp = (str: string): string => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildReplaceMap = (config: ShieldWordsConfig): Map<string, string> => {
  const map = new Map<string, string>();
  if (!config.replace) return map;

  const entries = Object.entries(config.replace);
  for (const [encodedWord, replacement] of entries) {
    const decodedWord = config.encoding === 'base64' ? base64Decode(encodedWord) : encodedWord;
    if (!decodedWord) continue;
    map.set(decodedWord, replacement);
  }
  return map;
};

let decodedWordsCache: string[] | null = null;
let replaceMapCache: Map<string, string> | null = null;

const getDecodedWords = (): string[] => {
  if (decodedWordsCache) return decodedWordsCache;
  if (shieldWordsConfig.encoding === 'base64') {
    decodedWordsCache = shieldWordsConfig.words.map((word) => base64Decode(word)).filter(Boolean);
  } else {
    decodedWordsCache = [...shieldWordsConfig.words];
  }
  return decodedWordsCache;
};

const getReplaceMap = (): Map<string, string> => {
  if (replaceMapCache) return replaceMapCache;
  replaceMapCache = buildReplaceMap(shieldWordsConfig);
  return replaceMapCache;
};

export const applyShieldWords = (text: string): ShieldWordFilterResult => {
  const words = getDecodedWords();
  const replaceMap = getReplaceMap();
  const maskChar = shieldWordsConfig.mask || '❀';

  let filteredText = text;
  const detectedWords: string[] = [];

  for (const word of words) {
    if (!word) continue;
    const regex = new RegExp(escapeRegExp(word), 'gi');
    if (!regex.test(filteredText)) {
      continue;
    }

    regex.lastIndex = 0;
    const replacement = replaceMap.get(word);
    filteredText = filteredText.replace(regex, (match) => {
      if (!detectedWords.includes(match)) {
        detectedWords.push(match);
      }
      if (typeof replacement === 'string') {
        return replacement;
      }
      // `match.length` 以 UTF-16 code unit 计数，遇到 emoji/代理对会产生长度偏差；这里按 code point 计数更接近“字符数”。
      const maskLength = Math.max(1, Array.from(match).length);
      return maskChar.repeat(maskLength);
    });
  }

  return {
    hasShieldWords: detectedWords.length > 0,
    detectedWords,
    filteredText,
    originalText: text,
  };
};

