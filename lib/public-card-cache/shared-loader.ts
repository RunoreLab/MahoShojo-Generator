import type { ChallengeResolvedSourceCardLite } from '@/lib/challenge/types';
import {
  inferChallengeRenderableTemplate,
  isChallengeRenderableSourceCard,
} from '@/lib/challenge/source-card-renderability';
import {
  cleanupExpiredPublicCardCache,
  deletePublicCardCacheRecord,
  getPublicCardCacheRecord,
  putPublicCardCacheRecord,
  touchPublicCardCacheRecord,
  trimPublicCardCacheToLimit,
} from '@/lib/public-card-cache/storage';
import {
  PUBLIC_CARD_CACHE_FRESH_TTL_MS,
  PUBLIC_CARD_CACHE_HARD_TTL_MS,
  PUBLIC_CARD_CACHE_NEGATIVE_TTL_MS,
  type PublicCardCacheEntry,
  type PublicCardCacheRecord,
  type PublicCardDetailsType,
  type PublicCardCacheSource,
  type PublicCardFetchResult,
  type PublicCardRenderableTemplate,
} from '@/lib/public-card-cache/types';

const publicCardMemoryCache = new Map<string, PublicCardCacheEntry>();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const safeString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const safeNullableString = (value: unknown): string | null => {
  const normalized = safeString(value);
  return normalized || null;
};
const safeNullableInteger = (value: unknown): number | null => {
  const numeric =
    typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
  if (!Number.isFinite(numeric)) return null;
  return Math.max(0, Math.floor(numeric));
};

const parseJsonRecord = (value: string): Record<string, unknown> | null => {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const normalizeDataString = (value: unknown): string | null => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (isRecord(value)) {
    return JSON.stringify(value);
  }
  return null;
};

const readUpdatedAt = (input: Record<string, unknown>): string | null => {
  const updatedAt = safeString(input.updatedAt);
  if (updatedAt) return updatedAt;
  const snakeCase = safeString(input.updated_at);
  return snakeCase || null;
};

const readCreatedAt = (input: Record<string, unknown>): string | null => {
  const createdAt = safeString(input.createdAt);
  if (createdAt) return createdAt;
  const snakeCase = safeString(input.created_at);
  return snakeCase || null;
};

const readDetailsType = (input: Record<string, unknown>): PublicCardDetailsType | null => {
  const type = safeString(input.type);
  if (type === 'character' || type === 'scenario' || type === 'history' || type === 'questionnaire') {
    return type;
  }
  return null;
};

const readVisibility = (input: Record<string, unknown>): boolean | number | null => {
  const numeric = safeNullableInteger(input.isPublic ?? input.is_public);
  if (numeric !== null) return numeric;

  const boolValue = input.isPublic ?? input.is_public;
  if (typeof boolValue === 'boolean') return boolValue;

  return null;
};

const toRenderableMetadata = (data: string): {
  renderableTemplate: PublicCardRenderableTemplate;
  isRenderable: boolean;
} => {
  const parsed = parseJsonRecord(data);
  if (!parsed) {
    return {
      renderableTemplate: null,
      isRenderable: false,
    };
  }

  return {
    renderableTemplate: inferChallengeRenderableTemplate(parsed),
    isRenderable: isChallengeRenderableSourceCard(parsed),
  };
};

const toCardPayload = (record: PublicCardCacheRecord): Record<string, unknown> => ({
  id: record.id,
  name: record.name,
  data: record.data,
  updatedAt: record.updatedAt,
  updated_at: record.updatedAt ?? undefined,
  description: record.description ?? undefined,
  type: record.cardType ?? undefined,
  is_public: record.isPublic ?? undefined,
  username: record.authorName ?? undefined,
  created_at: record.createdAt ?? undefined,
  usage_count: record.usageCount ?? undefined,
  like_count: record.likeCount ?? undefined,
  favorite_count: record.favoriteCount ?? undefined,
});

const writeEntryToMemory = (entry: PublicCardCacheEntry): void => {
  publicCardMemoryCache.set(entry.id, entry);
};

const removeEntryFromMemory = (id: string): void => {
  publicCardMemoryCache.delete(id);
};

const touchEntryAccess = (entry: PublicCardCacheEntry, nowMs: number): PublicCardCacheEntry => {
  const lastAccessedAtMs = Math.max(entry.lastAccessedAtMs, nowMs);
  const touchedEntry = { ...entry, lastAccessedAtMs } satisfies PublicCardCacheEntry;
  writeEntryToMemory(touchedEntry);
  if (lastAccessedAtMs !== entry.lastAccessedAtMs) {
    void touchPublicCardCacheRecord(entry.id, lastAccessedAtMs).catch(() => undefined);
  }
  return touchedEntry;
};

const persistEntry = async (entry: PublicCardCacheEntry, nowMs: number): Promise<void> => {
  try {
    await putPublicCardCacheRecord(entry);
    await cleanupExpiredPublicCardCache(nowMs);
    await trimPublicCardCacheToLimit();
  } catch {
    // IndexedDB 不可用或失败时，保留 memory cache 即可
  }
};

