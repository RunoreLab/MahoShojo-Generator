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
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAlUlEQVR4nO3QMQEAAAjDMPybBhk5aBVsmZ193fP7AQQQgB6gC0AP0AWgB+gC0AN0AegBugD0AF0AeoAuAD1AF4AeoAtAD9AFoAfoAtADdAHoAboA9ABdAHqALgA9QBeAHqALQA/QBaAH6ALQA3QB6AG6APQAXQB6gC4APUAXgB6gC0AP0AWgB+gC0AN0AegBugD0AN0BRU7CswKQQdYAAAAASUVORK5CYII=';

const DEFAULT_TAVERN_LOGO_SVG_PATH = '/logo.svg';
const DEFAULT_TAVERN_LOGO_WIDTH = 768;
const DEFAULT_TAVERN_LOGO_BG = '#ffffff';

let placeholderPngBytes: Uint8Array | null = null;

export function getPlaceholderPngBytes(): Uint8Array {
  if (!placeholderPngBytes) placeholderPngBytes = decodeBase64ToBytes(PLACEHOLDER_PNG_BASE64);
  return new Uint8Array(placeholderPngBytes);
}

let defaultBasePngPromise: Promise<Uint8Array> | null = null;

const parseViewBoxRatio = (svgText: string): number => {
  const match = svgText.match(/viewBox\\s*=\\s*\"([^\"]+)\"/i);
  if (!match) return 1;
  const parts = match[1]
    .trim()
    .split(/[\\s,]+/)
    .map((value) => Number.parseFloat(value))
    .filter((value) => Number.isFinite(value));
  if (parts.length < 4) return 1;
  const width = parts[2];
  const height = parts[3];
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 1;
  return height / width;
};

const loadImageFromBlobUrl = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('无法加载默认 Logo'));
    image.src = url;
  });

const canvasToPngBytes = async (canvas: HTMLCanvasElement): Promise<Uint8Array> => {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => (value ? resolve(value) : reject(new Error('默认底图导出失败'))), 'image/png');
  });
  const buffer = await blob.arrayBuffer();
  return new Uint8Array(buffer);
};

export async function getDefaultTavernBasePngBytes(): Promise<Uint8Array> {
  if (defaultBasePngPromise) return defaultBasePngPromise;
  defaultBasePngPromise = (async () => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return getPlaceholderPngBytes();
    }

    try {
      const response = await fetch(DEFAULT_TAVERN_LOGO_SVG_PATH, { cache: 'force-cache' });
      if (!response.ok) throw new Error('默认 Logo 获取失败');
      const svgText = await response.text();
      const ratio = parseViewBoxRatio(svgText);
      const width = DEFAULT_TAVERN_LOGO_WIDTH;
      const height = Math.max(1, Math.round(width * ratio));

      const svgBlob = new Blob([svgText], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(svgBlob);
      try {
        const image = await loadImageFromBlobUrl(url);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('默认底图渲染失败');
        ctx.fillStyle = DEFAULT_TAVERN_LOGO_BG;
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(image, 0, 0, width, height);
        return await canvasToPngBytes(canvas);
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch {
      return getPlaceholderPngBytes();
    }
  })();
  return defaultBasePngPromise;
}
