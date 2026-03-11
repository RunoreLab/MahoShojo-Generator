import { describe, expect, test } from 'bun:test';

import {
  buildBattleStoryExportMarkdown,
  buildBattleStorySessionSeedSnapshot,
  cloneBattleStoryActiveChaptersForNewSession,
  mergeUpdatedCombatantsIntoWorkingCombatants,
  remapBattleStorySummaryMeta,
  resolveBattleStorySummaryRefreshPlan,
} from '@/components/arena/utils/battleStorySession';
import { createBattleStoryChapterRecord, createBattleStorySessionRecord } from '@/lib/ai-session/battle-story/storage';

describe('battle story session utils', () => {
  test('buildBattleStorySessionSeedSnapshot 会从竞技场状态提取稳定 seed', () => {
    const snapshot = buildBattleStorySessionSeedSnapshot({
      combatants: [
        {
          type: 'magical-girl',
          data: { codename: '白百合' },
          filename: '白百合.json',
          isValid: true,
          isPreset: false,
          teamId: 1,
          characterGuidance: '保护同伴',
          sourceDataCardId: 'card-1',
          sourceDataCardUpdatedAt: '2026-03-11',
        },
      ],
      battleMode: 'scenario',
      scenario: {
        content: { title: '废都决战' },
        fileName: '废都决战.json',
        isNative: true,
      },
      auxScenarios: [
        {
          id: 'aux-1',
          content: { title: '暴雨' },
          fileName: '暴雨.json',
          isNative: false,
        },
      ],
      selectedQuestionnaires: [
        {
          source: 'preset',
          questionnaire: {
            id: 'q-1',
            title: '基础设定',
            kind: 'magical-girl',
            questions: [],
            loreMarkdown: '角色关系与世界观',
          },
        },
      ],
      selectedLanguage: 'zh-CN',
      storyLength: 'long',
      settings: {
        readArenaHistory: true,
        readArenaHistoryLimit: 3,
        isArenaHistoryUnlimited: false,
        writeArenaHistory: true,
        readCurrentState: true,
        writeCurrentState: true,
        readNarrativeHistory: false,
        readNarrativeHistoryLimit: 10,
        isNarrativeHistoryUnlimited: false,
        writeNarrativeHistory: false,
        streamTransport: 'sse',
        userGuidance: '保持悬念',
      },
      providerMode: 'system',
      providerId: 'system',
      modelId: 'gemini-2.5-flash',
    });

    expect(snapshot.titleHint).toContain('废都决战');
    expect(snapshot.source.storyLength).toBe('long');
    expect(snapshot.seed.scenario).toEqual({ title: '废都决战' });
    expect(snapshot.seed.auxScenarios).toHaveLength(1);
    expect(snapshot.seed.questionnaires?.[0]?.loreMarkdown).toBe('角色关系与世界观');
    expect(snapshot.workingCombatants[0]?.characterGuidance).toBe('保护同伴');
  });

  test('mergeUpdatedCombatantsIntoWorkingCombatants 会按角色名合并更新结果', () => {
    const merged = mergeUpdatedCombatantsIntoWorkingCombatants(
      [
        { type: 'magical-girl', data: { codename: '白百合', hp: 100 } },
        { type: 'canshou', data: { name: '裂爪', hp: 80 } },
      ],
      [
        { codename: '白百合', hp: 60, current_state: { mood: '疲惫' } },
      ]
    );

    expect((merged[0]?.data as any)?.hp).toBe(60);
    expect((merged[1]?.data as any)?.hp).toBe(80);
  });

  test('resolveBattleStorySummaryRefreshPlan 会在新增章节达到阈值后返回摘要计划', () => {
    const session = createBattleStorySessionRecord({
      title: '连续战报',
      source: {
        mode: 'classic',
        language: 'zh-CN',
        storyLength: 'standard',
        generationMode: 'stream',
      },
      seed: {
        combatants: [{ name: '白百合' }],
        settings: {
          readArenaHistory: true,
          writeArenaHistory: true,
          readCurrentState: true,
          writeCurrentState: true,
          readNarrativeHistory: false,
          writeNarrativeHistory: false,
        },
      },
      workingCombatants: [{ name: '白百合' }],
      sessionSummary: '旧摘要',
      summaryMeta: {
        coveredUntilChapterIndex: 1,
        coveredChapterIds: ['chapter-1'],
        refreshedAt: 1,
        mode: 'ai',
      },
    });

    const chapters = [1, 2, 3, 4].map((index) =>
      createBattleStoryChapterRecord({
        sessionId: session.id,
        index,
        action: index === 1 ? 'start' : 'continue',
        title: `第${index}章`,
        markdown: `# 第${index}章\n\n正文`,
        reportJson: {},
        deterministicDigest: {
          chapterTitle: `第${index}章`,
          bodyExcerpt: `摘要 ${index}`,
        },
      })
    );

    chapters[0]!.id = 'chapter-1';

    const plan = resolveBattleStorySummaryRefreshPlan({
      session,
      chapters,
      minPendingChapters: 3,
    });

    expect(plan).not.toBeNull();
    expect(plan?.digests.map((item) => item.index)).toEqual([2, 3, 4]);
    expect(plan?.previousSummary).toBe('旧摘要');
  });

  test('cloneBattleStoryActiveChaptersForNewSession 与 remapBattleStorySummaryMeta 会同步重映射章节 ID', () => {
    const sourceSession = createBattleStorySessionRecord({
      title: '源会话',
      source: {
        mode: 'classic',
        language: 'zh-CN',
        storyLength: 'standard',
        generationMode: 'stream',
      },
      seed: {
        combatants: [{ name: '白百合' }],
        settings: {
          readArenaHistory: true,
          writeArenaHistory: true,
          readCurrentState: true,
          writeCurrentState: true,
          readNarrativeHistory: false,
          writeNarrativeHistory: false,
        },
      },
      workingCombatants: [{ name: '白百合' }],
      summaryMeta: {
        coveredUntilChapterIndex: 2,
        coveredChapterIds: ['old-1', 'old-2'],
        refreshedAt: 1,
        mode: 'ai',
      },
    });

    const chapter1 = createBattleStoryChapterRecord({
      sessionId: sourceSession.id,
      index: 1,
      action: 'start',
      title: '第一章',
      markdown: '# 第一章\n\n正文',
      reportJson: {},
      deterministicDigest: {
        chapterTitle: '第一章',
      },
    });
    chapter1.id = 'old-1';

    const chapter2 = createBattleStoryChapterRecord({
      sessionId: sourceSession.id,
      index: 2,
      action: 'continue',
      title: '第二章',
      markdown: '# 第二章\n\n正文',
      reportJson: {},
      deterministicDigest: {
        chapterTitle: '第二章',
      },
      sourceChapterId: chapter1.id,
    });
    chapter2.id = 'old-2';

    const cloned = cloneBattleStoryActiveChaptersForNewSession({
      chapters: [chapter1, chapter2],
      newSessionId: 'branch-session',
    });

    expect(cloned.chapters).toHaveLength(2);
    expect(cloned.chapters[0]?.sessionId).toBe('branch-session');
    expect(cloned.chapters[1]?.sourceChapterId).toBe(cloned.chapters[0]?.id);

    const remapped = remapBattleStorySummaryMeta(sourceSession.summaryMeta, cloned.chapterIdMap);
    expect(remapped?.coveredChapterIds).toEqual(cloned.chapters.map((chapter) => chapter.id));
  });

  test('buildBattleStoryExportMarkdown 会导出摘要与正文拼接结果', () => {
    const session = createBattleStorySessionRecord({
      title: '导出测试',
      source: {
        mode: 'daily',
        language: 'zh-CN',
        storyLength: 'standard',
        generationMode: 'stream',
      },
      seed: {
        combatants: [{ name: '白百合' }],
        settings: {
          readArenaHistory: false,
          writeArenaHistory: false,
          readCurrentState: true,
          writeCurrentState: true,
          readNarrativeHistory: false,
          writeNarrativeHistory: false,
        },
      },
      workingCombatants: [{ name: '白百合' }],
      sessionSummary: '这是会话摘要',
    });

    const chapter = createBattleStoryChapterRecord({
      sessionId: session.id,
      index: 1,
      action: 'start',
      title: '第一章',
      markdown: '# 第一章\n\n这里是正文',
      reportJson: {},
      deterministicDigest: {
        chapterTitle: '第一章',
      },
    });

    const exported = buildBattleStoryExportMarkdown(session, [chapter]);
    expect(exported).toContain('# 导出测试');
    expect(exported).toContain('## 会话摘要');
    expect(exported).toContain('这里是正文');
  });
});
