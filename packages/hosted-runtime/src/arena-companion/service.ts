import {
  MAX_ARENA_CREATE_BODY_BYTES,
  type ArenaGenerationService,
  type ArenaGenerationSubscription,
  type GenerationStreamEvent,
} from '@mahoshojo/hosted-api/arena-generation/service';

export const ARENA_COMPANION_OPERATION_HEADER = 'x-mahoshojo-arena-companion-operation';

export type ArenaCompanionOperation = 'arena/generate' | 'generate-battle-story';

export type ArenaCompanionImpact = {
  characterName: string;
  impact?: string;
  currentStateSummary?: string;
};

export type ArenaCompanionProjectInput = {
  combatants: readonly unknown[];
  report: Record<string, unknown>;
  impacts: readonly ArenaCompanionImpact[];
  userGuidance: string | null;
  scenario: Record<string, unknown> | null;
  writeArenaHistory: boolean;
  writeCurrentState: boolean;
  generationId: string;
  baseRevisionHash: string | null;
};

export type ArenaCompanionServiceOptions = {
  generationService: ArenaGenerationService;
  createGenerationRequestId?(): string;
  projectUpdatedCombatants(
    _input: ArenaCompanionProjectInput,
  ): Promise<Array<Record<string, unknown>>>;
};

export interface ArenaCompanionService {
  generate(_request: Request, _operation?: ArenaCompanionOperation): Promise<Response>;
}

const jsonResponse = (
  payload: unknown,
  status: number,
  headers?: Readonly<Record<string, string>>,
): Response => new Response(JSON.stringify(payload), {
  status,
  headers: {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    ...headers,
  },
});

const recordOf = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
);

const textOf = (value: unknown): string => (
  typeof value === 'string' ? value.trim() : ''
);

const rawTextOf = (value: unknown): string => (
  typeof value === 'string' ? value : ''
);

const booleanOf = (value: unknown, fallback: boolean): boolean => (
  typeof value === 'boolean' ? value : fallback
);

const isGenerationRequestId = (value: unknown): value is string => (
  typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u.test(value.trim())
);

export const readArenaCompanionJsonPayload = async (
  request: Request,
): Promise<Record<string, unknown> | Response> => {
  if (request.method !== 'POST') {
    return jsonResponse({ code: 'METHOD_NOT_ALLOWED', error: 'Method not allowed' }, 405);
  }
  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_ARENA_CREATE_BODY_BYTES) {
    return jsonResponse({
      code: 'ARENA_REQUEST_TOO_LARGE',
      error: '请求体超过允许的大小',
    }, 413);
  }
  const chunks: Uint8Array[] = [];
  let bodyBytes = 0;
  const reader = request.body?.getReader();
  try {
    if (reader) {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        bodyBytes += next.value.byteLength;
        if (bodyBytes > MAX_ARENA_CREATE_BODY_BYTES) {
          await reader.cancel('arena companion body exceeds byte limit').catch(() => undefined);
          return jsonResponse({
            code: 'ARENA_REQUEST_TOO_LARGE',
            error: '请求体超过允许的大小',
          }, 413);
        }
        chunks.push(next.value);
      }
    }
  } catch {
    return jsonResponse({ code: 'INVALID_JSON', error: '请求体必须是 JSON' }, 400);
  } finally {
    reader?.releaseLock();
  }
  const body = new Uint8Array(bodyBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const parsed = JSON.parse(new TextDecoder().decode(body)) as unknown;
    return recordOf(parsed)
      ?? jsonResponse({ code: 'INVALID_REQUEST', error: '请求体必须是对象' }, 400);
  } catch {
    return jsonResponse({ code: 'INVALID_JSON', error: '请求体必须是 JSON' }, 400);
  }
};

const parseHeaderMeta = (
  headers: Readonly<Record<string, string>>,
): Record<string, unknown> => {
  const raw = Object.entries(headers).find(
    ([name]) => name.toLowerCase() === 'x-mahoshojo-stream-meta',
  )?.[1];
  if (!raw) return {};
  try {
    return recordOf(JSON.parse(decodeURIComponent(raw))) ?? {};
  } catch {
    return {};
  }
};

