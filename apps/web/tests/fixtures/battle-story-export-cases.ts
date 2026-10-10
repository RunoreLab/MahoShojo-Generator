import type {
  BattleStoryChapterRecord,
  BattleStorySessionRecord,
} from '@/lib/ai-session/battle-story/types';
import type { AdjudicationResult } from '@mahoshojo/domain/arena-types';

const session = (patch: Partial<BattleStorySessionRecord> = {}): BattleStorySessionRecord => ({
  id: 'session-golden',
  title: '连续故事',
  createdAt: 1,
  updatedAt: 1,
  source: { mode: 'classic', language: 'zh-CN', storyLength: 'standard', generationMode: 'stream' },
  seed: {
    combatants: [],
    settings: {
      readArenaHistory: false, writeArenaHistory: false,
      readCurrentState: false, writeCurrentState: false,
      readNarrativeHistory: false, writeNarrativeHistory: false,
    },
  },
  workingCombatants: [],
  // 必须以传入有效章计算导出数量，而非使用 session 上可能过时的计数。
  chapterCount: 99,
  ...patch,
});

const chapter = (index: number, markdown: string, patch: Partial<BattleStoryChapterRecord> = {}): BattleStoryChapterRecord => ({
  id: `chapter-${index}`,
  sessionId: 'session-golden',
  index,
  action: index === 1 ? 'start' : 'continue',
  status: 'active',
  title: `章节 ${index}`,
  markdown,
  reportJson: {},
  deterministicDigest: { chapterTitle: `章节 ${index}` },
  createdAt: index,
  ...patch,
});

const result = (patch: Partial<AdjudicationResult> = {}): AdjudicationResult => ({
  depth: 0,
  description: '  暴雨是否降临  ',
  type: 'binary',
  roll: 7,
  outcome: ' 大成功 ',
  details: ' 掷骰(7) vs 成功率(65%) ',
  ...patch,
});

export const battleStoryExportGoldenCases = [
  { name: 'empty-default-title', session: session({ title: '\t \n' }), chapters: [] },
  {
    name: 'whitespace-summary-and-empty-active-chapters',
    session: session({ sessionSummary: ' \t\r\n ' }),
    chapters: [chapter(2, '\r\n \t'), chapter(1, '')],
  },
  {
    name: 'trim-edges-preserve-interior-crlf-unicode',
    session: session({ title: '\n  星海 🌟  \r\n', sessionSummary: '\t 摘要甲\r\n\r\n摘要乙 \n' }),
    chapters: [chapter(1, '\n\t # 第一章\r\n\r\n正文 \u0000 星🌟  \n')],
  },
  {
    name: 'branch-plan-summary-preserve-untrimmed-metadata',
    session: session({
      chapterPlan: { totalChapters: 2, source: 'scenario', locked: true },
      branchLabel: ' 分支标签 ',
      branchOf: { sessionId: 'root', chapterId: 'old-3', chapterIndex: 3, chapterTitle: ' 破晓 ', createdAt: 0 },
      sessionSummary: ' 摘要\n\n后段 ',
    }),
    chapters: [chapter(1, ' 一 '), chapter(2, ' 二 '), chapter(3, ' 三 ')],
  },
  {
    name: 'superseded-filter-stable-index-order-empty-count',
    session: session(),
    chapters: [
      chapter(3, ' 三 '), chapter(1, ' 旧正文 ', { status: 'superseded' }),
      chapter(2, ' 二甲 ', { id: 'chapter-2-a' }), chapter(1, ' 一 '),
      chapter(2, ' 二乙 ', { id: 'chapter-2-b' }), chapter(4, ' \n '),
    ],
  },
  {
    name: 'append-nested-adjudication-and-skip-invalid-entries',
    session: session(),
    chapters: [chapter(1, ' # 正文\n\n段落 ', { cardSnapshot: { adjudicationResults: [
      result(), result({ depth: 2.9, description: ' 子事件 ', outcome: ' 失败 ', details: '' }),
      result({ depth: -1, description: '低于零', details: '   ' }),
      result({ depth: Number.NaN, description: '非有限深度' }),
      result({ description: ' ' }), result({ outcome: ' ' }),
    ] } })],
  },
  {
    name: 'empty-body-still-appends-adjudication-with-old-leading-separator',
    session: session(),
    chapters: [chapter(1, '\r\n \t', { cardSnapshot: { adjudicationResults: [result()] } })],
  },
  ...[
    ['existing-h2-adjudication', '# 正文\n\n## 随机判定记录\n已有记录'],
    ['existing-h2-crlf-adjudication', '# 正文\r\n##   随机判定记录  \r\n已有记录'],
    ['existing-h2-at-end', '##随机判定记录'],
    ['h3-does-not-suppress-append', '### 随机判定记录\n三级标题不是旧去重目标'],
    ['inline-h2-does-not-suppress-append', '正文中的 ## 随机判定记录\n仍须追加'],
  ].map(([name, markdown]) => ({
    name,
    session: session(),
    chapters: [chapter(1, markdown, { cardSnapshot: { adjudicationResults: [result()] } })],
  })),
  {
    name: 'report-json-does-not-supply-adjudication-fallback',
    session: session(),
    chapters: [chapter(1, '正文', { reportJson: { report: { headline: '报告标题' }, adjudicationResults: [result()] } })],
  },
  {
    name: 'all-superseded-and-partial-branch',
    session: session({ branchOf: { sessionId: 'root', chapterId: '', chapterIndex: 1, createdAt: 0 } }),
    chapters: [chapter(1, '不导出', { status: 'superseded', cardSnapshot: { adjudicationResults: [result()] } })],
  },
];
