import {
  formatBattleStoryChapterProgress,
  type BattleStoryChapterPlan,
} from './arena-battle-story-session';
import { hasAdjudicationRecordSection, iterateAdjudicationRecordMarkdownParts, materializeAdjudicationMarkdownPart, type AdjudicationMarkdownPart } from './arena-adjudication-markdown';
import type { AdjudicationResult } from './arena-types';

/** 导出只读投影；不要求宿主加载 seed、checkpoint 或其它章节正文。 */
export type BattleStoryExportSession = {
  id: string;
  title: string;
  source: { mode: string; language: string };
  chapterPlan?: BattleStoryChapterPlan | null;
  branchLabel?: string;
  branchOf?: {
    sessionId: string;
    chapterId: string;
    chapterIndex: number;
    chapterTitle?: string;
  };
  sessionSummary?: string;
};

export type BattleStoryExportChapter = {
  markdown: string;
  /** 与旧卡片 resolver 一致：只取 cardSnapshot 的判定，不从 reportJson 猜测。 */
  adjudicationResults?: AdjudicationResult[] | null;
};

/** 仅提取旧导出实际使用的 snapshot 判定；reportJson 不提供此字段的 fallback。 */
export const projectBattleStoryExportChapter = (chapter: {
  markdown: string;
  cardSnapshot?: unknown;
}): BattleStoryExportChapter => {
  const snapshot = chapter.cardSnapshot;
  const results = snapshot && typeof snapshot === 'object'
    ? (snapshot as { adjudicationResults?: unknown }).adjudicationResults
    : undefined;
  return {
    markdown: chapter.markdown,
    // 不过滤/归一化数组条目；仍由原判定 Markdown helper 处理。
    adjudicationResults: Array.isArray(results) ? results : null,
  };
};

export const buildBattleStoryExportHeaderMarkdown = (
  session: BattleStoryExportSession,
  activeChapterCount: number,
): string => {
  const title = typeof session.title === 'string' ? session.title.trim() : '';
  const header = [
    `# ${title || '未命名连续战报'}`,
    '',
    `> 模式：${session.source.mode}｜语言：${session.source.language}｜${
      session.chapterPlan ? '章节进度' : '章节数'
    }：${formatBattleStoryChapterProgress({
      completedChapterCount: activeChapterCount,
      chapterPlan: session.chapterPlan,
    })}`,
    `> 会话 ID：${session.id}`,
  ];

  if (session.branchLabel) {
    header.push(`> 分支标签：${session.branchLabel}`);
  }

  if (session.branchOf?.sessionId && session.branchOf?.chapterId) {
    header.push(
      `> 分支来源：${session.branchOf.sessionId} / ${session.branchOf.chapterId} / 第 ${session.branchOf.chapterIndex} 章${
        session.branchOf.chapterTitle ? `《${session.branchOf.chapterTitle}》` : ''
      }`
    );
  }
  if (session.sessionSummary) {
    header.push('');
    header.push('## 会话摘要');
    header.push(session.sessionSummary.trim());
  }

  // 保留旧完整导出 filter(Boolean) 的空行行为，包括仅空白摘要留下标题。
  return [...header, '', '---'].filter(Boolean).join('\n');
};

export type BattleStoryMarkdownPart = AdjudicationMarkdownPart;
export function* iterateBattleStoryExportChapterParts(
  chapter: BattleStoryExportChapter,
): Generator<BattleStoryMarkdownPart> {
  const baseMarkdown = chapter.markdown.trim();
  const adjudication = hasAdjudicationRecordSection(baseMarkdown)
    ? [][Symbol.iterator]() : iterateAdjudicationRecordMarkdownParts(chapter.adjudicationResults);
  const first = adjudication.next();
  if (baseMarkdown) yield baseMarkdown;
  if (!first.done) {
    yield '\n\n---\n\n'; yield first.value;
    yield* adjudication;
  }
}
export const buildBattleStoryExportChapterMarkdown = (
  chapter: BattleStoryExportChapter,
): string => Array.from(iterateBattleStoryExportChapterParts(chapter), materializeAdjudicationMarkdownPart).join('');

/**
 * 先写 header，再顺序写每次 writeChapter 的结果；结束时不补换行。
 * count 包含空白有效章，separator 只计算非空章块。宿主负责固定 head、筛选有效章、
 * 排序与完整性检查。writer 只保留分隔符状态，可跨异步分页且不积累已写正文。
 */
export const createBattleStoryExportMarkdownWriter = (
  session: BattleStoryExportSession,
  activeChapterCount: number,
): Readonly<{
  header: string;
  writeChapter: (chapter: BattleStoryExportChapter) => string;
  writeChapterParts: (chapter: BattleStoryExportChapter) => Iterable<BattleStoryMarkdownPart>;
}> => {
  let hasChapter = false;
  const writeChapterParts = function* (chapter: BattleStoryExportChapter): Generator<BattleStoryMarkdownPart> {
    const parts = iterateBattleStoryExportChapterParts(chapter);
    const first = parts.next();
    if (first.done) return;
    const separator = hasChapter ? '\n\n---\n\n' : '\n';
    hasChapter = true;
    yield separator; yield first.value; yield* parts;
  };
  return {
    header: buildBattleStoryExportHeaderMarkdown(session, activeChapterCount),
    writeChapterParts,
    writeChapter: (chapter) => Array.from(writeChapterParts(chapter), materializeAdjudicationMarkdownPart).join(''),
  };
};
