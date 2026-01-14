import { encodeBytesToBase64, decodeBase64ToBytes } from './base64';
import { replacePngTextChunks } from './png';
import type { TavernCardV3, TavernCardV3Data, TavernWriteOptions } from './types';

const DEFAULT_CREATOR = 'github.com/colasama/MahoShojo-Generator';
const DEFAULT_CHARACTER_VERSION = '0.6.0';

const asString = (value: unknown): string => (typeof value === 'string' ? value : '');

const asStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean);
};

export function createTavernV3Card(data: TavernCardV3Data): TavernCardV3 {
  const talkativeness = typeof data.extensions?.talkativeness === 'number' ? data.extensions.talkativeness : 0.5;
  const fav = typeof data.extensions?.fav === 'boolean' ? data.extensions.fav : false;

  const payload: TavernCardV3Data = {
    name: asString(data.name) || '未命名角色',
    description: asString(data.description) || '',
    personality: asString(data.personality) || '',
    scenario: asString(data.scenario) || '',
    first_mes: asString(data.first_mes) || '',
    mes_example: asString(data.mes_example) || '',
    creator_notes: asString(data.creator_notes) || '',
    system_prompt: asString(data.system_prompt) || '',
    post_history_instructions: asString(data.post_history_instructions) || '',
    tags: asStringArray(data.tags),
    creator: asString(data.creator) || DEFAULT_CREATOR,
    character_version: asString(data.character_version) || DEFAULT_CHARACTER_VERSION,
    alternate_greetings: asStringArray(data.alternate_greetings),
    group_only_greetings: asStringArray(data.group_only_greetings),
    extensions: {
      talkativeness,
      fav,
      ...(data.extensions ?? {}),
    },
    character_book: data.character_book ?? { name: '', entries: [] },
  };

  const card: TavernCardV3 = {
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: payload,
    name: payload.name,
    description: payload.description,
    personality: payload.personality,
    scenario: payload.scenario,
    first_mes: payload.first_mes,
    mes_example: payload.mes_example,
    creatorcomment: payload.creator_notes,
    talkativeness: talkativeness,
    fav: fav,
    tags: payload.tags,
  };

  return card;
}

export function encodeTavernCardAsBase64Json(card: unknown): string {
  const json = JSON.stringify(card);
  const bytes = new TextEncoder().encode(json);
  return encodeBytesToBase64(bytes);
}

export function writeTavernCardToPngBytes(
  basePngBytes: Uint8Array,
  card: unknown,
  options?: TavernWriteOptions
): Uint8Array {
  const overwriteExisting = options?.overwriteExisting !== false;
  const includeCcv3Chunk = options?.includeCcv3Chunk !== false;
  const includeCharaChunk = options?.includeCharaChunk !== false;
  const base64 = encodeTavernCardAsBase64Json(card);

  const replacements: Array<{ keyword: string; text: string }> = [];
  if (includeCcv3Chunk) replacements.push({ keyword: 'ccv3', text: base64 });
  if (includeCharaChunk) replacements.push({ keyword: 'chara', text: base64 });
  return replacePngTextChunks(basePngBytes, replacements, { overwriteExisting });
}

const PLACEHOLDER_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMBAAq5fB8AAAAASUVORK5CYII=';

let placeholderPngBytes: Uint8Array | null = null;

export function getPlaceholderPngBytes(): Uint8Array {
  if (!placeholderPngBytes) placeholderPngBytes = decodeBase64ToBytes(PLACEHOLDER_PNG_BASE64);
  return new Uint8Array(placeholderPngBytes);
}

