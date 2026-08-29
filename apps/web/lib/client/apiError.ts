const safeString = (value: unknown): string => (typeof value === 'string' ? value : '');

export const INFRASTRUCTURE_ERROR_MESSAGES = {
  RATE_LIMIT_UNAVAILABLE: '限速服务暂时不可用，请稍后重试。',
  HOSTED_DR_CAPABILITY_UNAVAILABLE: '备用生成服务暂时不可用，请稍后重试。',
  OPERATION_NOT_DECLARED: '此操作当前没有可用的 Hosted 路由，请稍后再试。',
  DR_NOT_ELIGIBLE: '主服务当前不可用，且此操作不能安全切换到灾备服务。',
  NO_READY_PLACEMENT: '主服务与灾备服务当前均不可用，请稍后再试。',
  AMBIGUOUS_OPERATION_OUTCOME: '请求可能已经开始处理，请勿立即重复提交；可稍后查询结果或重新连接。',
  GENERATION_INTENT_ALREADY_DISPATCHED: '同一个生成意图只能提交一次。',
  ARENA_GENERATION_CAPABILITY_UNAVAILABLE: '战报生成服务暂时不可用，请稍后重试。',
  GENERATION_RESERVATION_UNAVAILABLE: '暂时无法确认战报生成状态，请稍后重试；请勿重复提交同一场生成。',
  GENERATION_STATE_UNAVAILABLE: '暂时无法确认战报生成状态，请稍后重试；请勿重复提交同一场生成。',
  GENERATION_TERMINAL_LOOKUP_UNAVAILABLE: '暂时无法确认战报生成状态，请稍后重试；请勿重复提交同一场生成。',
  GENERATION_PREPARATION_UNAVAILABLE: '暂时无法确认战报生成状态，请稍后重试；请勿重复提交同一场生成。',
  GENERATION_OWNERSHIP_UNAVAILABLE: '暂时无法确认战报生成状态，请稍后重试；请勿重复提交同一场生成。',
  GENERATION_FINALIZATION_PENDING: '战报正在完成最终保存，请稍后查看；请勿重复生成。',
  GENERATION_FINALIZATION_IN_PROGRESS: '战报正在完成最终保存，请稍后查看；请勿重复生成。',
  GENERATION_TERMINAL_RECONCILIATION_PENDING: '战报正在恢复最终状态，请稍后查看；请勿重复生成。',
  GENERATION_TERMINAL_CONTENT_UNAVAILABLE: '战报已结束，但正文暂时不可读取，请稍后查看。',
  PRODUCER_OWNERSHIP_UNAVAILABLE: '生成进程已丢失，无法安全自动重试。',
  PRODUCER_OWNERSHIP_LOST: '生成进程已丢失，无法安全自动重试。',
  PRODUCER_LEASE_EXPIRED: '生成进程已丢失，无法安全自动重试。',
  HOSTED_GENERATION_FAILED: '生成服务暂时不可用，请稍后重试。',
  INTERNAL_SERVER_ERROR: '服务器内部错误，请稍后重试。',
} as const;

const resolveInfrastructureErrorMessage = (code: unknown): string => {
  if (typeof code !== 'string') return '';
  return Object.prototype.hasOwnProperty.call(INFRASTRUCTURE_ERROR_MESSAGES, code)
    ? INFRASTRUCTURE_ERROR_MESSAGES[code as keyof typeof INFRASTRUCTURE_ERROR_MESSAGES]
    : '';
};

const normalizeText = (value: string): string => value.trim().replace(/\s+/g, ' ');

const looksLikeHtml = (value: string): boolean => {
  const trimmed = value.trimStart().toLowerCase();
  if (!trimmed.startsWith('<')) return false;
  if (trimmed.startsWith('<!doctype')) return true;
  if (trimmed.startsWith('<html')) return true;
  if (trimmed.startsWith('<head')) return true;
  return trimmed.includes('<html') || trimmed.includes('<body');
};

const MAX_TEXT_PREVIEW_CHARS = 600;

const buildTextPreview = (rawText: string): string => {
  const normalized = normalizeText(rawText);
  if (!normalized) return '';
  return normalized.length > MAX_TEXT_PREVIEW_CHARS ? `${normalized.slice(0, MAX_TEXT_PREVIEW_CHARS)}…` : normalized;
};

const isGenericTopLevelError = (errorText: string): boolean => {
  const text = normalizeText(errorText);
  if (!text) return false;
  if (text === '生成失败' || text === '请求失败') return true;
  return text.startsWith('生成失败') || text.startsWith('请求失败');
};

const extractNestedErrorText = (value: unknown): string => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  return safeString(record.message) || safeString(record.error) || '';
};

export const resolveApiErrorMessage = (params: { payload: unknown; fallback: string }): string => {
  const fallback = normalizeText(safeString(params.fallback)) || '请求失败';
  const payload = params.payload;
  if (!payload) return fallback;

  if (typeof payload === 'string') {
    if (looksLikeHtml(payload)) {
      return '服务器返回了 HTML 错误页，请稍后重试或刷新页面。';
    }
    const preview = buildTextPreview(payload);
    return preview || fallback;
  }

  if (typeof payload !== 'object') return fallback;

  const record = payload as Record<string, unknown>;
  const infrastructureMessage = resolveInfrastructureErrorMessage(record.code);
  if (infrastructureMessage) return infrastructureMessage;
  const errorText = normalizeText(extractNestedErrorText(record.error));
  const messageText = normalizeText(safeString(record.message));
  const detailsText = normalizeText(safeString(record.details));

  let main = '';
  if (messageText && errorText) {
    if (messageText === errorText) main = messageText;
    else if (messageText.includes(errorText)) main = messageText;
    else if (isGenericTopLevelError(errorText)) main = messageText;
    else main = `${errorText}：${messageText}`;
  } else {
    main = messageText || errorText || fallback;
  }

  if (!detailsText) return main;
  if (main.includes(detailsText)) return main;
  return `${main}\n详情：${detailsText}`;
};

export const readJsonOrTextFromResponse = async (response: Response): Promise<{ payload: unknown; rawText: string }> => {
  const rawText = await response.text().catch(() => '');
  if (!rawText) return { payload: null, rawText: '' };

  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  const trimmed = rawText.trimStart();
  const shouldTryJson =
    contentType.includes('application/json')
    || contentType.includes('+json')
    || trimmed.startsWith('{')
    || trimmed.startsWith('[');

  if (shouldTryJson) {
    try {
      return { payload: JSON.parse(rawText) as unknown, rawText };
    } catch {
      return { payload: rawText, rawText };
    }
  }

  return { payload: rawText, rawText };
};
