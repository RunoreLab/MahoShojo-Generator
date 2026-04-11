import React from 'react';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { ChallengeLobby } from '@/components/challenge/ChallengeLobby';

describe('challenge lobby', () => {
  test('默认展示在线角色库、本地导入和折叠的高级编辑区', () => {
    const html = renderToStaticMarkup(
      <ChallengeLobby
        worldTitle="魔法少女竞技场"
        recentRuns={[]}
        unlocks={[]}
        isLoadingRecentRuns={false}
        isAuthenticated={false}
        isSubmitting={false}
        isMatching={null}
        entrantSummary={null}
        rawEditorText=""
        selectionError={null}
        localImportError={null}
        editorError={null}
        isEditorDirty={false}
        advancedEditorRevealToken={0}
        onRawEditorTextChange={(_value) => {}}
        onApplyEditorText={() => {}}
        onOpenCharacterPicker={() => {}}
        onRandomMatchEntrant={() => {}}
        onImportEntrantFile={async (_file) => {}}
        onImportEntrantText={async (_text) => {}}
        onLoadDemoCard={() => {}}
        onClearEntrant={() => {}}
        onRevealAdvancedEditor={() => {}}
        onPrepareChallenge={() => {}}
        onUserProviderConfigChange={() => {}}
        onResumeRun={() => {}}
        onDeleteRun={() => {}}
      />
    );

    expect(html).toContain('在线角色库 / 随机匹配');
    expect(html).toContain('本地导入');
    expect(html).toContain('高级 JSON 编辑');
    expect(html).toContain('AI 裁定模型');
    expect(html).toContain('自定义 AI 能力提供商');
    expect(html).toContain('浏览在线角色库');
    expect(html).toContain('还没有选中挑战者');
  });

  test('已有当前挑战者时，仍可重新从数据库选择或随机匹配', () => {
    const html = renderToStaticMarkup(
      <ChallengeLobby
        worldTitle="魔法少女竞技场"
        recentRuns={[]}
        unlocks={[]}
        isLoadingRecentRuns={false}
        isAuthenticated
        isSubmitting={false}
        isMatching={null}
        entrantSummary={{
          displayName: '雾灯',
          templateLabel: '魔法少女',
          sourceModeLabel: '试玩示例',
          isReadyForBootstrap: true,
          bootstrapStatusMessage: '当前可直接生成 challenge 快照。',
        }}
        rawEditorText='{"codename":"雾灯"}'
        selectionError={null}
        localImportError={null}
        editorError={null}
        isEditorDirty={false}
        advancedEditorRevealToken={0}
        onRawEditorTextChange={(_value) => {}}
        onApplyEditorText={() => {}}
        onOpenCharacterPicker={() => {}}
        onRandomMatchEntrant={() => {}}
        onImportEntrantFile={async (_file) => {}}
        onImportEntrantText={async (_text) => {}}
        onLoadDemoCard={() => {}}
        onClearEntrant={() => {}}
        onRevealAdvancedEditor={() => {}}
        onPrepareChallenge={() => {}}
        onUserProviderConfigChange={() => {}}
        onResumeRun={() => {}}
        onDeleteRun={() => {}}
      />
    );

    expect(html).toContain('浏览在线角色库');
    expect(html).toContain('随机匹配角色');
    expect(html).not.toContain('disabled=""');
  });

  test('在线角色库分区会单独显示数据库选择 / 随机匹配错误', () => {
    const html = renderToStaticMarkup(
      <ChallengeLobby
        worldTitle="魔法少女竞技场"
        recentRuns={[]}
        unlocks={[]}
        isLoadingRecentRuns={false}
        isAuthenticated
        isSubmitting={false}
        isMatching={null}
        entrantSummary={null}
        rawEditorText=""
        selectionError="随机匹配角色失败。"
        localImportError={null}
        editorError={null}
        isEditorDirty={false}
        advancedEditorRevealToken={0}
        onRawEditorTextChange={(_value) => {}}
        onApplyEditorText={() => {}}
        onOpenCharacterPicker={() => {}}
        onRandomMatchEntrant={() => {}}
        onImportEntrantFile={async (_file) => {}}
        onImportEntrantText={async (_text) => {}}
        onLoadDemoCard={() => {}}
        onClearEntrant={() => {}}
        onRevealAdvancedEditor={() => {}}
        onPrepareChallenge={() => {}}
        onUserProviderConfigChange={() => {}}
        onResumeRun={() => {}}
        onDeleteRun={() => {}}
      />
    );

    expect(html).toContain('随机匹配角色失败。');
  });
});
