import { SafeJsonValueSchema, type JsonValue } from '@mahoshojo/contracts/json-value';
import { GENERAL_CHARACTER_TEMPLATE_ID } from '../data-cards';
import { buildGeneralMarkdown } from './general';
import { MAX_TAVERN_FILE_BYTES, MAX_TAVERN_TEXT_BYTES } from './limits';
import { isLikelyTavernCard, normalizeTavernCard } from './normalize';
import { parseTavernCardFromPngBytes } from './parse';
import type { TavernCardCandidate, TavernParseResult } from './types';

export interface TavernLocalDocument {
  parsed?: TavernParseResult;
  candidates: TavernCardCandidate[];
  selectedIndex: number;
  warnings: string[];
  basePngBytes?: Uint8Array;
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Data-only validation: never evaluates embedded scripts, instructions or signature claims. */
export function validateTavernRaw(value: unknown): JsonValue {
  const parsed = SafeJsonValueSchema.safeParse(value);
  if (!parsed.success || !isLikelyTavernCard(value)) throw new Error('未识别到安全有效的酒馆角色卡 JSON。');
  if (new TextEncoder().encode(JSON.stringify(parsed.data)).length > MAX_TAVERN_TEXT_BYTES) throw new Error('酒馆 JSON 超过 4 MiB 上限。');
  return parsed.data;
}

export function readTavernLocalDocument(bytes: Uint8Array, format: 'png' | 'json'): TavernLocalDocument {
  if (bytes.length > MAX_TAVERN_FILE_BYTES) throw new Error('文件超过 32 MiB 上限。');
  if (format === 'png') {
    const result = parseTavernCardFromPngBytes(bytes);
    if ('code' in result) throw new Error(result.message);
    for (const candidate of result.candidates) validateTavernRaw(candidate.parsed);
    return { parsed: result, candidates: result.candidates, selectedIndex: result.candidates.indexOf(result.selected), warnings: result.meta.warnings, basePngBytes: bytes.slice() };
  }
  if (bytes.length > MAX_TAVERN_TEXT_BYTES) throw new Error('酒馆 JSON 超过 4 MiB 上限。');
  const input: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  // Only our explicitly preserved original is recoverable. Do not pretend edits to a converted
  // general card have been mapped back into the original Tavern fields.
  const isProjection = record(input) && input.templateId === GENERAL_CHARACTER_TEMPLATE_ID
    && typeof input.name === 'string' && typeof input.content === 'string' && !isLikelyTavernCard(input);
  const archived = isProjection && record(input._tavern) ? input._tavern.raw : undefined;
  const raw = validateTavernRaw(archived ?? input);
  return {
    candidates: [{ keyword: 'json', chunkType: 'tEXt', parseMethod: 'json', parsed: raw }],
    selectedIndex: 0,
    warnings: archived !== undefined ? ['已读取通用卡保留的酒馆原件；通用卡正文后续修改不会合并回原件。'] : [],
  };
}

/** Conversion is an unsigned projection, with the complete inert original retained separately. */
export function convertTavernToGeneralCard(candidate: TavernCardCandidate) {
  const raw = validateTavernRaw(candidate.parsed);
  const { normalized } = normalizeTavernCard(candidate);
  return {
    templateId: GENERAL_CHARACTER_TEMPLATE_ID,
    name: normalized.name,
    content: buildGeneralMarkdown(normalized),
    _tavern: { raw },
  };
}
