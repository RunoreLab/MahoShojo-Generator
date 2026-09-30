/**
 * 魔法茶会「单条消息长度」与「历史总长度」的唯一事实源。
 *
 * 设计要点：
 * - 单条超长不再硬失败：统一走中间截断（head + tail + 显式标记），保证剧情开头与结尾都在。
 * - 真正需要硬拒绝的边界是「历史总长度」，它与请求体大小线性相关，是唯一的 DoS 面。
 * - 单条预算按上下文窗口分档，避免小窗口模型被塞进超出其上下文的消息。
 */

export const MAGIC_TEA_PARTY_MIN_MESSAGE_CHARS = 8_000;
export const MAGIC_TEA_PARTY_MAX_MESSAGE_CHARS = 48_000;
export const MAGIC_TEA_PARTY_MAX_TOTAL_CHARS = 800_000;

/** 中间截断时保留的头部比例，其余给尾部。 */
const HEAD_RATIO = 0.7;

export type MagicTeaPartyMessageCharTier = {
  maxContextWindowTokens: number;
  messageChars: number;
};

/** 参考 Claude Code 的分档思路：可见内容上限随上下文窗口放大。 */
export const MAGIC_TEA_PARTY_MESSAGE_CHAR_TIERS: readonly MagicTeaPartyMessageCharTier[] = [
  { maxContextWindowTokens: 8_192, messageChars: 8_000 },
  { maxContextWindowTokens: 32_768, messageChars: 16_000 },
  { maxContextWindowTokens: 65_536, messageChars: 24_000 },
  { maxContextWindowTokens: 131_072, messageChars: 32_000 },
  { maxContextWindowTokens: Number.POSITIVE_INFINITY, messageChars: 48_000 },
];

export type MagicTeaPartyClippedContent = {
  text: string;
  clipped: boolean;
  originalLength: number;
  /** 实际保留的字符数（未截断时等于 originalLength）。 */
  keptLength: number;
  /** 被省略的字符数。 */
  omittedLength: number;
};

export type MagicTeaPartyClippedMessage = {
  id: string;
  index: number;
  originalLength: number;
  keptLength: number;
  omittedLength: number;
  limit: number;
};

export type MagicTeaPartyLimitedMessage<T> = T & {
  content: string;
};

export type MagicTeaPartyMessageLimitsResult<T> = {
  messages: MagicTeaPartyLimitedMessage<T>[];
  clippedMessages: MagicTeaPartyClippedMessage[];
  totalChars: number;
  totalOmittedChars: number;
};

/**
 * 按上下文窗口解析单条消息字符预算。
 *
 * 上下文窗口未知（未配置 / 非法）时回落到最大档：宁可多截一点，
 * 也不把一条可能超出模型上下文的消息原样推给上游。
 */
export const resolveMagicTeaPartyMessageCharLimit = (
  contextWindowTokens?: number | null
): number => {
  const usable =
    typeof contextWindowTokens === 'number' && Number.isFinite(contextWindowTokens)
      ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(contextWindowTokens)))
      : Number.POSITIVE_INFINITY;

  for (const tier of MAGIC_TEA_PARTY_MESSAGE_CHAR_TIERS) {
    if (usable <= tier.maxContextWindowTokens) return tier.messageChars;
  }
  return MAGIC_TEA_PARTY_MAX_MESSAGE_CHARS;
};

const buildClippedMarker = (omittedLength: number): string =>
  `\n\n…（本条消息过长，已省略中段 ${omittedLength} 字）…\n\n`;

/**
 * 中间截断：保留头部与尾部，中间用显式标记替代。
 *
 * 标记是刻意暴露给模型的，让它知道这是人为裁剪而非原文缺失。
 */
export const clipMagicTeaPartyMessageContent = (
  content: string,
  limit: number
): MagicTeaPartyClippedContent => {
  const text = typeof content === 'string' ? content : '';
  const effectiveLimit =
    typeof limit === 'number' && Number.isFinite(limit) && limit > 0
      ? Math.floor(limit)
      : MAGIC_TEA_PARTY_MIN_MESSAGE_CHARS;

  if (text.length <= effectiveLimit) {
    return {
      text,
      clipped: false,
      originalLength: text.length,
      keptLength: text.length,
      omittedLength: 0,
    };
  }

  // 先为标记预留空间，避免「截断后仍然超限」。
  const markerBudget = 48;
  const budget = Math.max(effectiveLimit - markerBudget, 1);
  const headLength = Math.max(1, Math.floor(budget * HEAD_RATIO));
  const tailLength = Math.max(1, budget - headLength);

  const head = text.slice(0, headLength);
  const tail = tailLength > 0 ? text.slice(text.length - tailLength) : '';
  const omittedLength = text.length - headLength - tailLength;
  const marker = buildClippedMarker(omittedLength);

  return {
    text: `${head}${marker}${tail}`,
    clipped: true,
    originalLength: text.length,
    keptLength: headLength + marker.length + tailLength,
    omittedLength,
  };
};

/**
 * 对整段历史应用单条截断，并统计总字符数。
 * 不会删除消息，也不做顺序调整——丢弃整条消息由 trimMagicTeaPartyHistory 负责。
 */
export const applyMagicTeaPartyMessageLimits = <T extends { id: string; content: string }>(
  messages: readonly T[],
  limit: number
): MagicTeaPartyMessageLimitsResult<T> => {
  const list = Array.isArray(messages) ? messages : [];
  const clippedMessages: MagicTeaPartyClippedMessage[] = [];
  let totalChars = 0;
  let totalOmittedChars = 0;

  const limited = list.map((message, index) => {
    const clipped = clipMagicTeaPartyMessageContent(message?.content ?? '', limit);
    totalChars += clipped.originalLength;
    if (clipped.clipped) {
      totalOmittedChars += clipped.omittedLength;
      clippedMessages.push({
        id: message?.id ?? '',
        index,
        originalLength: clipped.originalLength,
        keptLength: clipped.keptLength,
        omittedLength: clipped.omittedLength,
        limit,
      });
      return { ...message, content: clipped.text };
    }
    return { ...message, content: clipped.text };
  });

  return { messages: limited, clippedMessages, totalChars, totalOmittedChars };
};

export const formatMagicTeaPartyTotalOverflowMessage = (totalChars: number): string =>
  `本次提交的对话历史共 ${totalChars} 字，超过单次请求 ${MAGIC_TEA_PARTY_MAX_TOTAL_CHARS} 字上限。请减少消息条数、删除无关长消息，或先生成摘要后再继续。`;

/** 客户端在发送前提示用户，与服务端使用同一套上限。 */
export const isMagicTeaPartyTotalOverflow = (totalChars: number): boolean =>
  totalChars > MAGIC_TEA_PARTY_MAX_TOTAL_CHARS;
