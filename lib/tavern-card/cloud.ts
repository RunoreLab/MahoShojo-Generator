import { getUtf8ByteLength, MAX_DATA_CARD_BYTES } from '@/lib/data-card-size';

export type TavernCloudSavePreset = 'standard' | 'light' | 'minimal';

export interface TavernCloudAuthorInfo {
  id: number;
  username: string;
}

export interface TavernCloudSaveBuildResult {
  data: unknown;
  estimatedBytes: number;
  overLimit: boolean;
  warnings: string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
};

const truncateText = (value: string, maxChars: number): string => {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars)}\n...[已截断]`;
};

const deepCloneJson = (value: unknown): unknown => {
  return JSON.parse(JSON.stringify(value)) as unknown;
};

export function estimateDataCardBytesAfterAuthorInjection(
  data: unknown,
  author: TavernCloudAuthorInfo
): number | null {
  try {
    const dataString = JSON.stringify(data);
    const parsed = JSON.parse(dataString) as unknown;
    const base = isRecord(parsed) ? parsed : {};
    const merged = { ...base, _author: author.username, _authorId: author.id };
    const mergedString = JSON.stringify(merged);
    return getUtf8ByteLength(mergedString);
  } catch {
    return null;
  }
}

const walkAndTruncateKnownKeys = (value: unknown, limits: Record<string, number | 'drop'>): unknown => {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((item) => walkAndTruncateKnownKeys(item, limits));
  if (!isRecord(value)) return value;

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    const next = walkAndTruncateKnownKeys(child, limits);
    if (typeof next === 'string' && Object.prototype.hasOwnProperty.call(limits, key)) {
      const limit = limits[key];
      if (limit === 'drop') {
        out[key] = '';
      } else {
        out[key] = truncateText(next, limit);
      }
      continue;
    }
    out[key] = next;
  }
  return out;
};

const trimTavernMetaMinimal = (value: unknown): { meta: unknown; trimmed: boolean } => {
  if (!isRecord(value)) return { meta: value, trimmed: false };

  const keepKeys = new Set(['extractedAt', 'sourceChunk', 'spec', 'specVersion', 'name', 'tags', 'warnings', 'sizes', 'candidates']);
  const next: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!keepKeys.has(key)) continue;
    next[key] = item;
  }
  return { meta: next, trimmed: true };
};

export function buildTavernCloudSavePayload(
  input: unknown,
  author: TavernCloudAuthorInfo,
  preset: TavernCloudSavePreset,
  options?: { maxBytes?: number }
): TavernCloudSaveBuildResult | { error: string } {
  const maxBytes = options?.maxBytes ?? MAX_DATA_CARD_BYTES;
  const warnings: string[] = [];

  let data: unknown;
  try {
    data = deepCloneJson(input);
  } catch (error) {
    return { error: error instanceof Error ? error.message : '无法序列化数据卡' };
  }

  if (isRecord(data)) {
    const tavern = data['_tavern'];
    if (isRecord(tavern) && Object.prototype.hasOwnProperty.call(tavern, 'raw')) {
      delete (tavern as Record<string, unknown>)['raw'];
      warnings.push('保存到云端时已强制移除 `_tavern.raw`（体积很大，仅建议本地保留）。');
    }

    if (preset === 'minimal') {
      const meta = isRecord(tavern) ? tavern['meta'] : null;
      const trimmed = trimTavernMetaMinimal(meta);
      if (trimmed.trimmed && isRecord(tavern)) {
        tavern['meta'] = trimmed.meta;
        warnings.push('已对 `_tavern.meta` 进行轻量化（移除 description/personality/mesExample 等大字段）。');
      }
    }
  }

  if (preset === 'light' || preset === 'minimal') {
    const limits: Record<string, number | 'drop'> =
      preset === 'light'
        ? {
            content: 20_000,
            description: 8_000,
            personality: 8_000,
            scenario: 6_000,
            first_mes: 2_000,
            firstMes: 2_000,
            mes_example: 12_000,
            mesExample: 12_000,
            predictionBasis: 12_000,
            researcherNotes: 12_000,
          }
        : {
            content: 12_000,
            description: 6_000,
            personality: 6_000,
            scenario: 4_000,
            first_mes: 2_000,
            firstMes: 2_000,
            mes_example: 'drop',
            mesExample: 'drop',
            predictionBasis: 8_000,
            researcherNotes: 8_000,
          };

    data = walkAndTruncateKnownKeys(data, limits);
  }

  const estimatedBytes = estimateDataCardBytesAfterAuthorInjection(data, author);
  if (estimatedBytes === null) {
    return { error: '无法计算写入大小（数据可能无法序列化）' };
  }

  return {
    data,
    estimatedBytes,
    overLimit: estimatedBytes > maxBytes,
    warnings,
  };
}