const writePositiveEntry = async (entry: PublicCardCacheRecord, nowMs: number): Promise<void> => {
  writeEntryToMemory(entry);
  await persistEntry(entry, nowMs);
};

const writeNegativeEntry = async (id: string, nowMs: number): Promise<void> => {
  const entry: PublicCardCacheEntry = {
    id,
    cacheKind: 'negative',
    statusCode: 404,
    fetchedAtMs: nowMs,
    lastAccessedAtMs: nowMs,
    expiresAtMs: nowMs + PUBLIC_CARD_CACHE_NEGATIVE_TTL_MS,
    reason: 'not-found',
  };
  writeEntryToMemory(entry);
  await persistEntry(entry, nowMs);
};

const deleteEntryEverywhere = async (id: string): Promise<void> => {
  removeEntryFromMemory(id);
  try {
    await deletePublicCardCacheRecord(id);
  } catch {
    // ignore IndexedDB failures
  }
};

const buildPositiveRecord = (input: {
  id: string;
  name: string;
  data: string;
  updatedAt: string | null;
  description?: string | null;
  cardType?: PublicCardDetailsType | null;
  isPublic?: boolean | number | null;
  authorName?: string | null;
  createdAt?: string | null;
  usageCount?: number | null;
  likeCount?: number | null;
  favoriteCount?: number | null;
  nowMs: number;
  source: PublicCardCacheRecord['source'];
}): PublicCardCacheRecord => {
  const renderableMetadata = toRenderableMetadata(input.data);
  return {
    id: input.id,
    cacheKind: 'card',
    name: input.name,
    data: input.data,
    updatedAt: input.updatedAt,
    description: input.description ?? null,
    cardType: input.cardType ?? null,
    isPublic: input.isPublic ?? null,
    authorName: input.authorName ?? null,
    createdAt: input.createdAt ?? null,
    usageCount: input.usageCount ?? null,
    likeCount: input.likeCount ?? null,
    favoriteCount: input.favoriteCount ?? null,
    fetchedAtMs: input.nowMs,
    lastAccessedAtMs: input.nowMs,
    expiresAtMs: input.nowMs + PUBLIC_CARD_CACHE_HARD_TTL_MS,
    renderableTemplate: renderableMetadata.renderableTemplate,
    isRenderable: renderableMetadata.isRenderable,
    source: input.source,
  };
};

const buildRecordFromSidecar = (
  sidecar: ChallengeResolvedSourceCardLite,
  nowMs: number,
): PublicCardCacheRecord | null => {
  const id = sidecar.id.trim();
  const name = sidecar.name.trim();
  const data = normalizeDataString(sidecar.data);
  if (!id || !name || !data) return null;

  return buildPositiveRecord({
    id,
    name,
    data,
    updatedAt: sidecar.updatedAt,
    nowMs,
    source: 'challenge-sidecar',
  });
};

const buildRecordFromPublicRow = (row: unknown, nowMs: number): PublicCardCacheRecord | null => {
  if (!isRecord(row)) return null;

  const id = safeString(row.id);
  const name = safeString(row.name);
  const data = normalizeDataString(row.data);
  if (!id || !name || !data) return null;

  return buildPositiveRecord({
    id,
    name,
    data,
    updatedAt: readUpdatedAt(row),
    description: safeNullableString(row.description),
    cardType: readDetailsType(row),
    isPublic: readVisibility(row),
    authorName: safeNullableString(row.username ?? row.author),
    createdAt: readCreatedAt(row),
    usageCount: safeNullableInteger(row.usageCount ?? row.usage_count),
    likeCount: safeNullableInteger(row.likeCount ?? row.like_count),
    favoriteCount: safeNullableInteger(row.favoriteCount ?? row.favorite_count),
    nowMs,
    source: 'public-data-card-api',
  });
};

const resolveEntryState = (
  entry: PublicCardCacheEntry,
  nowMs: number,
): 'fresh' | 'stale' | 'expired' | 'negative' => {
  if (entry.cacheKind === 'negative') {
    return entry.expiresAtMs > nowMs ? 'negative' : 'expired';
  }

  if (entry.expiresAtMs <= nowMs) {
    return 'expired';
  }

  if (entry.fetchedAtMs + PUBLIC_CARD_CACHE_FRESH_TTL_MS > nowMs) {
    return 'fresh';
  }

  return 'stale';
};

const revalidateInBackground = (
  id: string,
  nowMs: number,
  fetcher?: (id: string) => Promise<PublicCardFetchResult>,
  getNowMs?: () => number,
): void => {
  if (!fetcher) return;

  void (async () => {
    try {
      const fetchResult = await fetcher(id);
      const completedAtMs = Math.max(nowMs, getNowMs ? getNowMs() : Date.now());
      if (fetchResult.kind === 'success') {
        await primePublicCardCacheFromPublicRow(fetchResult.card, { nowMs: completedAtMs });
        return;
      }

      if (fetchResult.kind === 'not-found') {
        await deleteEntryEverywhere(id);
        await writeNegativeEntry(id, completedAtMs);
      }
    } catch {
      // ignore background revalidate failures
    }
  })();
};

