type UnknownRecord = Record<string, unknown>;

const toRecord = (value: unknown): UnknownRecord | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as UnknownRecord;
};

const trimString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const collectRecordCandidates = (payload: UnknownRecord): UnknownRecord[] => {
  const records: UnknownRecord[] = [];
  const queue: Array<{ value: unknown; depth: number }> = [{ value: payload, depth: 0 }];
  const visited = new Set<UnknownRecord>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    const record = toRecord(current.value);
    if (!record || visited.has(record)) continue;

    visited.add(record);
    records.push(record);

    if (current.depth >= 2) continue;

    for (const value of Object.values(record)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item && typeof item === 'object') {
            queue.push({ value: item, depth: current.depth + 1 });
          }
        }
        continue;
      }
      if (value && typeof value === 'object') {
        queue.push({ value, depth: current.depth + 1 });
      }
    }
  }

  return records;
};

const extractNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return Math.trunc(parsed);
};

const findFirstString = (records: UnknownRecord[], keys: readonly string[]): string | null => {
  for (const record of records) {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === 'string') {
        const normalized = value.trim();
        if (normalized) return normalized;
      }
    }
  }
  return null;
};

const findFirstNumber = (records: UnknownRecord[], keys: readonly string[]): number | null => {
  for (const record of records) {
    for (const key of keys) {
      const numberValue = extractNumber(record[key]);
      if (numberValue !== null) return numberValue;
    }
  }
  return null;
};

const MESSAGE_KEYS = [
  'msg',
  'message',
  'error',
  'detail',
  'errorMessage',
  'reason',
  'description',
  'Msg',
  'Message',
  'Error',
  'Detail',
] as const;

const CODE_KEYS = ['code', 'Code', 'status', 'statusCode', 'errorCode', 'error_code'] as const;

const REQUEST_ID_KEYS = [
  'request_id',
  'requestId',
  'trace_id',
  'traceId',
  'reqId',
  'reqID',
] as const;

const getDefaultLibLibError = (status: number): string => {
  if (status === 401) return 'LibLib 鉴权失败：Access Key / Secret Key 不匹配，或签名已失效（HTTP 401）';
  if (status === 403) return 'LibLib 权限不足：当前凭据无权访问该接口（HTTP 403）';
  if (status === 429) return 'LibLib 请求过于频繁，请稍后再试（HTTP 429）';
  return `LibLib API error（HTTP ${status}）`;
};

export const parseLibLibJsonSafe = (raw: string): UnknownRecord => {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return toRecord(parsed) ?? {};
  } catch {
    return {};
  }
};

export const extractLibLibMessage = (payload: UnknownRecord): string | null => {
  const records = collectRecordCandidates(payload);
  return findFirstString(records, MESSAGE_KEYS);
};

export const extractLibLibCode = (payload: UnknownRecord): number | null => {
  const records = collectRecordCandidates(payload);
  return findFirstNumber(records, CODE_KEYS);
};

export const inferLibLibHttpStatus = (upstreamCode: number | null, fallbackStatus: number): number => {
  if (upstreamCode === null) return fallbackStatus;
  if (upstreamCode >= 400 && upstreamCode <= 599) return upstreamCode;
  return fallbackStatus;
};

export const buildLibLibErrorPayload = (params: {
  status: number;
  payload: UnknownRecord;
  fallbackError?: string;
  requestIdHeader?: string | null;
}): UnknownRecord => {
  const status = Number.isFinite(params.status) ? Math.trunc(params.status) : 500;
  const upstreamMessage = extractLibLibMessage(params.payload);
  const upstreamCode = extractLibLibCode(params.payload);
  const requestIdFromPayload = findFirstString(collectRecordCandidates(params.payload), REQUEST_ID_KEYS);
  const requestId = requestIdFromPayload || trimString(params.requestIdHeader);
  const fallbackError = trimString(params.fallbackError);
  const error = fallbackError || getDefaultLibLibError(status);

  const detailsParts: string[] = [];
  if (upstreamCode !== null) detailsParts.push(`code: ${upstreamCode}`);
  if (requestId) detailsParts.push(`request id: ${requestId}`);
  const details = detailsParts.join(' | ');

  return {
    error,
    ...(upstreamMessage ? { message: upstreamMessage } : {}),
    ...(details ? { details } : {}),
    provider: 'liblib',
    status,
    ...(upstreamCode !== null ? { upstreamCode } : {}),
    ...(requestId ? { requestId } : {}),
  };
};
