import { normalizeUsage, type UsageLike } from '@mahoshojo/hosted-runtime/node-runtime/usage';

export { normalizeUsage };
export type { UsageLike };

export interface ContentPreviewOptions {
  headChars: number;
  tailChars: number;
  ellipsis?: string;
}

const sliceByCodePoints = (text: string, start: number, end?: number) =>
  Array.from(text).slice(start, end).join('');

export function buildContentPreview(text: string, options: ContentPreviewOptions): string {
  const { headChars, tailChars, ellipsis = '……' } = options;
  const normalized = typeof text === 'string' ? text : '';
  const total = Array.from(normalized).length;

  const safeHead = Math.max(0, Math.floor(headChars));
  const safeTail = Math.max(0, Math.floor(tailChars));
  const keep = safeHead + safeTail;

  if (keep <= 0) return '';
  if (total <= keep) return normalized;

  const head = sliceByCodePoints(normalized, 0, safeHead);
  const tail = sliceByCodePoints(normalized, total - safeTail);
  return `${head}${ellipsis}${tail}`;
}

export function anonymizeIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const trimmed = ip.trim();
  if (!trimmed) return null;

  // IPv4
  const v4 = trimmed.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const parts = v4.slice(1).map(Number);
    if (parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
      return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
    }
  }

  // IPv6（粗粒度：保留前 4 个 hextet，后半段归零）
  // 说明：不做严格 RFC 解析，目标是“足够稳定的脱敏”，而非精确规范化。
  const hasColon = trimmed.includes(':');
  if (hasColon) {
    const normalized = trimmed.toLowerCase();
    const leading = normalized.split('::')[0] ?? '';
    const parts = leading.split(':').filter(Boolean);
    const head = parts.slice(0, 4).join(':');
    if (head) return `${head}::`;
  }

  return null;
}

export function getClientIpFromHeaders(headers: Headers): string | null {
  const cfIp = headers.get('cf-connecting-ip')?.trim();
  if (cfIp) return cfIp;

  const xff = headers.get('x-forwarded-for')?.trim();
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }

  const realIp = headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;

  return null;
}