const eventData = (event: GenerationStreamEvent): Record<string, unknown> => (
  recordOf(event.data) ?? {}
);

const section = (markdown: string, heading: string): string => {
  const lines = markdown.split(/\r?\n/u);
  const start = lines.findIndex((line) => (
    new RegExp(`^##\\s*${heading}\\s*$`, 'iu').test(line.trim())
  ));
  if (start < 0) return '';
  const collected: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (/^##\s+/u.test(line.trim())) break;
    collected.push(line);
  }
  return collected.join('\n').trim();
};

const headlineFromMarkdown = (markdown: string): string => {
  for (const line of markdown.split(/\r?\n/u)) {
    const match = line.trim().match(/^#\s+(.+)$/u);
    if (match?.[1]) return match[1].trim();
  }
  return '';
};

const bodyFromMarkdown = (markdown: string): string => {
  const lines = markdown.split(/\r?\n/u);
  const start = lines.findIndex((line) => /^#\s+/u.test(line.trim()));
  const bodyStart = start >= 0 ? start + 1 : 0;
  const end = lines.findIndex((line, index) => (
    index >= bodyStart && /^##\s*(?:胜利者|winner)\s*$/iu.test(line.trim())
  ));
  return lines.slice(bodyStart, end >= 0 ? end : lines.length).join('\n').trim();
};

const normalizeImpacts = (value: unknown): ArenaCompanionImpact[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = recordOf(item);
    const characterName = textOf(record?.characterName);
    if (!record || !characterName) return [];
    const impact = textOf(record.impact);
    const currentStateSummary = textOf(record.currentStateSummary);
    return [{
      characterName,
      ...(impact ? { impact } : {}),
      ...(currentStateSummary ? { currentStateSummary } : {}),
    }];
  });
};

type CollectedGeneration = {
  markdown: string;
  reasoning: string;
  meta: Record<string, unknown>;
  telemetry: Record<string, unknown>;
  terminalError: string | null;
  completed: boolean;
};

const collectSubscription = async (
  subscription: ArenaGenerationSubscription,
): Promise<CollectedGeneration> => {
  let markdown = '';
  let reasoning = '';
  let meta: Record<string, unknown> = {};
  let telemetry: Record<string, unknown> = {};
  let terminalError: string | null = null;
  let completed = false;
  const reader = subscription.events.getReader();
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      const event = next.value;
      const data = eventData(event);
      if (event.type === 'markdown') markdown += rawTextOf(data.chunk);
      if (event.type === 'reasoning') reasoning += rawTextOf(data.chunk);
      if (event.type === 'snapshot') {
        markdown = typeof data.markdown === 'string' ? data.markdown : markdown;
        reasoning = typeof data.reasoning === 'string' ? data.reasoning : reasoning;
        telemetry = recordOf(data.telemetry) ?? telemetry;
      }
      if (event.type === 'meta') meta = recordOf(data.meta) ?? meta;
      if (event.type === 'telemetry') telemetry = { ...telemetry, ...data };
      if (event.type === 'done') {
        completed = data.ok !== false && data.status !== 'failed' && data.status !== 'cancelled';
        break;
      }
      if (event.type === 'error') {
        terminalError = textOf(data.code) || 'GENERATION_FAILED';
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
  return { markdown, reasoning, meta, telemetry, terminalError, completed };
};

const operationFromRequest = (request: Request): ArenaCompanionOperation => (
  new URL(request.url).pathname.endsWith('/generate-battle-story')
    ? 'generate-battle-story'
    : 'arena/generate'
);

const rebuildRequest = (
  source: Request,
  payload: Record<string, unknown>,
  generationRequestId: string,
  operation: ArenaCompanionOperation,
): Request => {
  const headers = new Headers(source.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.delete('content-length');
  headers.set(ARENA_COMPANION_OPERATION_HEADER, operation);
  return new Request(source.url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      ...payload,
      forceStreamMeta: true,
      generationRequestId,
    }),
    signal: source.signal,
  });
};

