import { inferTemplate } from '@/lib/data-card-converter';

export interface BattleIllustrationAiImpact {
  characterName: string;
  impact?: string;
  currentStateSummary?: string;
}

export interface BattleIllustrationCombatant {
  type?: string;
  data?: Record<string, unknown> | null;
  filename?: string;
}

export interface BattleIllustrationPromptInput {
  headline?: string | null;
  reportBody?: string | null;
  reportMarkdown?: string | null;
  combatants?: BattleIllustrationCombatant[];
  aiImpacts?: BattleIllustrationAiImpact[] | null;
  tailMaxChars?: number;
  promptMaxChars?: number;
}

export interface BattleIllustrationPromptResult {
  prompt: string;
  appearanceLines: string[];
  reportTail: string;
  currentStateLines: string[];
  impactLines: string[];
  missingAppearance: boolean;
  missingAiImpacts: boolean;
}

const DEFAULT_TAIL_MAX_CHARS = 260;
const DEFAULT_PROMPT_MAX_CHARS = 3_000;
const PER_LINE_MAX_CHARS = 320;
const REPORT_TAIL_FALLBACK = '余波逐渐平息，双方在高低差空间中短暂停手对峙。';
const VISUAL_MOMENT_MAX_CHARS = 200;
const APPEARANCE_BLOCK_MAX_CHARS = 2_000;
const STATE_BLOCK_MAX_CHARS = 500;
const IMPACT_BLOCK_MAX_CHARS = 500;

const toSafeText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const truncateByCodePoints = (text: string, maxChars: number): string => {
  const safeMax = Math.max(0, Math.floor(maxChars));
  if (safeMax <= 0) return '';
  const arr = Array.from(text);
  if (arr.length <= safeMax) return text;
  return `${arr.slice(0, safeMax).join('')}…`;
};

const normalizeWhitespace = (text: string): string => {
  return text.replace(/\s+/g, ' ').trim();
};

const toCompactInlineText = (text: string): string => {
  return normalizeWhitespace(text)
    .replace(/[\n\r\t]+/g, ' ')
    .replace(/[【】\[\]{}（）()]/g, '')
    .replace(/[：:]+/g, '，')
    .replace(/[；;]+/g, '，')
    .replace(/\s*,\s*/g, '，')
    .replace(/，{2,}/g, '，')
    .trim();
};

const joinSummaryLines = (lines: string[], maxChars: number): string => {
  const merged = lines.map((line) => toCompactInlineText(line)).filter(Boolean).join('；');
  return truncateByCodePoints(merged, maxChars);
};

const extractVisualMoment = (raw: string, maxChars: number): string => {
  const normalized = toCompactInlineText(raw);
  if (!normalized) return REPORT_TAIL_FALLBACK;

  const sentenceCandidates = normalized
    .split(/[。！？!?]/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 6)
    .filter(
      (item) =>
        !/^(胜利者|获胜者|优胜者|最终结果|官方通报|记者点评|故事引导|角色行动引导|随机判定记录|随机判定结果)/.test(item)
    );

  if (sentenceCandidates.length === 0) {
    return truncateByCodePoints(normalized, maxChars);
  }

  const keyMoment = sentenceCandidates.slice(-2).join(' ');
  return truncateByCodePoints(keyMoment, maxChars);
};

