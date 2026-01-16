// lib/sensitive-word-filter.ts
import { pinyin } from 'pinyin-pro';
import {
  buildKeepCharsMapping,
  buildLatinTokenMappingForPinyinCheck,
  createWordsSearch,
  foldFullwidthAscii,
  keepHanOrAsciiWordChar,
  normalizeLatin,
  toSimplifiedChinese,
  uniqBy,
} from '@/lib/word-filter-utils';

// 防止屏蔽，所以用base64编码并直接扔文件里
const sensitiveWordsConfig = {
  mask: "*",
  mask_word: "",
  words: [
    // "5YWx5Lqn5YWa",
    // "5YWx5Lqn5Li75LmJ",
    "5aSn6ZmG5a6Y5pa5",
    "5YyX5Lqs5pS/5p2D",
    "5Lit5Y2O5bid5Zu9",
    "5YWx54uX",
    "5YWt5Zub5LqL5Lu2",
    "5YWr5Lmd5YWt5Zub",
    "5pS/5rK75bGA5bi45aeU",
    "5YWx6Z2S5Zui",
    "5a2m5r2u",
    "5rCR6L+b5YWa",
    "5Y+w54us",
    "5Y+w5rm+54us56uL",
    "5Y+w5rm+5Zu9",
    "5Y+w5rm+5rCR5Zu9",
    "cG9ybmh1Yg==",
    "UG9ybmh1Yg==",
    "W1l5XW91W1BwXW9ybg==",
    "cG9ybg==",
    "UG9ybg==",
    "W1h4XVtWdl1pZGVvcw==",
    "W1JyXWVkW1R0XXViZQ==",
    "W1h4XVtIaF1hbXN0ZXI=",
    "W1NzXXBhbmtbV3ddaXJl",
    "W1NzXXBhbmtbQmJdYW5n",
    "W1R0XXViZTg=",
    "W1l5XW91W0pqXWl6eg==",
    "W0JiXXJhenplcnM=",
    "W05uXWF1Z2h0eVsgXT9bQWFdbWVyaWNh",
    "5L2c54ix",
    "5YGa54ix",
    // "5oCn5Lqk",
    "5oCn54ix",
    "6Ieq5oWw",
    "6Zi06IyO",
    "5rer5aaH",
    "6IKb5Lqk",
    "5Lqk6YWN",
    // "6Imy5oOF",
    "6KO45L2T",
    "5rer6I2h",
    "57+75aKZ",
    "VlBO",
    "56eR5a2m5LiK572R",
    "5oyC5qKv5a2Q",
    "R0ZX",
    // 新增违禁词
    "5LiL5L2T6auY5r2u",
    "54ix5ray",
    "54OI5aOr",
    // 慈爱眷者相关违禁词
    "5amK",
    "5aaT5aWz",
    "57K+5ray",
    "5rer5Lmx",
    "5by65aW4",
    "552h5aW4",
    "5oCn5L61",
    "5oi/5Lit5pyv",
    "5oCn6auY5r2u",
    "54ix5oqa",
    "5aiH5ZCf",
    "5r2u5ZC5",
    "6IuX5bqK",
    "5qao5Y+W",
    "6Zi06YGT",
    "5oCn5b+r5oSf",
    "6IKJ5L6/5Zmo",
    // 奥菲利亚相关违禁词
    "5rOo5Y21",
    "5Y+X5a2V",
    "5YKs5oOF",
    // 侮辱性词汇
    "5rue57qz",
    "5pSv6YKj",
    // 涉政人物
    "546L5rSq5paH",
    "5byg5pil5qGl",
    "5rGf6Z2S",
    "5aea5paH5YWD",
    "5p6X5b2q",
    "5q+b5bK46Iux",
    "5aSp55qH",
    // Abuse
    "6LSx55Wc",
    "5YK76YC8",
    "54We56yU",
    "6ISR55ir",
    "6Im5",
    "5pSv55Wc",
    "6LSx56eN",
    // 1016新增
    "6LSe5pON6ZSB",
    "6Lez6JuL",
    // 落榜美术生相关
    "5YWa5Y2r6Zif",
    "5YWa5Y2r5Yab",
    "54q55aSq",
    "56eN5peP54Gt57ud",
    "57qz57K5",
    // 魅魔相关
    "5rer57q5",
    "5rer5Y+r",
    "6a2F6a2U5YyW",
    "6a2F6a2U5Zug5a2Q",
    "5qao57K+",
    // 奶牛相关
    "5qao5Lmz",
    "5rOM5Lmz",
    "5YKs5Lmz",
    "5qao5aW2",
    "5rOM5aW2",
    "5YKs5aW2",
    // 其他
    "5aqa6I2v",
  ],
  encoding: "base64",
  original_count: 71
};

