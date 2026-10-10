import { describe, expect, it } from 'vitest';
import {
  buildBattleStoryExportChapterMarkdown,
  createBattleStoryExportMarkdownWriter,
  projectBattleStoryExportChapter,
} from '../src/arena-story-export';

const session = { id: 'session', title: '故事', source: { mode: 'daily', language: 'zh-CN' } };
const results = [{ depth: 0, description: '事件', type: 'binary', roll: 1, outcome: '成功', details: '' }];

describe('incremental story Markdown writer', () => {
  it('empty chunks do not consume the first-chapter separator or add trailing whitespace', () => {
    const writer = createBattleStoryExportMarkdownWriter(session, 5);
    expect(writer.header).toBe('# 故事\n> 模式：daily｜语言：zh-CN｜章节数：5 章\n> 会话 ID：session\n---');
    expect(writer.writeChapter({ markdown: ' \r\n\t' })).toBe('');
    expect(writer.writeChapter({ markdown: ' 一 ' })).toBe('\n一');
    expect(writer.writeChapter({ markdown: '' })).toBe('');
    expect(writer.writeChapter({ markdown: '\n二\n' })).toBe('\n\n---\n\n二');
    expect(writer.writeChapter({ markdown: ' ' })).toBe('');
  });

  it('whitespace summary retains its old heading even when no chapter block is emitted', () => {
    const writer = createBattleStoryExportMarkdownWriter({ ...session, sessionSummary: ' \n' }, 0);
    expect(writer.header.endsWith('\n## 会话摘要\n---')).toBe(true);
  });

  it('captures the header when opened, with no shared separator state across exports', () => {
    const mutable = { ...session };
    const first = createBattleStoryExportMarkdownWriter(mutable, 1);
    mutable.title = '已更新';
    const second = createBattleStoryExportMarkdownWriter(mutable, 1);
    expect(first.header).toContain('# 故事\n');
    expect(second.header).toContain('# 已更新\n');
    expect(first.writeChapter({ markdown: '甲' })).toBe('\n甲');
    expect(second.writeChapter({ markdown: '乙' })).toBe('\n乙');
  });

  it('preserves empty-body adjudication leading newlines and does not mutate result entries', () => {
    const projected = projectBattleStoryExportChapter({ markdown: ' ', cardSnapshot: { adjudicationResults: results } });
    expect(projected.adjudicationResults).toBe(results);
    expect(buildBattleStoryExportChapterMarkdown(projected)).toBe('\n\n---\n\n## 随机判定记录\n- **事件**: 事件\n  - **结果**: 成功');
  });

  it.each([undefined, null, 3, 'snapshot', {}, [], { adjudicationResults: 'bad' }, { adjudicationResults: {} }])(
    'projects only array adjudicationResults from the stored snapshot (%j)',
    (cardSnapshot) => {
      expect(projectBattleStoryExportChapter({ markdown: ' 正文 ', cardSnapshot })).toEqual({ markdown: ' 正文 ', adjudicationResults: null });
    },
  );

  it('keeps original helper filtering and existing-H2 de-duplication', () => {
    const invalid = [null, { description: ' ', outcome: '成功' }, { description: '事件', outcome: '' }];
    const chapter = projectBattleStoryExportChapter({ markdown: ' 正文 ', cardSnapshot: { adjudicationResults: invalid } });
    expect(chapter.adjudicationResults).toBe(invalid);
    expect(buildBattleStoryExportChapterMarkdown(chapter)).toBe('正文');
    expect(buildBattleStoryExportChapterMarkdown({ markdown: '\n## 随机判定记录\n旧记录\n', adjudicationResults: results }))
      .toBe('## 随机判定记录\n旧记录');
  });

  it('can consume asynchronous pages with blank chapters at page boundaries', async () => {
    const writer = createBattleStoryExportMarkdownWriter(session, 53);
    async function* pages() {
      for (let start = 1; start <= 53; start += 25) {
        await Promise.resolve();
        yield Array.from({ length: Math.min(25, 54 - start) }, (_, offset) => start + offset);
      }
    }
    const chunks = [writer.header];
    for await (const page of pages()) {
      for (const index of page) chunks.push(writer.writeChapter({ markdown: index % 25 === 0 ? ' ' : `第${index}章 🌟` }));
    }
    const bodies = Array.from({ length: 53 }, (_, offset) => offset + 1)
      .filter((index) => index % 25 !== 0).map((index) => `第${index}章 🌟`);
    expect(chunks.join('')).toBe(`${writer.header}\n${bodies.join('\n\n---\n\n')}`);
  });
});

describe('streaming writer resource proof', () => {
  const bytes = (text: string) => new TextEncoder().encode(text).byteLength;
  it('enumerates every fixed marker below the native 64-per-item/chapter and 4096-header allowance', () => {
    expect(bytes('- **事件**: ' + '\n' + '  - **结果**: ' + ' (' + ')' + '\n')).toBe(35);
    expect(bytes('\n\n---\n\n' + '\n\n---\n\n' + '## 随机判定记录\n')).toBe(36);
    const full = { ...session, title: ' 标题🙂𠮷\ud800 ', branchLabel: '标签', branchOf: { sessionId: 'parent', chapterId: 'parent-chapter', chapterIndex: Number.MAX_SAFE_INTEGER, chapterTitle: '来源' }, sessionSummary: ' 摘要\n', chapterPlan: { totalChapters: 20, source: 'user' as const, locked: false } };
    const writer = createBattleStoryExportMarkdownWriter(full, Number.MAX_SAFE_INTEGER);
    expect(bytes(writer.header)).toBeLessThan(bytes(JSON.stringify(full)) + 4096);
    const chapter = { markdown: ' \n正文🙂𠮷\u0000\ud800 ', adjudicationResults: Array.from({ length: 100 }, (_, index) => ({ ...results[0]!, depth: index % 21, description: `描述🙂${index}`, outcome: '成功', details: '完整详情' })) };
    const parts = [...writer.writeChapterParts(chapter)];
    const materialized = parts.map((part) => typeof part === 'string' ? part : ' '.repeat(part.spaces)).join('');
    const second = createBattleStoryExportMarkdownWriter(full, Number.MAX_SAFE_INTEGER);
    expect(materialized).toBe(second.writeChapter(chapter));
    const bound = bytes(JSON.stringify(full)) + bytes(JSON.stringify(chapter)) + 4096 + 64 * (1 + chapter.adjudicationResults.length) + 4 * chapter.adjudicationResults.reduce((sum, item) => sum + item.depth, 0);
    expect(bytes(writer.header) + bytes(materialized)).toBeLessThanOrEqual(bound);
  });
  it('keeps safe but huge indentation numeric and diagnoses unsafe dimensions before allocation', () => {
    const writer = createBattleStoryExportMarkdownWriter(session, 1);
    const huge = [...writer.writeChapterParts({ markdown: '', adjudicationResults: [{ ...results[0]!, depth: 1_000_000_000_000_000 }] })];
    expect(huge.filter((part) => typeof part !== 'string')).toEqual([{ spaces: 2_000_000_000_000_000 }, { spaces: 2_000_000_000_000_000 }]);
    expect(() => [...writer.writeChapterParts({ markdown: '', adjudicationResults: [{ ...results[0]!, depth: Number.MAX_SAFE_INTEGER }] })]).toThrow('安全字节长度');
  });
});
