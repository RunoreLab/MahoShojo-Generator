import type {
  AIReasoningEnvelope,
  AIReasoningSource,
  AIReasoningStatus,
} from './types';

const SUMMARY_MAX_LENGTH = 80;

const normalizeReasoningText = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.replace(/\r\n/g, '\n').replace(/\u0000/g, '').trim();
};

export const normalizeReasoningSource = (value: unknown): AIReasoningSource => {
  if (value === 'sdk' || value === 'provider' || value === 'heuristic' || value === 'unknown') {
    return value;
  }
  return 'unknown';
};

export const buildReasoningSummary = (reasoningText: string, maxLength = SUMMARY_MAX_LENGTH): string | null => {
  const normalized = normalizeReasoningText(reasoningText).replace(/\s+/g, ' ');
  if (!normalized) return null;

  const stripped = normalized.replace(/^(thought|thinking|reasoning|思考|推理)\s*[:：-]?\s*/i, '').trim();
  const base = stripped || normalized;
  if (!base) return null;
  if (base.length <= maxLength) return base;
  return `${base.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
};

export const buildLiveReasoningSummary = (reasoningText: string, maxLength = SUMMARY_MAX_LENGTH): string | null => {
  const normalized = normalizeReasoningText(reasoningText);
  if (!normalized) return null;

  const blocks = normalized
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean);

  const candidates = blocks.length > 0 ? [...blocks].reverse() : [normalized];
  let picked = '';

  for (const candidate of candidates) {
    const compact = candidate
      .replace(/^\s*#{1,6}\s*/gm, '')
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/[*_`~]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (compact.length >= 6) {
      picked = compact;
      break;
    }
  }

  const baseRaw = picked || normalized.replace(/\s+/g, ' ').trim();
  const stripped = baseRaw.replace(/^(thought|thinking|reasoning|思考|推理)\s*[:：-]?\s*/i, '').trim();
  const base = stripped || baseRaw;
  if (!base) return null;
  if (base.length <= maxLength) return base;
  return `${base.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
};

export const appendReasoningDelta = (
  current: AIReasoningEnvelope | null,
  delta: string,
  options?: {
    source?: AIReasoningSource;
    reasoningTokens?: number | null;
    status?: AIReasoningStatus;
  }
): AIReasoningEnvelope => {
  const previousText = typeof current?.text === 'string' ? current.text : '';
  const safeDelta = typeof delta === 'string' ? delta : '';
  const nextText = `${previousText}${safeDelta}`;
  const source = options?.source ?? current?.source ?? 'sdk';
  const status = options?.status ?? 'thinking';
  const summary = buildLiveReasoningSummary(nextText) ?? buildReasoningSummary(nextText);

  return {
    ...(current ?? {}),
    source,
    status,
    text: nextText,
    summary,
    reasoningTokens: options?.reasoningTokens ?? current?.reasoningTokens ?? null,
    anomalyFlags: current?.anomalyFlags ?? null,
  };
};

export const updateReasoningStatus = (
  current: AIReasoningEnvelope | null,
  payload: {
    status: AIReasoningStatus;
    source?: AIReasoningSource;
    summary?: string | null;
    reasoningTokens?: number | null;
    errorMessage?: string | null;
  }
): AIReasoningEnvelope | null => {
  const source = payload.source ?? current?.source ?? 'sdk';
  const text = current?.text ?? null;
  const summary =
    typeof payload.summary === 'string'
      ? payload.summary
      : payload.summary === null
        ? null
        : (current?.summary ?? (typeof text === 'string' ? buildReasoningSummary(text) : null));

  return {
    ...(current ?? {}),
    status: payload.status,
    source,
    text,
    summary,
    reasoningTokens: payload.reasoningTokens ?? current?.reasoningTokens ?? null,
    errorMessage: payload.errorMessage ?? current?.errorMessage ?? null,
    anomalyFlags: current?.anomalyFlags ?? null,
  };
};

export const extractHeuristicReasoningFromMarkdown = (
  markdown: string
): AIReasoningEnvelope | null => {
  if (typeof markdown !== 'string' || !markdown.trim()) return null;

  const normalized = markdown.replace(/\r\n/g, '\n');
  const marker = normalized.match(/(?:^|\n)\s*(thought|thinking|reasoning|思考|推理)\s*$/im);
  if (!marker) return null;

  const markerIndex = marker.index ?? 0;
  if (markerIndex > 800) return null;

  const markerOffset = marker[0].startsWith('\n') ? 1 : 0;
  const startIndex = Math.max(0, markerIndex + markerOffset);
  const afterMarker = normalized.slice(startIndex);

  let endIndex = afterMarker.search(/\n#\s+/);
  if (endIndex <= 0) {
    endIndex = afterMarker.search(/\n---\n/);
  }

  const candidate = (endIndex > 0 ? afterMarker.slice(0, endIndex) : afterMarker.slice(0, 1800)).trim();
  if (candidate.length < 80) return null;

  const summary = buildReasoningSummary(candidate);
  if (!summary) return null;

  return {
    status: 'done',
    source: 'heuristic',
    text: candidate,
    summary,
    anomalyFlags: ['text_injected'],
  };
};
