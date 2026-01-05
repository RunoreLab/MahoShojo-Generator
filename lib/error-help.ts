import { getEncyclopediaEntry, type EncyclopediaEntry } from '@/lib/encyclopedia';

export type ErrorHelpInput = {
  message?: string | null;
  status?: number | null;
};

export type ErrorHelpLink = {
  slug: string;
  title: string;
};

const CLOUDFLARE_OTHER_STATUSES = new Set([520, 521, 522, 523, 525, 526, 530]);
const SERVER_ERROR_STATUSES = new Set([500, 502, 503, 504]);

const NETWORK_MESSAGE_HINTS = [
  'failed to fetch',
  'networkerror',
  'load failed',
  '网络',
  '连接失败',
  '连接中断',
] as const;

const RATE_LIMIT_MESSAGE_HINTS = [
  '429',
  'too many requests',
  '请求过于频繁',
  '操作过于频繁',
  '冷却',
  'rate limit',
] as const;

const DATA_CARD_MESSAGE_HINTS = [
  '数据卡',
  'json 解析',
  'json解析',
  '格式验证',
  '校验失败',
  'templateid',
  '签名',
] as const;

const AI_MESSAGE_HINTS = [
  'api key',
  'apikey',
  '模型',
  '供应商',
  'token',
  'context',
  'quota',
  '额度',
  'insufficient',
  'openai',
  'anthropic',
  'gemini',
  '生成失败',
  '魔法失效',
] as const;

function normalizeMessage(message: string) {
  return message
    .trim()
    .replace(/^(✨|⚠️|❌|🚫|🌐)+\s*/g, '')
    .toLowerCase();
}

function extractHttpStatusFromMessage(message: string) {
  const normalized = message.trim();
  const match =
    normalized.match(/\bhttp\s*[: ]\s*(\d{3})\b/i)
    ?? normalized.match(/\bhttp\s+(\d{3})\b/i)
    ?? normalized.match(/\bstatus\s*[: ]\s*(\d{3})\b/i);
  if (!match) return null;
  const status = Number(match[1]);
  return Number.isFinite(status) ? status : null;
}

function inferSlugFromStatus(status: number): string | null {
  if (status === 524) return 'cloudflare-524-timeout';
  if (status === 429) return 'rate-limit-429';
  if (CLOUDFLARE_OTHER_STATUSES.has(status) || SERVER_ERROR_STATUSES.has(status)) return 'cloudflare-errors';
  return null;
}

function includesAny(message: string, hints: readonly string[]) {
  return hints.some((hint) => message.includes(hint));
}

export function inferEncyclopediaSlugForError(input: ErrorHelpInput): string | null {
  const status = input.status ?? null;
  const statusSlug = typeof status === 'number' ? inferSlugFromStatus(status) : null;
  if (statusSlug) return statusSlug;

  const rawMessage = typeof input.message === 'string' ? input.message : '';
  if (!rawMessage.trim()) return null;

  const statusFromMessage = extractHttpStatusFromMessage(rawMessage);
  if (typeof statusFromMessage === 'number') {
    const inferred = inferSlugFromStatus(statusFromMessage);
    if (inferred) return inferred;
  }

  const message = normalizeMessage(rawMessage);

  if (message.includes('cloudflare') && message.includes('524')) return 'cloudflare-524-timeout';
  if (message.includes('524') && message.includes('timeout')) return 'cloudflare-524-timeout';
  if (message.includes('524') && message.includes('超时')) return 'cloudflare-524-timeout';

  if (includesAny(message, RATE_LIMIT_MESSAGE_HINTS)) return 'rate-limit-429';
  if (includesAny(message, NETWORK_MESSAGE_HINTS)) return 'network-errors';

  if (message.includes('cloudflare') || message.includes('cf-ray') || message.includes('52x')) {
    return 'cloudflare-errors';
  }
  if (message.includes('5xx') || message.includes('服务器内部错误')) return 'cloudflare-errors';

  if (includesAny(message, DATA_CARD_MESSAGE_HINTS)) return 'data-card-errors';
  if (includesAny(message, AI_MESSAGE_HINTS)) return 'ai-errors';

  return null;
}

export function getEncyclopediaHelpForError(input: ErrorHelpInput): ErrorHelpLink | null {
  const slug = inferEncyclopediaSlugForError(input);
  const entry: EncyclopediaEntry | null = getEncyclopediaEntry(slug ?? undefined);
  if (!slug || !entry) return null;
  return { slug: entry.slug, title: entry.title };
}