export const createArenaCompanionService = (
  options: ArenaCompanionServiceOptions,
): ArenaCompanionService => Object.freeze({
  async generate(
    request: Request,
    requestedOperation?: ArenaCompanionOperation,
  ): Promise<Response> {
    const payload = await readArenaCompanionJsonPayload(request);
    if (payload instanceof Response) return payload;
    if ('generationRequestId' in payload && !isGenerationRequestId(payload.generationRequestId)) {
      return jsonResponse({
        code: 'INVALID_GENERATION_REQUEST_ID',
        error: 'generationRequestId 无效',
      }, 400);
    }
    const generationRequestId = isGenerationRequestId(payload.generationRequestId)
      ? payload.generationRequestId.trim()
      : options.createGenerationRequestId?.() ?? crypto.randomUUID();
    const operation = requestedOperation ?? operationFromRequest(request);
    const upstream = await options.generationService.createSubscription(
      rebuildRequest(request, payload, generationRequestId, operation),
    );
    if (upstream instanceof Response) return upstream;
    const collected = await collectSubscription(upstream);
    if (!collected.completed) {
      return jsonResponse({
        code: collected.terminalError ?? 'GENERATION_STREAM_INCOMPLETE',
        error: 'Arena generation failed',
        generationId: upstream.generationId,
      }, 502, upstream.headers);
    }

    const headerMeta = parseHeaderMeta(upstream.headers);
    const metaReport = recordOf(collected.meta.report) ?? {};
    const headline = textOf(metaReport.headline) || headlineFromMarkdown(collected.markdown);
    const winner = textOf(metaReport.winner) || section(collected.markdown, '(?:胜利者|winner)');
    const conclusion = section(collected.markdown, '(?:最终结果|final result)');
    const impacts = normalizeImpacts(collected.meta.impacts);
    const reporterInfo = recordOf(headerMeta.reporterInfo) ?? { name: '', publication: '' };
    const usage = recordOf(collected.telemetry.usage);
    const model = textOf(collected.telemetry.model);
    const mode = textOf(payload.mode) || 'classic';
    const report: Record<string, unknown> = {
      headline,
      reporterInfo,
      article: {
        body: bodyFromMarkdown(collected.markdown),
        analysis: '',
      },
      officialReport: { winner, conclusion },
      mode,
      ...(textOf(headerMeta.userGuidance) ? { userGuidance: textOf(headerMeta.userGuidance) } : {}),
      ...(Array.isArray(headerMeta.characterGuidances)
        ? { characterGuidances: headerMeta.characterGuidances }
        : {}),
      ...(usage ? { aiUsage: usage } : {}),
      ...(model ? { aiModel: model } : {}),
      ...(collected.reasoning
        ? { aiReasoning: { text: collected.reasoning, status: 'complete' } }
        : {}),
    };
    const updatedCombatants = await options.projectUpdatedCombatants({
      combatants: Array.isArray(payload.combatants) ? payload.combatants : [],
      report,
      impacts,
      userGuidance: textOf(headerMeta.userGuidance) || null,
      scenario: recordOf(payload.scenario),
      writeArenaHistory: booleanOf(payload.writeArenaHistory, true),
      writeCurrentState: booleanOf(payload.writeCurrentState, true),
      generationId: upstream.generationId,
      baseRevisionHash: textOf(payload.baseRevisionHash) || null,
    });
    return jsonResponse({
      report,
      updatedCombatants,
      generationId: upstream.generationId,
      ...(Array.isArray(headerMeta.adjudicationResults)
        ? { adjudicationResults: headerMeta.adjudicationResults }
        : {}),
      ...(impacts.length > 0 ? { impacts } : {}),
    }, 200, upstream.headers);
  },
});
