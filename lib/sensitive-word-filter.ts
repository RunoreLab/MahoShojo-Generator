// lib/sensitive-word-filter.ts
import init, { cut } from 'jieba-wasm';

// 防止屏蔽，所以用base64编码并直接扔文件里
const sensitiveWordsConfig = {
  mask: "*",
  mask_word: "",
  words: [
    "5Lmg6L+R5bmz",
    "6IOh6ZSm5rab",
    "5rGf5rO95rCR",
    "5rip5a625a6d",
    "5p2O5YWL5by6",
    "5p2O6ZW/5pil",
    "5q+b5rO95Lic",
    "6YKT5bCP5bmz",
    "5ZGo5oGp5p2l",
    "6ams5YWL5oCd",
    "56S+5Lya5Li75LmJ",
    "5YWx5Lqn5YWa",
    "5YWx5Lqn5Li75LmJ",
    "5aSn6ZmG5a6Y5pa5",
    "5YyX5Lqs5pS/5p2D",
    "5Lit5Y2O5bid5Zu9",
    "5Lit5Zu95pS/5bqc",
    "5YWx54uX",
    "5YWt5Zub5LqL5Lu2",
    "5aSp5a6J6Zeo",
    "5YWr5Lmd5YWt5Zub",
    "5pS/5rK75bGA5bi45aeU",
    "5Lik5Lya",
    "5YWx6Z2S5Zui",
    "5a2m5r2u",
    //"5YWr5Lmd", 我感觉这个确实没太大必要，误报率太大
    "5LqM5Y2B5aSn",
    "5rCR6L+b5YWa",
    "5Y+w54us",
    "5Y+w5rm+54us56uL",
    "5Y+w5rm+5Zu9",
    "5Zu95rCR5YWa",
    "5Y+w5rm+5rCR5Zu9",
    "5Lit5Y2O5rCR5Zu9",
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
    "5oCn5Lqk",
    "5oCn54ix",
    "6Ieq5oWw",
    "6Zi06IyO",
    "5rer5aaH",
    "6IKb5Lqk",
    "5Lqk6YWN",
    "5oCn5YWz57O7",
    "5oCn5rS75Yqo",
    "6Imy5oOF",
    "6Imy5Zu+",
    "5rap5Zu+",
    "6KO45L2T",
    "5bCP56m0",
    "5rer6I2h",
    "57+75aKZ",
    "VlBO",
    "56eR5a2m5LiK572R",
    "5oyC5qKv5a2Q",
    "R0ZX",
    // 新增违禁词
    "5LiL5L2T6auY5r2u",
    "54ix5ray",
    "56eB5aSE",
    "54OI5aOr",
    "5ram5LmL",
    // 慈爱眷者相关违禁词
    "5LiL5L2T",
    "5amK",
    "5aaT5aWz",
    "57K+5ray",
    "5bCP56m0",
    "5Lmz5oi/",
    "572p5p2v",
    "5aiH5ZaY",
    "6IO45Zu0",
    "56eB5aSE",
    "5oCn5qyy",
    "5aW06Zq2",
    "5rer5Lmx",
    "5rer6I2h",
    "6IKb6Zeo",
    "5by65aW4",
    "552h5aW4",
    "5oCn5L61",
    "5oOF5qyy",
    "5oG25aCV",
    "5oi/5Lit5pyv",
    "5oCn6auY5r2u",
    "54ix5oqa",
    "5aiH5ZCf",
    "5r2u5ZC5",
    "5Liw6IW0",
    "6IuX5bqK",
    "5qao5Y+W",
    "6Zi06YGT",
    //"5Y+R5oOF", 暂时取消该词，以免因为突发情况等误封
    "5oCn5b+r5oSf",
    // 奥菲利亚相关违禁词
    "5oCA5a2V",
    // "5a+E55Sf",
    "5rOo5Y21",
    "5Y+X5a2V",
    "5rer6Z2h",
    "5a2Q5a6r",
    "6IKJ5aOB",
    "5YKs5oOF",
    "5oiQ55i+",
    // "5rSX6ISR",
    // 现实相关违禁词
    "5Lit5Zu9",
    "5Lit5Y2O5Lq65rCR5YWx5ZKM5Zu9",
    "5aSp5a6J6Zeo",
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
    "5byx5pm6",
    "6Im5",
    "5pSv55Wc",
    "6LSx56eN",
    // 1016新增
    "6LSe5pON6ZSB",
    "6Lez6JuL",
    // 落榜美术生相关
    "5biM54m55YuS",
    "5YWa5Y2r6Zif",
    "5YWa5Y2r5Yab",
    "54q55aSq",
    "56eN5peP54Gt57ud",
    "57qz57K5",
    "TmF6aQ==",
    "SGl0bGVy",
    "SmV3",
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
  /** 持有一次性的初始化 Promise（jieba + 敏感词装载） */
  private ready: Promise<void>;

  constructor() {
    this.config = sensitiveWordsConfig;
    // 并行启动：先初始化 jieba-wasm，再装载敏感词
    this.ready = this.bootstrap();
  }

  /** 统一启动流程 */
  private async bootstrap(): Promise<void> {
    // 1) 初始化 jieba-wasm（必须等待）
    await init();
    // 2) 装载敏感词
    await this.initialize();
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

    this.isInitialized = true;
    console.log(`✅ 敏感词过滤器初始化成功，加载了 ${this.sensitiveWords.length} 个敏感词`);
  }

  /**
   * 构建规范化文本以及对应的原始索引映射。
   */
  private normalizeTextWithMapping(text: string): { normalized: string; indexMap: number[] } {
    const normalizedChars: string[] = [];
    const indexMap: number[] = [];

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (/[^\u4e00-\u9fa5a-zA-Z0-9]/.test(char)) {
        continue;
      }
      normalizedChars.push(char.toLowerCase());
      indexMap.push(i);
    }

    return {
      normalized: normalizedChars.join(''),
      indexMap
    };
  }

  /**
   * 规范化文本：删除特殊符号，只保留汉字、数字和英文字符
   */
  private normalizeText(text: string): string {
    return this.normalizeTextWithMapping(text).normalized;
  }

  /**
   * 转义正则表达式特殊字符
   */
  private escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * 使用 jieba 进行分词（调用前应确保 init 完成）
   */
  private segmentText(text: string): string[] {
    try {
      return cut(text, true);
    } catch (error) {
      console.error('分词失败:', error);
      return [];
    }
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
    let filteredText = text;

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
      const key = `${startIndex}-${endIndex}-${matchType}-${word}`;
      if (seenMatchKeys.has(key)) {
        return;
      }
      seenMatchKeys.add(key);
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

    // 1. 直接匹配检测（处理正则表达式和普通匹配）
    for (const word of this.sensitiveWords) {
      // 处理正则表达式格式的敏感词
      const isRegex = word.includes('[') || word.includes('(') || word.includes('|');

      if (isRegex) {
        try {
          const regex = new RegExp(word, 'gi');
          let execResult: RegExpExecArray | null;
          let matched = false;
          while ((execResult = regex.exec(text)) !== null) {
            matched = true;
            const matchedText = execResult[0];
            const startIndex = execResult.index;
            const endIndex = startIndex + matchedText.length;
            addDetail(word, matchedText, startIndex, endIndex, 'regex');
            if (!detectedWords.includes(matchedText)) {
              detectedWords.push(matchedText);
            }
          }
          if (matched) {
            regex.lastIndex = 0;
            filteredText = filteredText.replace(regex, this.getMaskString());
          }
        } catch (regexError) {
          console.error('正则表达式格式错误:', regexError);
          const plainRegex = new RegExp(this.escapeRegExp(word), 'gi');
          let execResult: RegExpExecArray | null;
          let matched = false;
          while ((execResult = plainRegex.exec(text)) !== null) {
            matched = true;
            const matchedText = execResult[0];
            const startIndex = execResult.index;
            const endIndex = startIndex + matchedText.length;
            addDetail(word, matchedText, startIndex, endIndex, 'exact');
            if (!detectedWords.includes(matchedText)) {
              detectedWords.push(matchedText);
            }
          }
          if (matched) {
            plainRegex.lastIndex = 0;
            filteredText = filteredText.replace(plainRegex, this.getMaskString());
          }
        }
      } else {
        const regex = new RegExp(this.escapeRegExp(word), 'gi');
        let execResult: RegExpExecArray | null;
        let matched = false;
        while ((execResult = regex.exec(text)) !== null) {
          matched = true;
          const matchedText = execResult[0];
          const startIndex = execResult.index;
          const endIndex = startIndex + matchedText.length;
          addDetail(word, matchedText, startIndex, endIndex, 'exact');
          if (!detectedWords.includes(matchedText)) {
            detectedWords.push(matchedText);
          }
        }
        if (matched) {
          regex.lastIndex = 0;
          filteredText = filteredText.replace(regex, this.getMaskString());
        }
      }
    }

    // 2. 增强检测：规范化文本后检测（去除特殊符号）
    const { normalized, indexMap } = this.normalizeTextWithMapping(text);
    const normalizedSegments = this.segmentText(normalized);
    const segmentOffsets: number[] = [];
    let cumulativeOffset = 0;
    for (const segment of normalizedSegments) {
      segmentOffsets.push(cumulativeOffset);
      cumulativeOffset += segment.length;
    }

    for (const word of this.sensitiveWords) {
      // 跳过正则表达式格式的词
      if (word.includes('[') || word.includes('(') || word.includes('|')) {
        continue;
      }

      const normalizedWord = this.normalizeText(word);
      if (!normalizedWord || normalizedWord.length === 0) {
        continue;
      }

      for (let i = 0; i < normalizedSegments.length; i++) {
        const segment = normalizedSegments[i];
        const baseOffset = segmentOffsets[i] ?? 0;
        let searchIndex = 0;

        while (true) {
          const relativeIndex = segment.indexOf(normalizedWord, searchIndex);
          if (relativeIndex === -1) {
            break;
          }

          const startNormalized = baseOffset + relativeIndex;
          const endNormalized = startNormalized + normalizedWord.length - 1;

          if (startNormalized >= indexMap.length || endNormalized >= indexMap.length) {
            searchIndex = relativeIndex + 1;
            continue;
          }

          const startIndex = indexMap[startNormalized];
          const endIndex = indexMap[endNormalized];

          if (typeof startIndex === 'number' && typeof endIndex === 'number') {
            const slicingEnd = endIndex + 1;
            const matchedText = text.slice(startIndex, slicingEnd);
            addDetail(word, matchedText, startIndex, slicingEnd, 'variant');

            if (
              !detectedWords.includes(word) &&
              !detectedWords.includes(`${word}(变体)`)
            ) {
              detectedWords.push(`${word}(变体)`);
            }

            const maskLength = Math.max(1, slicingEnd - startIndex);
            const maskChar = this.config?.mask || '*';
            const maskString = maskChar.repeat(maskLength);
            filteredText = `${filteredText.slice(0, startIndex)}${maskString}${filteredText.slice(slicingEnd)}`;
          }

          searchIndex = relativeIndex + 1;
        }
      }
    }

    const hasSensitiveWords = detectedWords.length > 0;

    return {
      hasSensitiveWords,
      detectedWords,
      filteredText,
      originalText: text,
      shouldRedirectToArrested: hasSensitiveWords,
      matchDetails
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