/**
 * 匹配到的敏感词详细信息
 */
export interface SensitiveMatchDetail {
  /** 敏感词词条（词表原文） */
  word: string;
  /** 实际匹配到的文本片段 */
  matchedText: string;
  /** 匹配类型：直接命中、正则命中或规范化后的变体 */
  matchType: 'exact' | 'regex' | 'variant';
  /** 在原始文本中的起始下标（闭区间左端） */
  startIndex: number;
  /** 在原始文本中的结束下标（开区间右端） */
  endIndex: number;
  /** 匹配前的上下文（最多12字符） */
  contextBefore: string;
  /** 匹配后的上下文（最多12字符） */
  contextAfter: string;
}

/**
 * 敏感词过滤结果接口
 */
export interface FilterResult {
  /** 是否包含敏感词 */
  hasSensitiveWords: boolean;
  /** 检测到的敏感词列表 */
  detectedWords: string[];
  /** 过滤后的文本（敏感词被替换） */
  filteredText: string;
  /** 原始文本 */
  originalText: string;
  /** 是否需要跳转到被捕页面 */
  shouldRedirectToArrested: boolean;
  /** 详细匹配列表 */
  matchDetails: SensitiveMatchDetail[];
}

/**
 * 敏感词配置接口
 */
interface SensitiveWordsConfig {
  mask: string;
  mask_word: string;
  words: string[];
  encoding?: string;
  original_count?: number;
}

/**
 * 兼容 Edge Runtime 的 Base64 解码函数
 * @param str Base64 编码的字符串
 * @returns 解码后的 UTF-8 字符串
 */
const base64Decode = (str: string): string => {
  try {
        // atob 是 Web API 标准，用于解码 Base64
        // 但是 atob 不支持 UTF-8，需要进行额外转换
    const binaryString = atob(str);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
        // TextDecoder 是处理编码的标准方式
    return new TextDecoder('utf-8').decode(bytes);
  } catch (e) {
    console.error("Base64解码失败:", e);
    return "";
  }
};

/**
 * 敏感词过滤器类
 */
export class SensitiveWordFilter {
  private sensitiveWords: string[] = [];
  private config: SensitiveWordsConfig | null = null;
  private isInitialized = false;
  /** 持有一次性的初始化 Promise（装载敏感词 + 构建索引） */
  private ready: Promise<void>;

  private plainKeywordsLower: string[] = [];
  private regexKeywords: string[] = [];
  private plainSearch: ReturnType<typeof createWordsSearch> | null = null;

  private pinyinKeywords: string[] = [];
  private pinyinToSource: Map<string, string> = new Map();
  private pinyinSearch: ReturnType<typeof createWordsSearch> | null = null;

  constructor() {
    this.config = sensitiveWordsConfig;
    this.ready = this.initialize();
  }

