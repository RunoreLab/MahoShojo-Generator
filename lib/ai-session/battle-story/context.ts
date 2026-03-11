import type {
  BattleStoryPromptChapterInput,
  BattleStoryPromptContextInput,
  BattleStoryPromptContextResult,
  BattleStoryPromptWindowItem,
} from '@/lib/ai-session/battle-story/types';

const DEFAULT_MAX_RECENT_CHAPTERS = 2;
const DEFAULT_MAX_FULL_CHAPTER_CHARS = 6000;
const DEFAULT_MAX_USER_GUIDANCE_CHARS = 800;

const normalizeText = (value: unknown): string => {
  return typeof value === 'string' ? value.trim() : '';
};

const truncateText = (text: string, maxChars: number): { text: string; truncated: boolean } => {
  if (text.length <= maxChars) return { text, truncated: false };
  return {
    text: `${text.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`,
    truncated: true,
  };
};

const safeJsonBlock = (value: unknown): string => {
  try {
    return JSON.stringify(value ?? null, null, 2);
  } catch {
    return '"[unserializable]"';
  }
};

const buildDigestText = (chapter: BattleStoryPromptChapterInput): string => {
  const digest = chapter.deterministicDigest;
  if (!digest) {
    return `第 ${chapter.index} 章：${normalizeText(chapter.title) || '未命名章节'}`;
  }

  const lines = [`第 ${chapter.index} 章：${digest.chapterTitle || normalizeText(chapter.title) || '未命名章节'}`];
  if (digest.winner) lines.push(`胜利者：${digest.winner}`);
  if (digest.officialConclusion) lines.push(`结论：${digest.officialConclusion}`);
  if (digest.bodyExcerpt) lines.push(`摘要：${digest.bodyExcerpt}`);
  if (Array.isArray(digest.impactDigest) && digest.impactDigest.length > 0) {
    lines.push(
      `角色影响：${digest.impactDigest
        .map((item) => {
          const fragments = [item.characterName];
          if (item.impact) fragments.push(`变化=${item.impact}`);
          if (item.currentStateSummary) fragments.push(`状态=${item.currentStateSummary}`);
          return fragments.join(' / ');
        })
        .join('；')}`
    );
  }
  return lines.join('\n');
};

export const resolveBattleStoryRecentWindow = (input: {
  chapters?: BattleStoryPromptChapterInput[];
  maxRecentChapters?: number;
  maxFullChapterChars?: number;
}): BattleStoryPromptWindowItem[] => {
  const chapters = Array.isArray(input.chapters) ? [...input.chapters] : [];
  if (chapters.length === 0) return [];

  const maxRecentChapters = Math.max(1, Math.floor(input.maxRecentChapters ?? DEFAULT_MAX_RECENT_CHAPTERS));
  const maxFullChapterChars = Math.max(500, Math.floor(input.maxFullChapterChars ?? DEFAULT_MAX_FULL_CHAPTER_CHARS));

  chapters.sort((left, right) => left.index - right.index);
  const fullStartIndex = Math.max(0, chapters.length - maxRecentChapters);

  return chapters.map((chapter, index) => {
    const title = normalizeText(chapter.title) || chapter.deterministicDigest?.chapterTitle || `第 ${chapter.index} 章`;

    if (index < fullStartIndex) {
      return {
        chapterId: chapter.id,
        chapterIndex: chapter.index,
        title,
        mode: 'digest',
        text: buildDigestText(chapter),
        truncated: false,
      };
    }

    const normalizedMarkdown = normalizeText(chapter.markdown);
    const fullText = normalizedMarkdown || buildDigestText(chapter);
    const { text, truncated } = truncateText(fullText, maxFullChapterChars);
    return {
      chapterId: chapter.id,
      chapterIndex: chapter.index,
      title,
      mode: 'full',
      text,
      truncated,
    };
  });
};

export const buildBattleStoryPromptContext = (
  input: BattleStoryPromptContextInput
): BattleStoryPromptContextResult => {
  const sections: BattleStoryPromptContextResult['sections'] = [];

  if (input.source || input.seed) {
    sections.push({
      key: 'seed',
      title: '固定种子层',
      text: safeJsonBlock({
        source: input.source ?? null,
        seed: input.seed ?? null,
      }),
    });
  }

  if (Array.isArray(input.workingCombatants) && input.workingCombatants.length > 0) {
    sections.push({
      key: 'current-state',
      title: '当前角色状态层',
      text: safeJsonBlock(input.workingCombatants),
    });
  }

  const sessionSummary = normalizeText(input.sessionSummary);
  if (sessionSummary) {
    sections.push({
      key: 'session-summary',
      title: '会话摘要层',
      text: sessionSummary,
    });
  }

  const recentWindow = resolveBattleStoryRecentWindow({
    chapters: input.recentChapters,
    maxRecentChapters: input.maxRecentChapters,
    maxFullChapterChars: input.maxFullChapterChars,
  });

  if (recentWindow.length > 0) {
    const recentWindowText = recentWindow
      .map((item) => {
        const heading = `### 第 ${item.chapterIndex} 章 ${item.title}（${item.mode === 'full' ? '全文' : '摘要'}）`;
        const body = item.truncated ? `${item.text}\n\n[本章内容已按上下文预算截断]` : item.text;
        return `${heading}\n${body}`;
      })
      .join('\n\n');

    sections.push({
      key: 'recent-window',
      title: '最近章节窗口层',
      text: recentWindowText,
    });
  }

  const normalizedUserGuidance = truncateText(
    normalizeText(input.userGuidance),
    Math.max(120, Math.floor(input.maxUserGuidanceChars ?? DEFAULT_MAX_USER_GUIDANCE_CHARS))
  ).text;

  if (normalizedUserGuidance) {
    sections.push({
      key: 'user-guidance',
      title: '本轮用户引导层',
      text: normalizedUserGuidance,
    });
  }

  const promptText = sections
    .map((section) => [`## ${section.title}`, section.text].join('\n'))
    .join('\n\n');

  return {
    normalizedUserGuidance,
    recentWindow,
    sections,
    promptText,
  };
};
