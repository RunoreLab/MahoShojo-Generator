import type { MagicTeaPartyOutputSegment } from '@/lib/magic-tea-party/types';

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

const isBadTitleLine = (line: string): boolean => {
  const trimmed = line.trim();
  if (!trimmed) return true;
  if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) return true;
  if (/^jsonl$/i.test(trimmed)) return true;
  // JSON 片段或数组行通常不是好标题
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return true;
  return false;
};

const pickFirstTitleCandidateFromContent = (content: string): string => {
  const lines = content
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const candidate = lines.find((line) => !isBadTitleLine(line));
  return candidate ?? '';
};

export const deriveMagicTeaPartyTitle = (params: {
  outputFormat: 'jsonl' | 'markdown';
  content: string;
  segments?: MagicTeaPartyOutputSegment[];
  scenarioTitle?: string;
  roleNames?: string[];
}): string => {
  const content = params.content || '';

  if (params.outputFormat === 'markdown') {
    const lines = content.split('\n').map((l) => l.trim()).filter(Boolean);
    const h1 = lines.find((line) => line.startsWith('# '));
    const firstLine = lines.find((line) => !isBadTitleLine(line)) ?? '';
    const title = clampTitle(h1 ? h1.slice(2) : firstLine, 60);
    if (title) return title;
  } else {
    const segments = Array.isArray(params.segments) ? params.segments : [];
    const firstSeg = segments.find((seg) => {
      if (seg.type !== 'dialogue' && seg.type !== 'narration') return false;
      const text = typeof (seg as any)?.text === 'string' ? String((seg as any).text) : '';
      return !isBadTitleLine(text);
    }) as any;
    const firstText = typeof firstSeg?.text === 'string' ? firstSeg.text : '';

    const candidate = firstText || pickFirstTitleCandidateFromContent(content);
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