  /**
   * 初始化敏感词列表
   */
  private async initialize(): Promise<void> {
    if (!this.config || !this.config.words) {
      throw new Error('配置文件格式错误');
    }

    // 如果是编码后的文件，需要解码
    if (this.config.encoding === 'base64') {
      // 使用 Web 标准的 atob() 和 TextDecoder 进行解码，以确保兼容性。
      this.sensitiveWords = this.config.words.map(word => base64Decode(word));
    } else {
      this.sensitiveWords = [...this.config.words];
    }

    // 分离：正则词条 vs 普通词条
    const regexKeywords: string[] = [];
    const plainKeywords: string[] = [];
    for (const word of this.sensitiveWords) {
      if (!word) continue;
      const isRegex = word.includes('[') || word.includes('(') || word.includes('|');
      if (isRegex) {
        regexKeywords.push(word);
      } else {
        plainKeywords.push(word);
      }
    }

    this.regexKeywords = regexKeywords;

    // 构建：繁转简 + 小写（WordsSearch 是大小写敏感的）
    this.plainKeywordsLower = plainKeywords
      .map((w) => toSimplifiedChinese(w).toLowerCase())
      .filter((w) => typeof w === 'string' && w.trim().length > 0);

    this.plainSearch = createWordsSearch(this.plainKeywordsLower);

    // 构建：拼音关键字（用于拦截纯拼音绕过）
    // 只对“至少2个汉字”的词条生成拼音，避免单字拼音带来误伤。
    const pinyinKeywords: string[] = [];
    for (const sourceWord of plainKeywords) {
      const simplified = toSimplifiedChinese(sourceWord);
      const hanCharCount = Array.from(simplified).filter((ch) => /[\u4e00-\u9fa5]/.test(ch)).length;
      if (hanCharCount < 2) continue;

      let p = '';
      try {
        const arr = pinyin(simplified, { toneType: 'none', type: 'array' }) as unknown as string[];
        p = Array.isArray(arr) ? arr.join('') : String(arr ?? '');
      } catch {
        p = '';
      }
      const normalized = normalizeLatin(p);
      if (!normalized) continue;

      pinyinKeywords.push(normalized);
      // 若多个词条拼音相同，保留“更长”的源词条，便于日志/展示更明确。
      const prev = this.pinyinToSource.get(normalized);
      if (!prev || prev.length < sourceWord.length) {
        this.pinyinToSource.set(normalized, sourceWord);
      }
    }

    this.pinyinKeywords = Array.from(new Set(pinyinKeywords));
    this.pinyinSearch = this.pinyinKeywords.length > 0 ? createWordsSearch(this.pinyinKeywords) : null;

    this.isInitialized = true;
    console.log(`✅ 敏感词过滤器初始化成功，加载了 ${this.sensitiveWords.length} 个敏感词`);
  }

