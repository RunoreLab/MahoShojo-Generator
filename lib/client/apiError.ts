const safeString = (value: unknown): string => (typeof value === 'string' ? value : '');

const normalizeText = (value: string): string => value.trim().replace(/\s+/g, ' ');

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
    const text = normalizeText(payload);
    return text || fallback;
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
    else if (errorText === '生成失败' || errorText === '请求失败') main = messageText;
    else main = `${errorText}：${messageText}`;
  } else {
    main = messageText || errorText || fallback;
  }

  if (!detailsText) return main;
  if (main.includes(detailsText)) return main;
  return `${main}\n详情：${detailsText}`;
};
