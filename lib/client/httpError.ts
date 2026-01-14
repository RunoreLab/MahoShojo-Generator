const safeString = (value: unknown): string => (typeof value === 'string' ? value : '');

export const hasHttpStatusInMessage = (message: string): boolean => /\bHTTP\s*\d{3}\b/i.test(message);

export const formatHttpErrorMessage = (params: {
  serverMessage: unknown;
  status: number;
  fallback: string;
}): string => {
  const status = Number.isFinite(params.status) ? Math.trunc(params.status) : 0;
  const fallback = safeString(params.fallback).trim() || '请求失败';
  const serverMessage = safeString(params.serverMessage).trim();

  if (serverMessage) {
    return hasHttpStatusInMessage(serverMessage) ? serverMessage : `${serverMessage}（HTTP ${status}）`;
  }

  return `${fallback}（HTTP ${status}）`;
};

