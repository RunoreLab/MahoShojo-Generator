export type ParsedGenerationSseBlock = {
  id: string | null;
  event: string;
  data: string;
};

export type EncodableGenerationSseEvent = {
  id: string;
  type: string;
  data: unknown;
};

const encoder = new TextEncoder();

const compareDecimal = (left: string, right: string): number => {
  const normalizedLeft = left.replace(/^0+(?=\d)/u, '');
  const normalizedRight = right.replace(/^0+(?=\d)/u, '');
  if (normalizedLeft.length !== normalizedRight.length) {
    return normalizedLeft.length < normalizedRight.length ? -1 : 1;
  }
  return normalizedLeft < normalizedRight ? -1 : normalizedLeft > normalizedRight ? 1 : 0;
};

export const compareGenerationSseIds = (left: string, right: string): number => {
  const leftMatch = left.match(/^(\d+)-(\d+)$/u);
  const rightMatch = right.match(/^(\d+)-(\d+)$/u);
  if (!leftMatch || !rightMatch) throw new Error('GENERATION_SSE_ID_INVALID');
  const milliseconds = compareDecimal(leftMatch[1]!, rightMatch[1]!);
  return milliseconds !== 0 ? milliseconds : compareDecimal(leftMatch[2]!, rightMatch[2]!);
};

export const encodeGenerationSseEvent = (
  event: EncodableGenerationSseEvent,
): Uint8Array => {
  const data = JSON.stringify(event.data ?? null);
  return encoder.encode(`id: ${event.id}\nevent: ${event.type}\ndata: ${data}\n\n`);
};

export const parseGenerationSseBlock = (
  block: string,
): ParsedGenerationSseBlock | null => {
  let id: string | null = null;
  let event = 'message';
  const dataLines: string[] = [];

  for (const rawLine of block.replace(/\r\n?/gu, '\n').split('\n')) {
    if (!rawLine || rawLine.startsWith(':')) continue;
    if (rawLine.startsWith('id:')) {
      id = rawLine.slice('id:'.length).trim() || null;
      continue;
    }
    if (rawLine.startsWith('event:')) {
      event = rawLine.slice('event:'.length).trim() || 'message';
      continue;
    }
    if (rawLine.startsWith('data:')) {
      dataLines.push(rawLine.slice('data:'.length).trimStart());
    }
  }

  if (dataLines.length === 0) return null;
  return { id, event, data: dataLines.join('\n') };
};

/**
 * Arena 内部 telemetry（由 Provider bridge 产生）使用内部字段名 `model`，
 * 而 Web 客户端-facing telemetry 契约（StreamTelemetryMetaSchema）使用 `aiModel`。
 * 本函数在 SSE 输出边界把内部形态投影为客户端形态，并剥离
 * providerName/providerType/providerIndex/attempt/reasoning 等内部字段。
 * 若数据不含模型字段则原样返回，避免重构错误诊断等非 telemetry 事件数据。
 */
export const projectArenaTelemetryForClient = (data: unknown): unknown => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  const record = data as Record<string, unknown>;
  const internalModel = typeof record.model === 'string' ? record.model.trim() : '';
  const explicitAiModel = typeof record.aiModel === 'string' ? record.aiModel.trim() : '';
  const aiModel = explicitAiModel || internalModel;
  if (!aiModel && !('model' in record) && !('aiModel' in record)) return record;
  const projected: {
    version: number;
    aiModel?: string;
    usage?: unknown;
    narrativeHistoryReadCount?: number;
  } = { version: 1 };
  if (aiModel) projected.aiModel = aiModel;
  if (record.usage !== undefined) projected.usage = record.usage;
  if (
    typeof record.narrativeHistoryReadCount === 'number'
    && Number.isFinite(record.narrativeHistoryReadCount)
    && record.narrativeHistoryReadCount >= 0
  ) {
    projected.narrativeHistoryReadCount = record.narrativeHistoryReadCount;
  }
  return projected;
};

/**
 * Arena 客户端-facing SSE wire 边界的 event 级投影：
 * `telemetry` 事件与 `snapshot` 事件内嵌的 telemetry 都必须经过
 * `projectArenaTelemetryForClient`，使 create、retained replay、
 * window-lost snapshot bootstrap 与 terminal snapshot fallback
 * 共享同一个公开契约边界。
 */
export const projectArenaGenerationEventForClient = <
  T extends { type: string; data: unknown },
>(
  event: T,
): T => {
  if (event.type === 'telemetry') {
    return { ...event, data: projectArenaTelemetryForClient(event.data) } as T;
  }
  if (event.type === 'snapshot') {
    const snapshot = event.data !== null
      && typeof event.data === 'object'
      && !Array.isArray(event.data)
      ? event.data as Record<string, unknown>
      : null;
    if (snapshot && 'telemetry' in snapshot) {
      return {
        ...event,
        data: {
          ...snapshot,
          telemetry: projectArenaTelemetryForClient(snapshot.telemetry),
        },
      } as T;
    }
  }
  return event;
};

export const resolveResumeCursor = (request: Request): string | null => {
  const headerCursor = request.headers.get('last-event-id')?.trim() || null;
  const queryCursor = new URL(request.url).searchParams.get('after')?.trim() || null;
  if (headerCursor && queryCursor && headerCursor !== queryCursor) {
    throw new Error('RESUME_CURSOR_CONFLICT');
  }
  const resolved = headerCursor ?? queryCursor;
  if (resolved && !/^\d+-\d+$/u.test(resolved)) {
    throw new Error('RESUME_CURSOR_INVALID');
  }
  return resolved;
};
