import { describe, expect, test } from 'vitest';
import {
  createBattleStoryExportMarkdownWriter,
  projectBattleStoryExportChapter,
} from '@mahoshojo/domain/arena-story-export';
import { buildAdjudicationRecordMarkdown as domainAdjudicationMarkdown } from '@mahoshojo/domain/arena-adjudication-markdown';
import { buildAdjudicationRecordMarkdown as webAdjudicationMarkdown } from '@/lib/adjudicator/presentation';
import { buildBattleStoryExportMarkdown } from '@/components/arena/utils/battleStorySession';
import { battleStoryExportGoldenCases } from '../fixtures/battle-story-export-cases';
import golden from '../fixtures/battle-story-export.golden.json';

// golden 在提取之前由真实 Web buildBattleStoryExportMarkdown 生成；不复制旧算法作为测试 oracle。
describe('continuous story export preserves original Web bytes', () => {
  test.each(battleStoryExportGoldenCases)('$name', ({ name, session, chapters }) => {
    const expected = golden[name as keyof typeof golden];
    const originalOrder = chapters.map((chapter) => chapter.id);
    const web = buildBattleStoryExportMarkdown(session, chapters);
    const active = chapters.filter((chapter) => chapter.status !== 'superseded').sort((a, b) => a.index - b.index);
    const writer = createBattleStoryExportMarkdownWriter(session, active.length);
    // 与固定 head、跨分页调用一致：每次只交一章，不借用 Web snapshot resolver。
    const chunks = [writer.header];
    for (const chapter of active) chunks.push(writer.writeChapter(projectBattleStoryExportChapter(chapter)));
    expect(web).toBe(expected);
    expect(chunks.join('')).toBe(expected);
    expect(new TextEncoder().encode(chunks.join(''))).toEqual(new TextEncoder().encode(expected));
    expect(chapters.map((chapter) => chapter.id)).toEqual(originalOrder);
  });

  test('Web 判定构造继续回用下沉后的同一纯 helper', () => {
    expect(webAdjudicationMarkdown).toBe(domainAdjudicationMarkdown);
  });
});
