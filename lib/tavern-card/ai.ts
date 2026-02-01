import { getUtf8ByteLength } from '@/lib/data-card-size';

import { TAVERN_IMPORT_ATTACHMENT_LIMITS } from './limits';

import type { TavernAiAttachmentBuildResult, TavernCardNormalized } from './types';

const TRUNCATE_SUFFIX = '\n...[已截断]';

const safeString = (value: unknown): string => (typeof value === 'string' ? value : '');

const clampTags = (value: unknown, limit = 50): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    out.push(trimmed);
    if (out.length >= limit) break;
  }
  return out.length > 0 ? out : undefined;
};

type TavernAiSource = {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  first_mes: string;
  mes_example: string;
  creator_notes: string;
  tags?: string[];
};

type TavernAiLimits = Record<keyof Omit<TavernAiSource, 'name' | 'tags'>, number>;

const DEFAULT_LIMITS: TavernAiLimits = {
  description: 32_000,
  personality: 32_000,
  scenario: 24_000,
  first_mes: 8_000,
  mes_example: 80_000,
  creator_notes: 40_000,
};

const applyLimits = (source: TavernAiSource, limits: TavernAiLimits): TavernAiSource => {
  const truncate = (key: keyof TavernAiLimits): string => {
    const raw = source[key];
    const maxChars = limits[key];
    if (maxChars <= 0) return '';
    if (raw.length <= maxChars) return raw;
    const sliced = raw.slice(0, maxChars);
    return `${sliced}${TRUNCATE_SUFFIX}`;
  };

  return {
    ...source,
    description: truncate('description'),
    personality: truncate('personality'),
    scenario: truncate('scenario'),
    first_mes: truncate('first_mes'),
    mes_example: truncate('mes_example'),
    creator_notes: truncate('creator_notes'),
  };
};

const buildWarnings = (source: TavernAiSource, limited: TavernAiSource, limits: TavernAiLimits): string[] => {
  const warnings: string[] = [];
  (Object.keys(limits) as Array<keyof TavernAiLimits>).forEach((key) => {
    if (source[key].length > limits[key]) {
      warnings.push(`AI 输入包已对 ${key} 截断（上限 ${limits[key].toLocaleString()} 字符）。`);
    }
  });
  if (source.tags && limited.tags && source.tags.length > limited.tags.length) {
    warnings.push(`AI 输入包已对 tags 截断（最多 ${limited.tags.length} 个）。`);
  }
  return warnings;
};

const fitWithinLimit = (source: TavernAiSource, limits: TavernAiLimits): TavernAiLimits => {
  const maxBytes = TAVERN_IMPORT_ATTACHMENT_LIMITS.maxBytesPerFile;

  const trimOrder: Array<keyof TavernAiLimits> = ['mes_example', 'creator_notes', 'description', 'personality', 'scenario', 'first_mes'];

  const stringify = (nextLimits: TavernAiLimits): string => {
    const payload = applyLimits(source, nextLimits);
    return JSON.stringify(payload);
  };

  let content = stringify(limits);
  let contentBytes = getUtf8ByteLength(content);
  let nextLimits = { ...limits };

  for (const key of trimOrder) {
    if (contentBytes <= maxBytes) break;
    if (nextLimits[key] <= 0) continue;

    let low = 0;
    let high = nextLimits[key];

    while (low < high) {
      const mid = Math.floor((low + high + 1) / 2);
      const candidateLimits = { ...nextLimits, [key]: mid };
      const candidateContent = stringify(candidateLimits);
      if (getUtf8ByteLength(candidateContent) <= maxBytes) {
        low = mid;
      } else {
        high = mid - 1;
      }
    }

    nextLimits = { ...nextLimits, [key]: low };
    content = stringify(nextLimits);
    contentBytes = getUtf8ByteLength(content);
  }

  return nextLimits;
};

export function buildTavernAiAttachment(normalized: TavernCardNormalized): TavernAiAttachmentBuildResult {
  const rawTagsCount = Array.isArray(normalized.tags) ? normalized.tags.length : 0;
  const tags = clampTags(normalized.tags);

  const source: TavernAiSource = {
    name: safeString(normalized.name).trim() || '未命名角色',
    description: safeString(normalized.description),
    personality: safeString(normalized.personality),
    scenario: safeString(normalized.scenario),
    first_mes: safeString(normalized.firstMes),
    mes_example: safeString(normalized.mesExample),
    creator_notes: safeString(normalized.creatorNotes),
    tags,
  };

  const fittedLimits = fitWithinLimit(source, { ...DEFAULT_LIMITS });
  const limited = applyLimits(source, fittedLimits);
  if (source.tags) limited.tags = source.tags;
  const warnings = buildWarnings(source, limited, fittedLimits);
  if (rawTagsCount > (tags?.length ?? 0)) {
    warnings.push(`AI 输入包已对 tags 截断（最多 ${(tags?.length ?? 0).toLocaleString()} 个）。`);
  }

  const content = JSON.stringify(limited);
  const truncated = warnings.length > 0 || getUtf8ByteLength(content) > TAVERN_IMPORT_ATTACHMENT_LIMITS.maxBytesPerFile;

  return {
    attachment: {
      name: 'tavern-card.json',
      type: 'application/json',
      content,
      ...(truncated ? { truncated: true } : {}),
    },
    warnings,
  };
}
