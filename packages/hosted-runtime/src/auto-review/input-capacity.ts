import type { AutoReviewProviderEntry } from './config';

/** 请求无法覆盖完整输入时，用于让引擎尝试下一个后端。 */
export class AutoReviewInputCapacityError extends Error {
  constructor() {
    super('auto-review input exceeds backend capacity');
    this.name = 'AutoReviewInputCapacityError';
  }
}

/**
 * Workers AI Clef 可能在不返回错误的情况下截断 state。OpenRouter 当前注明该
 * 路由可能只读取约 2K tokens：
 * https://openrouter.ai/for-ai
 * Clef 使用 byte-level BPE。对原文及 NFC 形式的 UTF-8 字节数留出余量，只在
 * 远低于该已报告上限时调用；较长输入交给其他后端，不裁剪卡片。该阈值不是 token 计数。
 */
const CLEF_SAFE_STATE_BYTES = 1536;
// 未确认上游是否静默截断时，只保留旧实现原本覆盖的输入范围；不截取原文。
// 超出时改尝试已验证的长上下文后端，没有合适后端则交给人工。
const UNVERIFIED_STATE_MAX_UNITS = 12_000;

const isOpenRouterDeciderV13 = (entry: AutoReviewProviderEntry): boolean => {
  if (entry.kind !== 'jev-decisions') return false;
  try {
    const endpoint = new URL(entry.endpoint);
    return endpoint.origin === 'https://openrouter.ai'
      && endpoint.pathname === '/api/alpha/decisions'
      && !endpoint.search
      && !endpoint.username
      && !endpoint.password
      && (entry.model === 'perplexity/pplx-decider-v1.3:free'
        || entry.model === 'perplexity/pplx-decider-flash-v1.3:free');
  } catch {
    return false;
  }
};

const isWorkersAiClef = (entry: AutoReviewProviderEntry): boolean => {
  if (entry.kind !== 'jev-decisions') return false;
  if (entry.endpoint === 'workers-ai') return entry.model === 'clef' || entry.model === 'clef-flash';
  try {
    const endpoint = new URL(entry.endpoint);
    const host = endpoint.hostname.toLowerCase();
    return (host === 'api.cloudflare.com' && /\/ai\/run\/@cf\/cloudflare\/clef(?:-flash)?\/?$/i.test(endpoint.pathname))
      || (host === 'openrouter.ai' && /^cloudflare\/clef(?:-flash)?(?::free)?$/.test(entry.model));
  } catch {
    return false;
  }
};

export const ensureKnownInputCapacity = (entry: AutoReviewProviderEntry, state: string): void => {
  if (isWorkersAiClef(entry)) {
    const encoder = new TextEncoder();
    const bytes = Math.max(encoder.encode(state).byteLength, encoder.encode(state.normalize('NFC')).byteLength);
    if (bytes > CLEF_SAFE_STATE_BYTES) throw new AutoReviewInputCapacityError();
    return;
  }
  // Perplexity 的参考实现明确拒绝超长输入而不截断；OpenRouter 路由也用合成
  // 长尾和超上下文请求验证过。仍需识别上游长度错误，不能把错误当成通过。
  // https://huggingface.co/perplexity-ai/pplx-decider-v1.3/blob/main/README.md
  if (isOpenRouterDeciderV13(entry)) return;
  if (state.length > UNVERIFIED_STATE_MAX_UNITS) throw new AutoReviewInputCapacityError();
};

/** 尽量识别上游明确报告的长度错误，不把上游错误正文复制进诊断。 */
export const isInputCapacityErrorResponse = (status: number, body: unknown): boolean => {
  if (status === 413) return true;
  if (status !== 200 && status !== 400 && status !== 422) return false;
  if (!body || typeof body !== 'object') return false;
  const record = body as Record<string, unknown>;
  const result = record.result && typeof record.result === 'object'
    ? record.result as Record<string, unknown> : {};
  const matches = (value: unknown, depth: number): boolean => {
    if (typeof value === 'string') {
      return /context[_\s-]*(?:length|window|exceed)|(?:input|prompt|state)[_\s-]*(?:too[_\s-]*long|length)|too many tokens/i.test(value);
    }
    if (!value || typeof value !== 'object' || depth === 0) return false;
    const nested = value as Record<string, unknown>;
    return ['code', 'message', 'type', 'error_type', 'metadata', 'error']
      .some((key) => matches(nested[key], depth - 1));
  };
  return matches(record.error, 3) || matches(result.error, 3);
};

export const upstreamReportsTruncation = (body: unknown): boolean => {
  if (!body || typeof body !== 'object') return false;
  const record = body as Record<string, unknown>;
  const result = record.result && typeof record.result === 'object' ? record.result as Record<string, unknown> : {};
  const usage = record.usage && typeof record.usage === 'object' ? record.usage as Record<string, unknown> : {};
  return record.truncated === true || record.input_truncated === true
    || result.truncated === true || result.input_truncated === true || usage.input_truncated === true;
};
