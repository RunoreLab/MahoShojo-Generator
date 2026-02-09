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
    const next = queue.shift();
    if (!next) continue;
    const record = toRecord(next.value);
    if (!record || visited.has(record)) continue;

    visited.add(record);
    records.push(record);

    if (next.depth >= 2) continue;

    for (const value of Object.values(record)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item && typeof item === 'object') {
            queue.push({ value: item, depth: next.depth + 1 });
          }
        }
        continue;
      }
      if (value && typeof value === 'object') {
        queue.push({ value, depth: next.depth + 1 });
      }
    }
  }

  return records;
};

const findStringByKeys = (records: UnknownRecord[], keys: readonly string[]): string | null => {
  for (const record of records) {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === 'string') {
        const normalized = value.trim();
        if (normalized) return normalized;
      }
      if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === 'string') {
            const normalized = item.trim();
            if (normalized) return normalized;
          }
        }
      }
    }
  }
  return null;
};

const findCodeByKeys = (records: UnknownRecord[], keys: readonly string[]): string | null => {
  for (const record of records) {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === 'string') {
        const normalized = value.trim();
        if (normalized) return normalized;
      }
      if (typeof value === 'number' && Number.isFinite(value)) {
        return String(Math.trunc(value));
      }
    }
  }
  return null;
};

const MESSAGE_KEYS = [
  'message',
  'msg',
  'detail',
  'error',
  'errorMessage',
  'reason',
  'description',
  'Message',
  'Msg',
  'Detail',
  'Error',
  'Reason',
  'Description',
] as const;

const CODE_KEYS = [
  'code',
  'Code',
  'error_code',
  'errorCode',
  'status_code',
  'statusCode',
] as const;

const REQUEST_ID_KEYS = [
  'request_id',
  'requestId',
  'RequestId',
  'trace_id',
  'traceId',
  'TraceId',
] as const;

const TASK_ID_KEYS = ['task_id', 'taskId', 'generateUuid', 'id'] as const;

const TASK_STATUS_KEYS = ['task_status', 'taskStatus', 'status'] as const;

const OUTPUT_IMAGES_KEYS = ['output_images', 'outputImages', 'images', 'output_image', 'outputImage'] as const;

export const parseModelScopeJsonSafe = (raw: string): UnknownRecord => {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return toRecord(parsed) ?? {};
  } catch {
    return {};
  }
};

export const normalizeModelScopeToken = (tokenRaw: unknown): string => {
  const normalized = trimString(tokenRaw);
  if (!normalized) return '';
  return normalized.replace(/^bearer\s+/i, '').trim();
};

export const extractModelScopeMessage = (payload: UnknownRecord): string | null => {
  const records = collectRecordCandidates(payload);
  return findStringByKeys(records, MESSAGE_KEYS);
};

export const extractModelScopeCode = (payload: UnknownRecord): string | null => {
  const records = collectRecordCandidates(payload);
  return findCodeByKeys(records, CODE_KEYS);
};

export const extractModelScopeRequestId = (payload: UnknownRecord): string | null => {
  const records = collectRecordCandidates(payload);
  return findStringByKeys(records, REQUEST_ID_KEYS);
};

export const extractModelScopeTaskId = (payload: UnknownRecord): string | null => {
  const records = collectRecordCandidates(payload);
  return findStringByKeys(records, TASK_ID_KEYS);
};

export const extractModelScopeTaskStatus = (payload: UnknownRecord): string | null => {
  const records = collectRecordCandidates(payload);
  const value = findStringByKeys(records, TASK_STATUS_KEYS);
  return value ? value.toUpperCase() : null;
};

export const extractModelScopeOutputImages = (payload: UnknownRecord): string[] => {
  const records = collectRecordCandidates(payload);
  const images: string[] = [];

  for (const record of records) {
    for (const key of OUTPUT_IMAGES_KEYS) {
      const value = record[key];
      if (typeof value === 'string') {
        const normalized = value.trim();
        if (normalized) images.push(normalized);
        continue;
      }

      if (!Array.isArray(value)) continue;
      for (const item of value) {
        if (typeof item === 'string') {
          const normalized = item.trim();
          if (normalized) images.push(normalized);
        }
      }
    }
  }

  return Array.from(new Set(images));
};

const getDefaultModelScopeError = (status: number): string => {
  if (status === 401) return 'ModelScope 鉴权失败：Token 无效、已过期，或格式不正确（HTTP 401）';
  if (status === 403) return 'ModelScope 权限不足：当前 Token 无权访问该能力（HTTP 403）';
  if (status === 429) return 'ModelScope 请求过于频繁，请稍后再试（HTTP 429）';
  return `ModelScope API error（HTTP ${status}）`;
};

export const buildModelScopeErrorPayload = (params: {
  status: number;
  payload: UnknownRecord;
  fallbackError?: string;
  requestIdHeader?: string | null;
}): UnknownRecord => {
  const status = Number.isFinite(params.status) ? Math.trunc(params.status) : 500;
  const upstreamMessage = extractModelScopeMessage(params.payload);
  const upstreamCode = extractModelScopeCode(params.payload);
  const requestId = extractModelScopeRequestId(params.payload) || trimString(params.requestIdHeader);
  const fallbackError = trimString(params.fallbackError);
  const error = fallbackError || getDefaultModelScopeError(status);

  const detailsParts: string[] = [];
  if (upstreamCode) detailsParts.push(`code: ${upstreamCode}`);
  if (requestId) detailsParts.push(`request id: ${requestId}`);
  const details = detailsParts.join(' | ');

  return {
    error,
    ...(upstreamMessage ? { message: upstreamMessage } : {}),
    ...(details ? { details } : {}),
    provider: 'modelscope',
    status,
    ...(upstreamCode ? { upstreamCode } : {}),
    ...(requestId ? { requestId } : {}),
  };
};
