import type { PublicCardFetchResult } from '@/lib/public-card-cache/types';

export type PublicDataCardApiFetchLike = (input: string, init?: RequestInit) => Promise<Response>;

type PublicDataCardApiPayload = {
  success?: boolean;
  card?: unknown;
  error?: string;
};

export const fetchPublicDataCardRowById = async (
  cardId: string,
  options?: {
    fetcher?: PublicDataCardApiFetchLike;
  },
): Promise<PublicCardFetchResult> => {
  const normalizedId = cardId.trim();
  if (!normalizedId) {
    return {
      kind: 'error',
      statusCode: null,
      errorKind: 'network',
      error: new Error('cardId is required'),
    };
  }

  try {
    const response = await (options?.fetcher ?? fetch)(`/api/public-data-cards?id=${encodeURIComponent(normalizedId)}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        return { kind: 'not-found', statusCode: 404 };
      }

      return {
        kind: 'error',
        statusCode: response.status,
        errorKind: 'http',
      };
    }

    const payload = (await response.json().catch(() => null)) as PublicDataCardApiPayload | null;
    if (payload?.success && payload.card != null) {
      return {
        kind: 'success',
        card: payload.card,
      };
    }

    if (payload?.error === 'PUBLIC_CARD_NOT_FOUND') {
      return { kind: 'not-found', statusCode: 404 };
    }

    return {
      kind: 'error',
      statusCode: response.status,
      errorKind: 'http',
      error: payload,
    };
  } catch (error) {
    const errorName = error instanceof Error ? error.name : '';
    return {
      kind: 'error',
      statusCode: null,
      errorKind: errorName === 'AbortError' ? 'abort' : 'network',
      error,
    };
  }
};
