import { getEncyclopediaEntry, type EncyclopediaEntry } from '@/lib/encyclopedia';

export type ErrorHelpInput = {
  message?: string | null;
  status?: number | null;
};

export type ErrorHelpLink = {
  slug: string;
  title: string;
};

export type ErrorCategoryId =
  | 'validation'
  | 'auth'
  | 'forbidden'
  | 'network'
  | 'rate_limit'
  | 'timeout'
  | 'cloudflare'
  | 'ai_api_call'
  | 'ai_refusal'
  | 'ai_empty_output'
  | 'ai_output_format'
  | 'data_card'
  | 'ai';

export type ErrorCategory = {
  id: ErrorCategoryId;
  label: string;
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

const AI_API_CALL_ERROR_MESSAGE_HINTS = [
  'ai_apicallerror',
  'ai_apicaiierror',
  'apicallerror',
] as const;

const AI_REFUSAL_MESSAGE_HINTS = [
  'as a language model',
  'as an ai language model',
  'i can’t help',
  "i can't help",
  'i cannot help',
  "i can't assist",
  'i cannot assist',
  'cannot help with that',
  'cannot comply',
  "can't comply",
  '身为一个语言模型',
  '作为一个语言模型',
  '作为一个ai语言模型',
  '我没法提供这方面的帮助',
  '我无法提供这方面的帮助',
  '你的要求我无法实现',
  '内容不符合我的安全策略',
  '不符合我的安全策略',
  '违反我的安全策略',
] as const;

const AI_OUTPUT_FORMAT_MESSAGE_HINTS = [
  '格式验证失败',
  '格式校验失败',
  'json 解析失败',
  'json解析失败',
  'unexpected token',
  'invalid json',
] as const;

const AI_OUTPUT_FORMAT_CONTEXT_HINTS = ['魔法少女', '残兽', '情景', '叙事历史', '通用角色'] as const;

const AI_EMPTY_OUTPUT_MESSAGE_HINTS = [
  '服务端响应为空',
  '响应为空',
  '未收到有效内容',
  '未收到有效正文',
  '未返回可展示的战报正文',
  '只返回了思考过程',
  '未发送 text-delta',
  '返回空对象',
  '空对象',
  'empty response',
  'empty object',
] as const;

const MODELSCOPE_MESSAGE_HINTS = [
  'modelscope',
  'api-inference.modelscope.cn',
] as const;

const MODELSCOPE_AUTH_MESSAGE_HINTS = [
  'authentication failed',
  'unauthorized',
  'bind your alibaba cloud account',
  'alibaba cloud account',
  'please bind your alibaba cloud account before use',
  'real name verified',
  'real-name verified',
  'aliyun account',
  'associated aliyun account',
  '实名认证',
  '实名',
  '未绑定阿里云',
  '阿里云账号',
  '绑定阿里云',
  'token 无效',
  'token invalid',
  'invalid token',
  'access token',
  '鉴权失败',
  '授权失败',
  'api token',
] as const;

const LIBLIB_MESSAGE_HINTS = [
  'liblib',
  'liblibai',
  'openapi.liblibai.cloud',
] as const;

const LIBLIB_AUTH_MESSAGE_HINTS = [
  '签名验证失败',
  'invalid signature',
  'signature invalid',
  'signature',
  'access key',
  'secret key',
  'accesskey',
  'secretkey',
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

function isModelScopeAuthError(message: string, status: number | null) {
  if (!includesAny(message, MODELSCOPE_MESSAGE_HINTS)) return false;
  if (status === 401) return true;
  return includesAny(message, MODELSCOPE_AUTH_MESSAGE_HINTS);
}

function isLibLibAuthError(message: string, status: number | null) {
  const hasLibLibHint = includesAny(message, LIBLIB_MESSAGE_HINTS);
  const hasAuthHint = includesAny(message, LIBLIB_AUTH_MESSAGE_HINTS);
  if (message.includes('签名验证失败')) return true;
  if (!hasLibLibHint) return false;
  if (status === 401) return true;
  return hasAuthHint;
}

export function inferErrorCategoryForError(input: ErrorHelpInput): ErrorCategory | null {
  const rawMessage = typeof input.message === 'string' ? input.message : '';
  const message = rawMessage.trim() ? normalizeMessage(rawMessage) : '';
  const statusInput = typeof input.status === 'number' ? input.status : null;
  const statusFromMessage = rawMessage.trim() ? extractHttpStatusFromMessage(rawMessage) : null;
  const status = statusInput ?? statusFromMessage;
  const isAiApiCallError = message ? includesAny(message, AI_API_CALL_ERROR_MESSAGE_HINTS) : false;

  if (status === 400) return { id: 'validation', label: '请求参数无效 / 校验失败' };
  if (status === 401) return { id: 'auth', label: '鉴权失败 / API Key 问题' };
  if (status === 403) return { id: 'forbidden', label: '权限不足 / Key 不可用' };
  if (status === 524) return { id: 'timeout', label: 'Cloudflare 超时' };
  if (status === 429) return { id: 'rate_limit', label: '请求过于频繁 / 限流' };

  if (
    typeof status === 'number'
    && (CLOUDFLARE_OTHER_STATUSES.has(status) || SERVER_ERROR_STATUSES.has(status))
  ) {
    if (isAiApiCallError) return { id: 'ai_api_call', label: '上游 AI 接口调用失败' };
    return { id: 'cloudflare', label: 'Cloudflare/服务器错误' };
  }

  if (!message) return null;

  if (isModelScopeAuthError(message, status)) return { id: 'auth', label: '鉴权失败 / API Key 问题' };
  if (isLibLibAuthError(message, status)) return { id: 'auth', label: '鉴权失败 / API Key 问题' };
  if (includesAny(message, NETWORK_MESSAGE_HINTS)) return { id: 'network', label: '网络连接问题' };
  if (includesAny(message, RATE_LIMIT_MESSAGE_HINTS)) return { id: 'rate_limit', label: '请求过于频繁 / 限流' };
  if (message.includes('cloudflare') || message.includes('cf-ray') || message.includes('52x') || message.includes('5xx')) {
    return isAiApiCallError ? { id: 'ai_api_call', label: '上游 AI 接口调用失败' } : { id: 'cloudflare', label: 'Cloudflare/服务器错误' };
  }

  if (isAiApiCallError) return { id: 'ai_api_call', label: '上游 AI 接口调用失败' };
  if (includesAny(message, AI_EMPTY_OUTPUT_MESSAGE_HINTS)) return { id: 'ai_empty_output', label: 'AI 空输出 / 空对象' };
  if (message.includes('服务端返回信息') && (message.includes('{}') || message.includes('[]'))) {
    return { id: 'ai_empty_output', label: 'AI 空输出 / 空对象' };
  }
  if (includesAny(message, AI_REFUSAL_MESSAGE_HINTS)) return { id: 'ai_refusal', label: 'AI 拒答 / 安全策略' };
  if (includesAny(message, AI_OUTPUT_FORMAT_MESSAGE_HINTS) && includesAny(message, AI_OUTPUT_FORMAT_CONTEXT_HINTS)) {
    return { id: 'ai_output_format', label: 'AI 输出格式异常' };
  }
  if (includesAny(message, DATA_CARD_MESSAGE_HINTS)) return { id: 'data_card', label: '数据卡/导入解析问题' };
  if (includesAny(message, AI_MESSAGE_HINTS)) return { id: 'ai', label: 'AI 生成失败' };

  return null;
}

export function inferEncyclopediaSlugForError(input: ErrorHelpInput): string | null {
  const rawMessage = typeof input.message === 'string' ? input.message : '';
  const message = rawMessage.trim() ? normalizeMessage(rawMessage) : '';
  const isAiApiCallError = message ? includesAny(message, AI_API_CALL_ERROR_MESSAGE_HINTS) : false;
  const statusInput = typeof input.status === 'number' ? input.status : null;
  const statusFromMessage = rawMessage.trim() ? extractHttpStatusFromMessage(rawMessage) : null;
  const status = statusInput ?? statusFromMessage;
  if (message && isModelScopeAuthError(message, status)) return 'tachie-auth-errors';
  if (message && isLibLibAuthError(message, status)) return 'tachie-auth-errors';

  if (status === 524) return 'cloudflare-524-timeout';
  if (status === 429) return 'rate-limit-429';
  if (
    isAiApiCallError
    && typeof status === 'number'
    && (CLOUDFLARE_OTHER_STATUSES.has(status) || SERVER_ERROR_STATUSES.has(status))
  ) {
    return 'ai-api-call-error';
  }

  const statusSlug = typeof status === 'number' ? inferSlugFromStatus(status) : null;
  if (statusSlug) return statusSlug;

  if (!rawMessage.trim()) return null;

  if (message.includes('cloudflare') && message.includes('524')) return 'cloudflare-524-timeout';
  if (message.includes('524') && message.includes('timeout')) return 'cloudflare-524-timeout';
  if (message.includes('524') && message.includes('超时')) return 'cloudflare-524-timeout';

  if (isAiApiCallError) return 'ai-api-call-error';
  if (includesAny(message, AI_EMPTY_OUTPUT_MESSAGE_HINTS)) return 'ai-empty-output';
  if (message.includes('服务端返回信息') && (message.includes('{}') || message.includes('[]'))) return 'ai-empty-output';
  if (includesAny(message, AI_REFUSAL_MESSAGE_HINTS)) return 'ai-refusal';
  if (includesAny(message, RATE_LIMIT_MESSAGE_HINTS)) return 'rate-limit-429';
  if (includesAny(message, NETWORK_MESSAGE_HINTS)) return 'network-errors';

  if (message.includes('cloudflare') || message.includes('cf-ray') || message.includes('52x')) {
    return 'cloudflare-errors';
  }
  if (message.includes('5xx') || message.includes('服务器内部错误')) return 'cloudflare-errors';

  if (includesAny(message, AI_OUTPUT_FORMAT_MESSAGE_HINTS) && includesAny(message, AI_OUTPUT_FORMAT_CONTEXT_HINTS)) {
    return 'ai-output-format';
  }
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
