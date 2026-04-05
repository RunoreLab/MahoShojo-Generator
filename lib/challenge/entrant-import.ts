import {
  mapDataCardRuntimeSourceInfo,
  mapPublicDataCardRowToBattleSelectionPayload,
  stripBattleSelectionTransportMeta,
} from '@/lib/data-card-read-mappers';

export type ChallengeEntrantSourceMode =
  | 'demo'
  | 'database'
  | 'random'
  | 'file'
  | 'paste'
  | 'manual-json';

export type ChallengeEntrantSourceMeta = {
  dataCardId?: string;
  dataCardName?: string;
  dataCardAuthor?: string;
  isPublic?: boolean;
};

export type ChallengeEntrantImportResult = {
  card: Record<string, unknown>;
  sourceMode: ChallengeEntrantSourceMode;
  sourceMeta: ChallengeEntrantSourceMeta;
  editorText: string;
};

const SINGLE_CARD_ONLY_ERROR = 'challenge 当前只支持单卡入场';
const JSON_PARSE_ERROR = '角色卡 JSON 解析失败，请检查格式后重试';

const toRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const isLikelyJsonlObjects = (text: string): boolean => {
  const nonEmptyLines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  return nonEmptyLines.length > 1 && nonEmptyLines.every((line) => line.startsWith('{') && line.endsWith('}'));
};

const assertSingleCardRecord = (value: unknown): Record<string, unknown> => {
  if (Array.isArray(value)) {
    throw new Error(SINGLE_CARD_ONLY_ERROR);
  }

  const record = toRecord(value);
  if (!record) {
    throw new Error(JSON_PARSE_ERROR);
  }

  return record;
};

const buildEntrantImportResult = (
  selection: unknown,
  sourceMode: Extract<ChallengeEntrantSourceMode, 'database' | 'random'>
): ChallengeEntrantImportResult => {
  const sourceInfo = mapDataCardRuntimeSourceInfo(selection);
  const card = assertSingleCardRecord(stripBattleSelectionTransportMeta(selection));

  return {
    card,
    sourceMode,
    sourceMeta: {
      dataCardId: sourceInfo.sourceDataCardId,
      dataCardName: sourceInfo.sourceDataCardName,
      dataCardAuthor: sourceInfo.sourceAuthor,
      isPublic: sourceInfo.sourceIsPublic,
    },
    editorText: stringifyCharacterCardForEditor(card),
  };
};

export function createChallengeEntrantFromSelection(selection: unknown): ChallengeEntrantImportResult {
  return buildEntrantImportResult(selection, 'database');
}

export async function fetchRandomCharacterCard(
  fetcher: (input: string, init?: RequestInit) => Promise<Response> = fetch
): Promise<ChallengeEntrantImportResult> {
  const response = await fetcher('/api/random-public-card?type=character', {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });

  const payload = (await response.json().catch(() => null)) as { success?: boolean; error?: string; card?: unknown } | null;
  if (!response.ok || !payload?.success || !payload.card) {
    throw new Error(payload?.error || '随机匹配角色失败');
  }

  return buildEntrantImportResult(mapPublicDataCardRowToBattleSelectionPayload(payload.card), 'random');
}

export async function parseSingleCharacterCardFromText(text: string): Promise<Record<string, unknown>> {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error(JSON_PARSE_ERROR);
  }

  try {
    return assertSingleCardRecord(JSON.parse(trimmed));
  } catch (error) {
    if (error instanceof Error && error.message === SINGLE_CARD_ONLY_ERROR) {
      throw error;
    }

    if (/}\s*{/.test(trimmed) || isLikelyJsonlObjects(trimmed)) {
      throw new Error(SINGLE_CARD_ONLY_ERROR);
    }

    throw new Error(JSON_PARSE_ERROR);
  }
}

export function stringifyCharacterCardForEditor(card: unknown): string {
  return JSON.stringify(card, null, 2);
}
