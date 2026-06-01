import { describe, expect, test } from 'vitest';

import { buildBattleLiteInheritedSummary } from '@/components/arena-lite/battle-lite-inherited-summary';

describe('battle lite inherited summary', () => {
  test('会汇总共享设置与隐藏高级上下文数量', () => {
    expect(
      buildBattleLiteInheritedSummary({
        battleMode: 'scenario',
        scenario: { content: { title: '主情景' } },
        storyLength: 'long',
        customStoryLength: '1350',
        selectedLanguage: 'en-US',
        settings: {
          userGuidance: '保持原样',
          readArenaHistory: true,
          readArenaHistoryLimit: 5,
          isArenaHistoryUnlimited: false,
          writeArenaHistory: true,
          readCurrentState: true,
          writeCurrentState: true,
          readNarrativeHistory: true,
          readNarrativeHistoryLimit: 12,
          isNarrativeHistoryUnlimited: false,
          writeNarrativeHistory: false,
          streamTransport: 'sse',
          battleReportCardWidthMode: 'manual',
          battleReportCardWidthPx: 920,
        },
        auxScenarios: [{ id: 'aux-1' }, { id: 'aux-2' }],
        selectedQuestionnaires: [{ selectionId: 'q-1' }],
        adjudicationEvents: [{ id: 'evt-1' }, { id: 'evt-2' }, { id: 'evt-3' }],
      } as any),
    ).toEqual({
      inheritedSettings: [
        '长度：自定义 1350 字（预设：long）',
        '语言：en-US',
        '历战读取：开启（5 条）',
        '当前状态读取：开启',
        '当前状态写回：开启',
        '叙事历史：开启（12 条）/ 不写回',
      ],
      hiddenContext: ['辅助情景 2 个', '问卷 1 张', '判定事件 3 条'],
      hasHiddenContext: true,
    });
  });

  test('没有隐藏高级上下文时返回空上下文提示', () => {
    expect(
      buildBattleLiteInheritedSummary({
        battleMode: 'classic',
        scenario: { content: { title: '不会生效的主情景' } },
        storyLength: 'default',
        selectedLanguage: 'zh-CN',
        settings: {
          userGuidance: '',
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
          battleReportCardWidthMode: 'auto',
          battleReportCardWidthPx: 680,
        },
        auxScenarios: [],
        selectedQuestionnaires: [],
        adjudicationEvents: [],
      } as any),
    ).toMatchObject({
      hiddenContext: [],
      hasHiddenContext: false,
    });
  });

  test('非情景模式不会把辅助情景计入隐藏高级上下文', () => {
    expect(
      buildBattleLiteInheritedSummary({
        battleMode: 'classic',
        scenario: { content: { title: '主情景' } },
        storyLength: 'default',
        selectedLanguage: 'zh-CN',
        settings: {
          userGuidance: '',
          readArenaHistory: true,
          readArenaHistoryLimit: 3,
          isArenaHistoryUnlimited: false,
          writeArenaHistory: true,
          readCurrentState: false,
          writeCurrentState: true,
          readNarrativeHistory: false,
          readNarrativeHistoryLimit: 10,
          isNarrativeHistoryUnlimited: false,
          writeNarrativeHistory: false,
          streamTransport: 'sse',
          battleReportCardWidthMode: 'auto',
          battleReportCardWidthPx: 680,
        },
        auxScenarios: [{ id: 'aux-1' }, { id: 'aux-2' }],
        selectedQuestionnaires: [],
        adjudicationEvents: [{ id: 'evt-1' }],
      } as any),
    ).toEqual({
      inheritedSettings: [
        '长度：default',
        '语言：zh-CN',
        '历战读取：开启（3 条）',
        '当前状态读取：关闭',
        '当前状态写回：开启',
        '叙事历史：关闭',
      ],
      hiddenContext: ['判定事件 1 条'],
      hasHiddenContext: true,
    });
  });
});
