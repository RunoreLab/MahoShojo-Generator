import type {
  DataCardReportReferenceType,
  NormalizedReportReference,
} from '@/lib/data-card-reports/types';
import { getEncyclopediaEntry } from '@/lib/encyclopedia';

export const MAX_DATA_CARD_REPORT_REFERENCES = 5;

export class InvalidDataCardReportReferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidDataCardReportReferenceError';
  }
}

export const isDataCardReportReferenceType = (value: unknown): value is DataCardReportReferenceType =>
  value === 'public_data_card' || value === 'encyclopedia_entry';

export const normalizeDataCardReportDetails = (value: string | null | undefined): string | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\r\n/g, '\n').trim();
  return normalized.length > 0 ? normalized : null;
};

const normalizeReferenceNote = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\r\n/g, '\n').trim();
  return normalized.length > 0 ? normalized : null;
};

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const normalizePublicDataCardReferenceId = (value: string): string => {
  const trimmed = value.trim();
  const uuidMatch = trimmed.match(UUID_PATTERN);
  if (uuidMatch?.[0]) {
    return uuidMatch[0].toLowerCase();
  }

  try {
    const url = new URL(trimmed, 'https://mahoshojo.local');
    const queryId =
      url.searchParams.get('dataCardId') ??
      url.searchParams.get('cardId') ??
      url.searchParams.get('metaCardId');
    if (queryId && UUID_PATTERN.test(queryId)) {
      return queryId.match(UUID_PATTERN)![0].toLowerCase();
    }
  } catch {
    // ignore invalid URL parse
  }

  return trimmed;
};

const normalizeEncyclopediaReferenceId = (value: string): string => {
  const trimmed = value.trim();
  return getEncyclopediaEntry(trimmed)?.slug ?? trimmed;
};

const parseReference = (value: unknown): Omit<NormalizedReportReference, 'sortOrder'> => {
  if (!value || typeof value !== 'object') {
    throw new InvalidDataCardReportReferenceError('引用必须是对象');
  }

  const record = value as Record<string, unknown>;
  if (!isDataCardReportReferenceType(record.referenceType)) {
    throw new InvalidDataCardReportReferenceError('引用类型无效');
  }

  if (typeof record.referenceId !== 'string' || record.referenceId.trim().length === 0) {
    throw new InvalidDataCardReportReferenceError('引用 ID 不能为空');
  }

  return {
    referenceType: record.referenceType,
    referenceId:
      record.referenceType === 'public_data_card'
        ? normalizePublicDataCardReferenceId(record.referenceId)
        : normalizeEncyclopediaReferenceId(record.referenceId),
    note: normalizeReferenceNote(record.note),
  };
};

export function normalizeDataCardReportReferences(input: unknown[]): NormalizedReportReference[] {
  const seen = new Set<string>();
  const normalized: NormalizedReportReference[] = [];

  for (const item of input) {
    const parsed = parseReference(item);
    const key = `${parsed.referenceType}:${parsed.referenceId}`;
    if (seen.has(key)) continue;
    if (normalized.length >= MAX_DATA_CARD_REPORT_REFERENCES) {
      throw new InvalidDataCardReportReferenceError(`引用数量不能超过 ${MAX_DATA_CARD_REPORT_REFERENCES} 条`);
    }
    seen.add(key);
    normalized.push({ ...parsed, sortOrder: normalized.length });
  }

  return normalized;
}

const compareCanonicalText = (a: string | null, b: string | null): number => {
  const left = a ?? '';
  const right = b ?? '';
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
};

const canonicalizeReferencesForHash = (references: NormalizedReportReference[]): NormalizedReportReference[] =>
  normalizeDataCardReportReferences(
    references
      .map((reference) => ({
        referenceType: reference.referenceType,
        referenceId: reference.referenceId,
        note: reference.note,
      }))
      .sort((left, right) => {
        const byType = compareCanonicalText(left.referenceType, right.referenceType);
        if (byType !== 0) return byType;

        const byId = compareCanonicalText(left.referenceId, right.referenceId);
        if (byId !== 0) return byId;

        return compareCanonicalText(left.note, right.note);
      }),
  );

export async function buildNormalizedReportPayloadHash(input: {
  targetEntityId: string;
  reasonCode: string;
  details: string | null;
  references: NormalizedReportReference[];
}): Promise<string> {
  const payload = JSON.stringify({
    targetEntityId: input.targetEntityId.trim(),
    reasonCode: input.reasonCode.trim(),
    details: normalizeDataCardReportDetails(input.details),
    references: canonicalizeReferencesForHash(input.references),
  });
  const encoded = new TextEncoder().encode(payload);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