export function extractHeadlineFromMarkdown(markdown: string | null | undefined): string | null {
  if (!markdown) return null;
  const lines = markdown.split(/\r?\n/).map((l) => l.trim());
  for (const line of lines) {
    if (!line) continue;
    const m = line.match(/^#{1,3}\s*(.+)$/);
    if (m?.[1]) return m[1].trim();
    // 非标题时，取第一行作为兜底
    return line.slice(0, 120);
  }
  return null;
}

export function extractWinnerFromText(text: string | null | undefined): string | null {
  if (!text) return null;

  const stripWinnerText = (raw: string): string => {
    return raw
      .trim()
      .replace(/^[\s"'“”‘’【】\[\]<>《》]+/g, '')
      .replace(/[\s"'“”‘’【】\[\]<>《》]+$/g, '')
      .trim();
  };

  const stripMarkdownDecorations = (raw: string): string => {
    let out = raw
      .replace(/^[>\-\*\+\s]+/g, '')
      .replace(/`/g, '')
      .trim();

    // 仅剥离“成对包裹”的 Markdown 修饰，避免把角色代号中的 "_" 误删（如 I_moly）。
    for (let i = 0; i < 3; i += 1) {
      const prev = out;
      out = out
        .replace(/^\*\*(.+)\*\*$/u, '$1')
        .replace(/^__(.+)__$/u, '$1')
        .replace(/^\*(.+)\*$/u, '$1')
        .replace(/^_(.+)_$/u, '$1')
        .replace(/^~~(.+)~~$/u, '$1')
        .trim();
      if (out === prev) break;
    }

    out = out.replace(/[*~]/g, '').replace(/\s+/g, ' ').trim();
    return out;
  };

  const extractWinnerFromInlineLabelLine = (rawLine: string): string | null => {
    const cleanedLine = stripMarkdownDecorations(rawLine.trim());
    if (!cleanedLine) return null;
    const matched = cleanedLine.match(/^(?:胜利者|胜者|赢家|winner)\s*[:：]\s*(.+)$/i);
    if (!matched?.[1]) return null;
    const cleaned = stripWinnerText(stripMarkdownDecorations(matched[1])).slice(0, 120);
    return cleaned || null;
  };

  // 兼容常见 Markdown 战报格式：
  // ## 胜利者
  // 白百合
  // （或 - 白百合）
  const lines = text.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => {
    const trimmed = (line ?? '').trim();
    if (!trimmed) return false;
    const cleaned = stripMarkdownDecorations(trimmed);
    return /^#{2,6}\s*(胜利者|胜者|赢家|winner)(?:\s|$)/i.test(cleaned);
  });
  if (headerIndex >= 0) {
    // 允许把胜者写在标题同一行：## 胜利者：白百合
    const headerLine = stripMarkdownDecorations(lines[headerIndex]?.trim() ?? '');
    const inline = headerLine.match(/^#{2,6}\s*(胜利者|胜者|赢家|winner)\s*[:：]\s*(.+)$/i);
    if (inline?.[2]) {
      const cleaned = stripWinnerText(stripMarkdownDecorations(inline[2])).slice(0, 120);
      return cleaned || null;
    }
    for (let i = headerIndex + 1; i < lines.length; i++) {
      const raw = (lines[i] ?? '').trim();
      if (!raw) continue;
      if (/^#{1,6}\s+/.test(raw)) return null;
      const cleaned = stripWinnerText(stripMarkdownDecorations(raw)).slice(0, 120);
      return cleaned || null;
    }
  }

  for (const line of lines) {
    const matched = extractWinnerFromInlineLabelLine(line);
    if (matched) return matched;
  }

  return null;
}

export function normalizeErrorMessage(errorMessage: unknown, maxChars: number = 300): string | null {
  if (typeof errorMessage !== 'string') return null;
  const trimmed = errorMessage.trim();
  if (!trimmed) return null;
  const safeMax = Math.max(0, Math.floor(maxChars));
  if (safeMax <= 0) return null;
  return trimmed.length <= safeMax ? trimmed : `${trimmed.slice(0, safeMax)}…`;
}

export function compactExtraJson(value: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  const out: Record<string, unknown> = {};

  for (const [key, raw] of Object.entries(value)) {
    if (raw === null || raw === undefined) continue;

    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (!trimmed) continue;
      out[key] = trimmed;
      continue;
    }

    if (Array.isArray(raw)) {
      if (raw.length === 0) continue;
      out[key] = raw;
      continue;
    }

    if (typeof raw === 'object') {
      if (Object.keys(raw as Record<string, unknown>).length === 0) continue;
      out[key] = raw;
      continue;
    }

    out[key] = raw;
  }

  return Object.keys(out).length > 0 ? out : null;
}

export function buildCombatantsFallbackForExtraJson(combatants: unknown): Array<Record<string, unknown>> | null {
  if (!Array.isArray(combatants) || combatants.length <= 0) return null;

  return combatants.map((c: any, index: number) => {
    const isPreset = typeof c?.isPreset === 'boolean' ? c.isPreset : null;
    const presetFilename =
      isPreset === true && typeof c?.filename === 'string' && c.filename.trim()
        ? c.filename.trim()
        : null;
    const templateId =
      presetFilename || (typeof c?.data?.templateId === 'string' && c.data.templateId.trim() ? c.data.templateId.trim() : null);
    const characterGuidance =
      typeof c?.characterGuidance === 'string' && c.characterGuidance.trim()
        ? c.characterGuidance.trim().slice(0, 100)
        : null;
    const compacted = compactExtraJson({
      sortIndex: index,
      name: c?.data?.codename || c?.data?.name || null,
      type: typeof c?.type === 'string' ? c.type : null,
      isNative: typeof c?.isNative === 'boolean' ? c.isNative : null,
      isPreset,
      filename: presetFilename,
      templateId,
      teamId: typeof c?.teamId === 'number' ? c.teamId : null,
      characterGuidance,
      dataCardId: typeof c?.sourceDataCardId === 'string' ? c.sourceDataCardId : null,
      dataCardUpdatedAt: typeof c?.sourceDataCardUpdatedAt === 'string' ? c.sourceDataCardUpdatedAt : null,
    });
    return compacted ?? { sortIndex: index };
  });
}