export const clearPublicCardMemoryCacheForTest = (): void => {
  publicCardMemoryCache.clear();
};

export const writePublicCardCacheFromSidecar = async (
  sidecar: ChallengeResolvedSourceCardLite,
  options?: { nowMs?: number },
): Promise<void> => {
  const nowMs = options?.nowMs ?? Date.now();
  const entry = buildRecordFromSidecar(sidecar, nowMs);
  if (!entry) return;
  await writePositiveEntry(entry, nowMs);
};

export const primePublicCardCacheFromPublicRow = async (
  row: unknown,
  options?: { nowMs?: number },
): Promise<void> => {
  const nowMs = options?.nowMs ?? Date.now();
  const entry = buildRecordFromPublicRow(row, nowMs);
  if (!entry) return;
  await writePositiveEntry(entry, nowMs);
};

export const getPublicCardByIdWithSharedCache = async (input: {
  id: string;
  fetcher?: (id: string) => Promise<PublicCardFetchResult>;
  backgroundRevalidate?: boolean;
  nowMs?: number;
  getNowMs?: () => number;
}): Promise<{
  card: unknown | null;
  source: PublicCardCacheSource;
}> => {
  const normalizedId = input.id.trim();
  const nowMs = input.nowMs ?? Date.now();
  if (!normalizedId) {
    return {
      card: null,
      source: 'network',
    };
  }

  const memoryEntry = publicCardMemoryCache.get(normalizedId) ?? null;
  if (memoryEntry) {
    const state = resolveEntryState(memoryEntry, nowMs);
    if (state === 'negative') {
      touchEntryAccess(memoryEntry, nowMs);
      return {
        card: null,
        source: 'negative-cache',
      };
    }
    if (state === 'fresh' && memoryEntry.cacheKind === 'card') {
      const touchedEntry = touchEntryAccess(memoryEntry, nowMs);
      return {
        card: toCardPayload(touchedEntry),
        source: 'memory',
      };
    }
    if (state === 'stale' && memoryEntry.cacheKind === 'card') {
      const touchedEntry = touchEntryAccess(memoryEntry, nowMs);
      if (input.backgroundRevalidate !== false) {
        revalidateInBackground(normalizedId, nowMs, input.fetcher, input.getNowMs);
      }
      return {
        card: toCardPayload(touchedEntry),
        source: 'memory',
      };
    }

    removeEntryFromMemory(normalizedId);
  }

  let indexedDbEntry: PublicCardCacheEntry | null = null;
  try {
    indexedDbEntry = await getPublicCardCacheRecord(normalizedId);
  } catch {
    indexedDbEntry = null;
  }

  if (indexedDbEntry) {
    const state = resolveEntryState(indexedDbEntry, nowMs);
    if (state === 'negative') {
      writeEntryToMemory({
        ...indexedDbEntry,
        lastAccessedAtMs: nowMs,
      });
      void touchPublicCardCacheRecord(normalizedId, nowMs).catch(() => undefined);
      return {
        card: null,
        source: 'negative-cache',
      };
    }

    if (state === 'fresh' && indexedDbEntry.cacheKind === 'card') {
      const touchedEntry: PublicCardCacheRecord = {
        ...indexedDbEntry,
        lastAccessedAtMs: nowMs,
      };
      writeEntryToMemory(touchedEntry);
      void touchPublicCardCacheRecord(normalizedId, nowMs).catch(() => undefined);
      return {
        card: toCardPayload(touchedEntry),
        source: 'indexeddb',
      };
    }

    if (state === 'stale' && indexedDbEntry.cacheKind === 'card') {
      const touchedEntry: PublicCardCacheRecord = {
        ...indexedDbEntry,
        lastAccessedAtMs: nowMs,
      };
      writeEntryToMemory(touchedEntry);
      void touchPublicCardCacheRecord(normalizedId, nowMs).catch(() => undefined);
      if (input.backgroundRevalidate !== false) {
        revalidateInBackground(normalizedId, nowMs, input.fetcher, input.getNowMs);
      }
      return {
        card: toCardPayload(touchedEntry),
        source: 'stale-indexeddb',
      };
    }

    void deleteEntryEverywhere(normalizedId);
  }

  if (!input.fetcher) {
    return {
      card: null,
      source: 'network',
    };
  }

  const fetchResult = await input.fetcher(normalizedId);
  if (fetchResult.kind === 'success') {
    await primePublicCardCacheFromPublicRow(fetchResult.card, { nowMs });
    const cachedRecord = publicCardMemoryCache.get(normalizedId);
    return {
      card: cachedRecord && cachedRecord.cacheKind === 'card' ? toCardPayload(cachedRecord) : fetchResult.card,
      source: 'network',
    };
  }

  if (fetchResult.kind === 'not-found') {
    await writeNegativeEntry(normalizedId, nowMs);
    return {
      card: null,
      source: 'negative-cache',
    };
  }

  return {
    card: null,
    source: 'network',
  };
};
