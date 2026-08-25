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