const normalizeNameToken = (name: string): string => {
  return name
    .trim()
    .replace(/^[“”"'「」『』《》【】\[\]（）()]+|[“”"'「」『』《》【】\[\]（）()]+$/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();
};

const matchRosterName = (candidate: string, rosterNames: string[]): string | null => {
  const token = normalizeNameToken(candidate);
  if (!token) return null;

  const exact = rosterNames.find((name) => normalizeNameToken(name) === token);
  if (exact) return exact;

  const fuzzy = rosterNames.filter((name) => {
    const nameToken = normalizeNameToken(name);
    return nameToken.includes(token) || token.includes(nameToken);
  });
  return fuzzy.length === 1 ? fuzzy[0]! : null;
};

const getDisplayName = (data: Record<string, unknown>, fallback?: string): string => {
  return toSafeText(data.codename) || toSafeText(data.name) || toSafeText(data.title) || fallback || '未命名角色';
};

const joinNonEmpty = (parts: unknown[], separator = '，'): string => {
  return parts.map(toSafeText).filter(Boolean).join(separator);
};

const summarizeGeneralAppearance = (data: Record<string, unknown>): string => {
  const appearance = toSafeText(data.appearance);
  if (appearance) return appearance;
  const content = toSafeText(data.content);
  return content ? truncateByCodePoints(normalizeWhitespace(content), PER_LINE_MAX_CHARS) : '';
};

const summarizeMagicalGirlAppearance = (data: Record<string, unknown>): string => {
  const appearance = data.appearance;
  if (appearance && typeof appearance === 'object' && !Array.isArray(appearance)) {
    const appearanceRecord = appearance as Record<string, unknown>;
    const joined = joinNonEmpty(
      [appearanceRecord.outfit, appearanceRecord.accessories, appearanceRecord.colorScheme, appearanceRecord.overallLook],
      '，'
    );
    if (joined) return joined;
  }
  return toSafeText(appearance);
};

const summarizeCanshouAppearance = (data: Record<string, unknown>): string => {
  return joinNonEmpty([data.appearance, data.materialAndSkin, data.featuresAndAppendages], '，');
};

const summarizeCombatantAppearance = (combatant: BattleIllustrationCombatant): { name: string; summary: string } | null => {
  if (!combatant || typeof combatant !== 'object') return null;
  const data = combatant.data && typeof combatant.data === 'object' && !Array.isArray(combatant.data)
    ? (combatant.data as Record<string, unknown>)
    : null;
  if (!data) return null;

  const name = getDisplayName(data, combatant.filename || undefined);
  if (!name) return null;

  const template = (() => {
    if (combatant.type === 'magical-girl') return 'magical-girl';
    if (combatant.type === 'canshou') return 'canshou';
    if (combatant.type === 'general-character') return 'general';
    const inferred = inferTemplate(data);
    return inferred === 'unknown' ? 'general' : inferred;
  })();

  const summary = (() => {
    if (template === 'magical-girl') return summarizeMagicalGirlAppearance(data);
    if (template === 'canshou') return summarizeCanshouAppearance(data);
    return summarizeGeneralAppearance(data);
  })();

  const compactSummary = normalizeWhitespace(summary);
  if (!compactSummary) return null;

  return {
    name: truncateByCodePoints(name, 80),
    summary: truncateByCodePoints(compactSummary, PER_LINE_MAX_CHARS),
  };
};

const stripSimpleMarkdown = (text: string): string => {
  return text
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/\|/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const extractBodyFromMarkdown = (markdown: string): string => {
  const normalized = markdown.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const collected: string[] = [];
  let sawTitle = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (!sawTitle && /^#{1,3}\s+/.test(trimmed)) {
      sawTitle = true;
      continue;
    }

    if (sawTitle && /^#{1,6}\s+/.test(trimmed)) {
      const heading = trimmed.replace(/^#{1,6}\s+/, '').trim();
      if (/^(胜利者|获胜者|优胜者|最终结果|官方通报|记者点评|故事引导|角色行动引导|随机判定记录|随机判定结果)(?:\s|$)/.test(heading)) {
        break;
      }
    }

    if (!sawTitle && !trimmed) continue;
    collected.push(line);
  }

  const candidate = stripSimpleMarkdown(collected.join('\n'));
  if (candidate) return candidate;
  return stripSimpleMarkdown(markdown);
};

export const extractBattleReportTail = (input: {
  reportBody?: string | null;
  reportMarkdown?: string | null;
  maxChars?: number;
}): string => {
  const maxChars = Math.max(60, Math.floor(input.maxChars ?? DEFAULT_TAIL_MAX_CHARS));
  const body = toSafeText(input.reportBody);
  const markdown = toSafeText(input.reportMarkdown);
  const sourceText = body || (markdown ? extractBodyFromMarkdown(markdown) : '');
  const normalized = normalizeWhitespace(sourceText);
  if (!normalized) return REPORT_TAIL_FALLBACK;

  const chars = Array.from(normalized);
  if (chars.length <= maxChars) return normalized;
  return `…${chars.slice(chars.length - maxChars).join('')}`;
};

const normalizeAiImpacts = (
  aiImpacts: BattleIllustrationAiImpact[] | null | undefined,
  rosterNames: string[]
): BattleIllustrationAiImpact[] => {
  if (!Array.isArray(aiImpacts) || aiImpacts.length === 0) return [];

  const deduped = new Map<string, BattleIllustrationAiImpact>();
  for (const raw of aiImpacts) {
    if (!raw || typeof raw !== 'object') continue;
    const rawName = toSafeText(raw.characterName);
    if (!rawName) continue;
    const matchedName = matchRosterName(rawName, rosterNames) || rawName;
    const key = normalizeNameToken(matchedName) || matchedName;
    const impact = normalizeWhitespace(toSafeText(raw.impact));
    const currentStateSummary = normalizeWhitespace(toSafeText(raw.currentStateSummary));

    if (!deduped.has(key)) {
      deduped.set(key, {
        characterName: matchedName,
        ...(impact ? { impact: truncateByCodePoints(impact, PER_LINE_MAX_CHARS) } : {}),
        ...(currentStateSummary ? { currentStateSummary: truncateByCodePoints(currentStateSummary, PER_LINE_MAX_CHARS) } : {}),
      });
      continue;
    }

    const previous = deduped.get(key)!;
    deduped.set(key, {
      characterName: previous.characterName || matchedName,
      impact: previous.impact || (impact ? truncateByCodePoints(impact, PER_LINE_MAX_CHARS) : undefined),
      currentStateSummary:
        previous.currentStateSummary || (currentStateSummary ? truncateByCodePoints(currentStateSummary, PER_LINE_MAX_CHARS) : undefined),
    });
  }

  return Array.from(deduped.values());
};

export const buildBattleIllustrationPrompt = (input: BattleIllustrationPromptInput): BattleIllustrationPromptResult => {
  const headline = truncateByCodePoints(normalizeWhitespace(toSafeText(input.headline)), 120);
  const promptMaxChars = Math.max(1_000, Math.floor(input.promptMaxChars ?? DEFAULT_PROMPT_MAX_CHARS));

  const appearancePairs = Array.isArray(input.combatants)
    ? input.combatants
        .map(summarizeCombatantAppearance)
        .filter((item): item is { name: string; summary: string } => Boolean(item))
    : [];
  const appearanceLines = appearancePairs.map((item) => `${item.name}：${item.summary}`);

  const rosterNames = appearancePairs.map((item) => item.name);
  const normalizedImpacts = normalizeAiImpacts(input.aiImpacts, rosterNames);
  const currentStateLines = normalizedImpacts
    .map((item) => {
      if (!item.currentStateSummary) return '';
      return `${item.characterName}：${item.currentStateSummary}`;
    })
    .filter(Boolean);
  const impactLines = normalizedImpacts
    .map((item) => {
      if (!item.impact) return '';
      return `${item.characterName}：${item.impact}`;
    })
    .filter(Boolean);

  const reportTail = extractBattleReportTail({
    reportBody: input.reportBody,
    reportMarkdown: input.reportMarkdown,
    maxChars: input.tailMaxChars,
  });

  const appearanceSummary = joinSummaryLines(appearanceLines, APPEARANCE_BLOCK_MAX_CHARS);
  const currentStateSummary = joinSummaryLines(currentStateLines, STATE_BLOCK_MAX_CHARS);
  const impactSummary = joinSummaryLines(impactLines, IMPACT_BLOCK_MAX_CHARS);
  const visualMoment = extractVisualMoment(reportTail, VISUAL_MOMENT_MAX_CHARS);

  const sections: string[] = [];
  sections.push('风格标签：Xiabanmo，二次元，魔法少女，剧情插画，视觉小说关键帧，cinematic lighting，高质量，干净画面。');
  sections.push('硬性约束：单张插画，禁止出现任何文字、字母、数字、水印、Logo、字幕、对话框、UI 面板、海报排版、漫画分格。');
  if (headline) sections.push(`情绪关键词：${toCompactInlineText(headline)}`);
  if (appearanceSummary) sections.push(`角色外观：${appearanceSummary}`);
  sections.push(`关键瞬间：${visualMoment}`);
  if (currentStateSummary) sections.push(`角色情绪与姿态：${currentStateSummary}`);
  if (impactSummary) sections.push(`关系与气质暗示：${impactSummary}`);
  sections.push('镜头构图：突出故事结尾的动作停顿与情景，保留前后景和景深层次，视觉焦点集中在角色上。');
  sections.push('输出要求：仅输出插画画面，不要任何可读文本。');

  const joinedPrompt = sections.join('\n\n').trim();
  const prompt = truncateByCodePoints(joinedPrompt, promptMaxChars);

  return {
    prompt,
    appearanceLines,
    reportTail,
    currentStateLines,
    impactLines,
    missingAppearance: appearanceLines.length === 0,
    missingAiImpacts: currentStateLines.length === 0 && impactLines.length === 0,
  };
};
