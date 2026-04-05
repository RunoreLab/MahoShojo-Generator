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
        onResumeRun={() => {}}
        onDeleteRun={() => {}}
      />
    );

    expect(html).toContain('在线角色库 / 随机匹配');
    expect(html).toContain('本地导入');
    expect(html).toContain('高级 JSON 编辑');
    expect(html).toContain('浏览在线角色库');
  });
});