  /**
   * 转义正则表达式特殊字符
   */
  private escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * 检查文本中是否包含敏感词（异步，确保ready）
   */
  async checkText(text: string): Promise<FilterResult> {
    // 确保 jieba 和词表都准备好
    await this.ready;

    if (!this.isInitialized) {
      throw new Error('过滤器未初始化成功');
    }

    const detectedWords: string[] = [];
    const matchDetails: SensitiveMatchDetail[] = [];
    const seenMatchKeys = new Set<string>();
    const seenSpans = new Set<string>();
    let filteredText = text;

    const maskRange = (startIndex: number, endIndex: number) => {
      if (startIndex < 0 || endIndex <= startIndex) return;
      const maskChar = this.config?.mask || '*';
      const maskString = maskChar.repeat(Math.max(1, endIndex - startIndex));
      filteredText = `${filteredText.slice(0, startIndex)}${maskString}${filteredText.slice(endIndex)}`;
    };

    const addDetail = (
      word: string,
      matchedText: string,
      startIndex: number,
      endIndex: number,
      matchType: SensitiveMatchDetail['matchType']
    ) => {
      if (startIndex < 0 || endIndex <= startIndex) {
        return;
      }
      const spanKey = `${startIndex}-${endIndex}`;
      // 同一片段优先保留首次命中（避免 exact 命中后又被 variant/pinyin 重复标记）
      if (seenSpans.has(spanKey) && matchType === 'variant') {
        return;
      }
      const key = `${startIndex}-${endIndex}-${matchType}-${word}`;
      if (seenMatchKeys.has(key)) {
        return;
      }
      seenMatchKeys.add(key);
      seenSpans.add(spanKey);
      matchDetails.push({
        word,
        matchedText,
        matchType,
        startIndex,
        endIndex,
        contextBefore: text.slice(Math.max(0, startIndex - 12), startIndex),
        contextAfter: text.slice(endIndex, Math.min(text.length, endIndex + 12))
      });
    };

    const simplified = foldFullwidthAscii(toSimplifiedChinese(text));

    // 1) 正则词条：在“繁转简”文本上跑一遍，索引可直接映射回原文（长度一致）
    for (const word of this.regexKeywords) {
      try {
        const regex = new RegExp(word, 'gi');
        let execResult: RegExpExecArray | null;
        while ((execResult = regex.exec(simplified)) !== null) {
          const matchedText = execResult[0];
          const startIndex = execResult.index;
          const endIndex = startIndex + matchedText.length;
          addDetail(word, text.slice(startIndex, endIndex), startIndex, endIndex, 'regex');
          if (!detectedWords.includes(matchedText)) detectedWords.push(matchedText);
          maskRange(startIndex, endIndex);
        }
        regex.lastIndex = 0;
      } catch (regexError) {
        console.error('正则表达式格式错误:', regexError);
        const fallback = new RegExp(this.escapeRegExp(word), 'gi');
        let execResult: RegExpExecArray | null;
        while ((execResult = fallback.exec(simplified)) !== null) {
          const matchedText = execResult[0];
          const startIndex = execResult.index;
          const endIndex = startIndex + matchedText.length;
          addDetail(word, text.slice(startIndex, endIndex), startIndex, endIndex, 'exact');
          if (!detectedWords.includes(matchedText)) detectedWords.push(matchedText);
          maskRange(startIndex, endIndex);
        }
        fallback.lastIndex = 0;
      }
    }

    // 2) 普通词条（繁体/简体统一）：在“繁转简+小写”文本上做 Aho-Corasick
    const simplifiedLower = simplified.toLowerCase();
    if (this.plainSearch) {
      const exactMatches = this.plainSearch.FindAll(simplifiedLower) as any[];
      for (const m of exactMatches) {
        const startIndex = Number(m?.Start);
        const endIndexInclusive = Number(m?.End);
        if (!Number.isFinite(startIndex) || !Number.isFinite(endIndexInclusive)) continue;
        const endIndex = endIndexInclusive + 1;
        const keyword = String(m?.Keyword ?? '');
        if (!keyword) continue;

        const matchedText = text.slice(startIndex, endIndex);
        addDetail(keyword, matchedText, startIndex, endIndex, 'exact');
        if (!detectedWords.includes(matchedText)) detectedWords.push(matchedText);
        maskRange(startIndex, endIndex);
      }
    }

    // 3) 去符号/插入字符绕过：对“繁转简+小写”做过滤映射后再检索
    if (this.plainSearch) {
      const { normalized, indexMap } = buildKeepCharsMapping(simplifiedLower, keepHanOrAsciiWordChar);
      const variantMatches = this.plainSearch.FindAll(normalized) as any[];
      for (const m of variantMatches) {
        const startNormalized = Number(m?.Start);
        const endNormalizedInclusive = Number(m?.End);
        const keyword = String(m?.Keyword ?? '');
        if (!Number.isFinite(startNormalized) || !Number.isFinite(endNormalizedInclusive) || !keyword) continue;
        if (startNormalized < 0 || endNormalizedInclusive < startNormalized) continue;
        if (endNormalizedInclusive >= indexMap.length) continue;

        const startIndex = indexMap[startNormalized];
        const endIndex = indexMap[endNormalizedInclusive] + 1;
        const matchedText = text.slice(startIndex, endIndex);
        addDetail(keyword, matchedText, startIndex, endIndex, 'variant');
        if (!detectedWords.includes(`${keyword}(变体)`)) detectedWords.push(`${keyword}(变体)`);
        maskRange(startIndex, endIndex);
      }
    }

    // 4) 纯拼音绕过：对原文抽取拉丁字母/数字后检索拼音关键字
    if (this.pinyinSearch) {
      const { normalized, indexMap, isTokenStart, isTokenEnd } = buildLatinTokenMappingForPinyinCheck(text);
      if (normalized) {
        const pinyinMatches = this.pinyinSearch.FindAll(normalized) as any[];
        for (const m of pinyinMatches) {
          const startNormalized = Number(m?.Start);
          const endNormalizedInclusive = Number(m?.End);
          const keywordPinyin = String(m?.Keyword ?? '');
          if (!Number.isFinite(startNormalized) || !Number.isFinite(endNormalizedInclusive) || !keywordPinyin) continue;
          if (startNormalized < 0 || endNormalizedInclusive < startNormalized) continue;
          if (endNormalizedInclusive >= indexMap.length) continue;
          // 关键：只接受“整 token 命中”（可跨 token），避免在长英文/驼峰标识符里子串误报
          if (!isTokenStart[startNormalized] || !isTokenEnd[endNormalizedInclusive]) continue;

          const startIndex = indexMap[startNormalized];
          const endIndex = indexMap[endNormalizedInclusive] + 1;
          const sourceWord = this.pinyinToSource.get(keywordPinyin) ?? keywordPinyin;
          const matchedText = text.slice(startIndex, endIndex);
          addDetail(sourceWord, matchedText, startIndex, endIndex, 'variant');
          if (!detectedWords.includes(`${sourceWord}(拼音)`)) detectedWords.push(`${sourceWord}(拼音)`);
          maskRange(startIndex, endIndex);
        }
      }
    }

    const hasSensitiveWords = detectedWords.length > 0;

    return {
      hasSensitiveWords,
      detectedWords: uniqBy(detectedWords, (x) => x),
      filteredText,
      originalText: text,
      shouldRedirectToArrested: hasSensitiveWords,
      matchDetails: uniqBy(matchDetails, (d) => `${d.startIndex}-${d.endIndex}-${d.matchType}-${d.word}`),
    };
  }

