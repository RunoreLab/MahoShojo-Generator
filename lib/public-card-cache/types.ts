export type PublicCardRenderableTemplate = 'magical-girl' | 'canshou' | 'general' | null;
export type PublicCardDetailsType = 'character' | 'scenario' | 'history' | 'questionnaire';

export type PublicCardCacheRecord = {
  id: string;
  cacheKind: 'card';
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
  fetchedAtMs: number;
  lastAccessedAtMs: number;
  expiresAtMs: number;
  renderableTemplate: PublicCardRenderableTemplate;
  isRenderable: boolean;
  source: 'challenge-sidecar' | 'public-data-card-api';
};

export type PublicCardNegativeCacheRecord = {
  id: string;
  cacheKind: 'negative';
  statusCode: 404;
  fetchedAtMs: number;
  lastAccessedAtMs: number;
  expiresAtMs: number;
  reason: 'not-found';
};

export type PublicCardCacheEntry = PublicCardCacheRecord | PublicCardNegativeCacheRecord;
export type PublicCardCacheSource = 'memory' | 'indexeddb' | 'network' | 'negative-cache' | 'stale-indexeddb';

export type PublicCardFetchResult =
  | { kind: 'success'; card: unknown }
  | { kind: 'not-found'; statusCode: 404 }
  | { kind: 'error'; statusCode: number | null; errorKind: 'http' | 'abort' | 'network'; error?: unknown };

export const PUBLIC_CARD_CACHE_FRESH_TTL_MS = 60 * 60 * 1000;
export const PUBLIC_CARD_CACHE_HARD_TTL_MS = 24 * 60 * 60 * 1000;
export const PUBLIC_CARD_CACHE_NEGATIVE_TTL_MS = 3 * 60 * 1000;
export const PUBLIC_CARD_CACHE_MAX_CARD_ENTRIES = 256;
export const PUBLIC_CARD_CACHE_MAX_NEGATIVE_ENTRIES = 128;
