import type { MagicTavernOutputSegment } from '@/lib/magic-tavern/types';

const normalizeTitle = (text: string): string => {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (!collapsed) return '';
  // 去掉常见 Markdown 标记
  const stripped = collapsed.replace(/^#+\s+/, '').replace(/[`*_~]/g, '').trim();
  return stripped;
};

const clampTitle = (text: string, maxChars: number): string => {
  const normalized = normalizeTitle(text);
  if (!normalized) return '';
  return normalized.length > maxChars ? `${normalized.slice(0, maxChars)}…` : normalized;
};

export const deriveMagicTavernTitle = (params: {
  outputFormat: 'jsonl' | 'markdown';
  content: string;
  segments?: MagicTavernOutputSegment[];
  scenarioTitle?: string;
  roleNames?: string[];
}): string => {
  const content = params.content || '';

  if (params.outputFormat === 'markdown') {
    const lines = content.split('\n').map((l) => l.trim()).filter(Boolean);
    const h1 = lines.find((line) => line.startsWith('# '));
    const title = clampTitle(h1 ? h1.slice(2) : (lines[0] ?? ''), 60);
    if (title) return title;
  } else {
    const segments = Array.isArray(params.segments) ? params.segments : [];
    const firstText =
      segments.find((seg) => seg.type === 'dialogue' || seg.type === 'narration')
        ? (() => {
          const seg = segments.find((s) => s.type === 'dialogue' || s.type === 'narration') as any;
          return typeof seg?.text === 'string' ? seg.text : '';
        })()
        : '';

    const candidate = firstText || content.split('\n').map((l) => l.trim()).filter(Boolean)[0] || '';
    const title = clampTitle(candidate, 60);
    if (title) return title;
  }

  const fallbackScenario = clampTitle(params.scenarioTitle ?? '', 60);
  if (fallbackScenario) return fallbackScenario;

  const roleNames = Array.isArray(params.roleNames) ? params.roleNames.filter(Boolean) : [];
  const fallbackRoles = clampTitle(roleNames.slice(0, 2).join(' · '), 60);
  if (fallbackRoles) return fallbackRoles;

  return '未命名会话';
};