  /**
   * 获取遮罩字符串
   */
  private getMaskString(): (match: string) => string {
    return (match: string) => {
      if (this.config?.mask_word && this.config.mask_word.trim() !== '') {
        return this.config.mask_word;
      } else {
        return (this.config?.mask || '*').repeat(match.length);
      }
    };
  }

  /**
   * 批量检查文本数组（异步）
   */
  async checkTextArray(texts: string[]): Promise<FilterResult[]> {
    // 并发检查，内部会共享同一个 ready
    return Promise.all(texts.map(text => this.checkText(text)));
  }

  /**
   * 检查文本并决定是否跳转（异步）
   */
  async checkAndRedirect(text: string, redirectCallback?: () => void): Promise<FilterResult> {
    const result = await this.checkText(text);

    if (result.shouldRedirectToArrested) {
      console.warn(`🚨 检测到敏感词: ${result.detectedWords.join(', ')}`);

      if (redirectCallback) {
        redirectCallback();
      } else {
        // 如果在浏览器环境中
        if (typeof window !== 'undefined' && (window as any).location) {
          (window as any).location.href = '/arrested';
        } else {
          console.log('🚨 应该跳转到 /arrested 页面');
        }
      }
    }

    return result;
  }
}

/**
 * 创建默认的敏感词过滤器实例
 */
let sharedFilter: SensitiveWordFilter | null = null;

export const createSensitiveWordFilter = (): SensitiveWordFilter => {
  if (!sharedFilter) {
    sharedFilter = new SensitiveWordFilter();
  }
  return sharedFilter;
};

/**
 * 快速检查并跳转函数（异步版本）
 */
export const quickCheck = async (text: string): Promise<FilterResult> => {
  const filter = createSensitiveWordFilter();
  try {
    return await filter.checkText(text);
  } catch (error) {
    console.error('敏感词检测失败，启用安全回退逻辑。', error);
    return {
      hasSensitiveWords: false,
      detectedWords: [],
      filteredText: text,
      originalText: text,
      shouldRedirectToArrested: false,
      matchDetails: []
    };
  }
};

export default SensitiveWordFilter;
