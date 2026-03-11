import type { BattleStorySessionAction } from '@/lib/ai-session/battle-story/types';

export type BattleStoryGenerateNextRecentChapter = {
  id: string;
  index: number;
};

export type BattleStoryGenerateNextValidationInput = {
  action: BattleStorySessionAction;
  sourceChapterId?: string;
  chapterIndex?: number;
  recentChapters: BattleStoryGenerateNextRecentChapter[];
};

export type BattleStoryGenerateNextValidationResult =
  | {
      ok: true;
      chapterIndex: number;
    }
  | {
      ok: false;
      error: string;
    };

const getSortedRecentChapters = (
  chapters: BattleStoryGenerateNextRecentChapter[]
): BattleStoryGenerateNextRecentChapter[] => {
  return [...chapters].sort((left, right) => left.index - right.index);
};

export const validateBattleStoryGenerateNextInput = (
  input: BattleStoryGenerateNextValidationInput
): BattleStoryGenerateNextValidationResult => {
  const recentChapters = getSortedRecentChapters(input.recentChapters);
  const latestChapter = recentChapters[recentChapters.length - 1] ?? null;
  const sourceChapter = input.sourceChapterId
    ? recentChapters.find((chapter) => chapter.id === input.sourceChapterId) ?? null
    : null;

  if (input.action === 'start') {
    if (recentChapters.length > 0) {
      return { ok: false, error: 'start 只允许用于空会话' };
    }
    if (input.sourceChapterId) {
      return { ok: false, error: 'start 不允许携带 sourceChapterId' };
    }
    if (typeof input.chapterIndex === 'number' && input.chapterIndex !== 1) {
      return { ok: false, error: 'start 的 chapterIndex 必须为 1' };
    }
    return { ok: true, chapterIndex: 1 };
  }

  if (!latestChapter) {
    return { ok: false, error: `${input.action} 需要至少一章已有上下文` };
  }

  if (input.action === 'continue') {
    const expectedChapterIndex = latestChapter.index + 1;
    if (input.sourceChapterId && input.sourceChapterId !== latestChapter.id) {
      return { ok: false, error: 'continue 只能基于当前会话的最后一章继续' };
    }
    if (typeof input.chapterIndex === 'number' && input.chapterIndex !== expectedChapterIndex) {
      return { ok: false, error: `continue 的 chapterIndex 必须为 ${expectedChapterIndex}` };
    }
    return { ok: true, chapterIndex: expectedChapterIndex };
  }

  if (input.action === 'branch') {
    if (!input.sourceChapterId) {
      return { ok: false, error: 'branch 必须指定 sourceChapterId' };
    }
    if (!sourceChapter) {
      return { ok: false, error: 'branch 的 sourceChapterId 不在当前上下文中' };
    }
    const expectedChapterIndex = sourceChapter.index + 1;
    if (typeof input.chapterIndex === 'number' && input.chapterIndex !== expectedChapterIndex) {
      return { ok: false, error: `branch 的 chapterIndex 必须为 ${expectedChapterIndex}` };
    }
    return { ok: true, chapterIndex: expectedChapterIndex };
  }

  if (!input.sourceChapterId) {
    return { ok: false, error: 'rewrite 必须指定 sourceChapterId' };
  }
  if (!sourceChapter) {
    return { ok: false, error: 'rewrite 的 sourceChapterId 不在当前上下文中' };
  }
  if (sourceChapter.id !== latestChapter.id) {
    return { ok: false, error: 'rewrite 只允许重写当前会话的最后一章' };
  }
  if (typeof input.chapterIndex === 'number' && input.chapterIndex !== latestChapter.index) {
    return { ok: false, error: `rewrite 的 chapterIndex 必须为 ${latestChapter.index}` };
  }

  return { ok: true, chapterIndex: latestChapter.index };
};
