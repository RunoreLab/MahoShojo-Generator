import { normalizeScenarioPresetFilename } from '@/lib/scenario-presets';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const isJsonLike = (contentType: string | null, rawText: string): boolean => {
  const ct = (contentType || '').toLowerCase();
  if (ct.includes('text/html')) return false;
  if (ct.includes('application/json') || ct.includes('+json') || ct.includes('text/json')) return true;
  const trimmed = rawText.trimStart();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
};

export const loadScenarioPresetPayload = async (
  origin: string,
  filename: string,
  forwardHeaders?: HeadersInit
): Promise<Record<string, unknown>> => {
  const safeFilename = normalizeScenarioPresetFilename(filename);
  const url = new URL(`/scenario-presets/${safeFilename}`, origin);
  const headers = new Headers(forwardHeaders);
  headers.set('Accept', 'application/json');
  const res = await fetch(url.toString(), { method: 'GET', headers });

  const rawText = await res.text();
  if (!res.ok) {
    throw new Error(`无法读取预设情景: ${safeFilename}（HTTP ${res.status}）`);
  }
  if (!isJsonLike(res.headers.get('content-type'), rawText)) {
    const preview = rawText.trim().slice(0, 160);
    const contentType = res.headers.get('content-type') || 'unknown';
    throw new Error(`无法读取预设情景: ${safeFilename}（返回的不是 JSON，Content-Type: ${contentType}）${preview ? `\n预览：${preview}` : ''}`);
  }

  let data: unknown;
  try {
    data = JSON.parse(rawText) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'JSON 解析失败';
    const preview = rawText.trim().slice(0, 160);
    throw new Error(`无法读取预设情景: ${safeFilename}（JSON 解析失败：${message}）${preview ? `\n预览：${preview}` : ''}`);
  }

  if (!isRecord(data)) {
    throw new Error(`预设情景内容损坏（不是有效 JSON 对象）: ${safeFilename}`);
  }

  return data;
};

