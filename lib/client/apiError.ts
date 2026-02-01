const safeString = (value: unknown): string => (typeof value === 'string' ? value : '');

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
