import { inferPvpCombatantTypeFromJson } from './logic';
import type { PvpCombatantType } from './types';

export interface LoadedPresetCard {
  filename: string;
  name: string;
  type: PvpCombatantType;
  data: unknown;
  dataJson: string;
}

const getPresetDisplayName = (data: any): string => {
  if (!data || typeof data !== 'object') return '未命名';
  return data.codename || data.name || data.title || '未命名';
};

const normalizePresetFilename = (input: string): string => {
  const raw = typeof input === 'string' ? input.trim() : '';
  if (!raw) throw new Error('缺少 preset filename');

  // 防止 path traversal / 非法路径（public/presets 下只允许文件名）
  if (raw.includes('/') || raw.includes('\\') || raw.includes('..') || raw.includes('?') || raw.includes('#')) {
    throw new Error('preset.filename 非法');
  }

  const withExt = raw.toLowerCase().endsWith('.json') ? raw : `${raw}.json`;

  // 进一步限制字符集，避免奇怪的编码导致路由兜底返回 HTML（从而触发 JSON 解析失败）
  if (!/^[a-zA-Z0-9._-]+\.json$/.test(withExt)) {
    throw new Error('preset.filename 非法');
  }

  return withExt;
};

const isJsonLike = (contentType: string | null, rawText: string): boolean => {
  const ct = (contentType || '').toLowerCase();
  if (ct.includes('text/html')) return false;
  if (ct.includes('application/json') || ct.includes('+json') || ct.includes('text/json')) return true;
  const trimmed = rawText.trimStart();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
};

export const loadPresetCard = async (origin: string, filename: string): Promise<LoadedPresetCard> => {
  const safeFilename = normalizePresetFilename(filename);

  const url = new URL(`/presets/${safeFilename}`, origin);
  const res = await fetch(url.toString(), { method: 'GET', headers: { Accept: 'application/json' } });

  const rawText = await res.text();
  if (!res.ok) {
    throw new Error(`无法读取预设卡: ${safeFilename}（HTTP ${res.status}）`);
  }

  if (!isJsonLike(res.headers.get('content-type'), rawText)) {
    const preview = rawText.trim().slice(0, 160);
    const contentType = res.headers.get('content-type') || 'unknown';
    throw new Error(`无法读取预设卡: ${safeFilename}（返回的不是 JSON，Content-Type: ${contentType}）${preview ? `\n预览：${preview}` : ''}`);
  }

  let data: unknown;
  try {
    data = JSON.parse(rawText) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'JSON 解析失败';
    const preview = rawText.trim().slice(0, 160);
    throw new Error(`无法读取预设卡: ${safeFilename}（JSON 解析失败：${message}）${preview ? `\n预览：${preview}` : ''}`);
  }

  const type: PvpCombatantType = inferPvpCombatantTypeFromJson(data);
  const name = getPresetDisplayName(data);
  const dataJson = JSON.stringify(data);

  return { filename: safeFilename, name, type, data, dataJson };
};
