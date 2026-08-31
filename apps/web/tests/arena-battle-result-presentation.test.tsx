// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/stream/StreamingBattleReportCard', () => ({
  default: (props: {
    content: string;
    isStreaming?: boolean;
    scenarioName?: string;
    userGuidance?: string | null;
    aiModel?: string | null;
    onSaveImage?: (imageUrl: string) => void;
  }) => (
    <div>
      <div
        data-testid="streaming-report-card"
        data-streaming={String(Boolean(props.isStreaming))}
        data-scenario={props.scenarioName}
        data-guidance={props.userGuidance ?? undefined}
        data-model={props.aiModel ?? undefined}
      >
        {props.content}
      </div>
      <button type="button" onClick={() => props.onSaveImage?.('blob:room-report')}>
        保存战报图片
      </button>
    </div>
  ),
}));

vi.mock('@/components/BattleReportCard', () => ({
  default: (props: { report: { headline: string } }) => (
    <div data-testid="structured-report-card">{props.report.headline}</div>
  ),
}));

vi.mock('@/components/shared/CollapsibleSection', () => ({
  CollapsibleSection: (props: { title: React.ReactNode; children: React.ReactNode }) => (
    <section>
      <h2>{props.title}</h2>
      {props.children}
    </section>
  ),
}));

import {
  BattleResultPresentation,
  type BattleResultPresentationProps,
} from '@/components/arena/components/BattleResultPresentation';

const render = (props: BattleResultPresentationProps) => renderToStaticMarkup(
  <BattleResultPresentation {...props} />,
);

describe('BattleResultPresentation', () => {
  it('用主战报卡呈现流式战报与严格安全摘要', () => {
    const html = render({
      report: {
        format: 'stream-markdown',
        content: '# 房间终局',
        isStreaming: false,
        mode: 'scenario',
        scenarioName: '雨夜车站',
        userGuidance: '守护无辜者',
        aiModel: 'safe-model-name',
      },
      adjudicationResults: [{
        description: '突围判定',
        outcome: '成功',
        details: '掷骰 18',
        depth: 0,
      }],
      combatantUpdates: [{
        combatantKey: 'character:1',
        displayName: '晓',
        impact: '守住了车站',
        currentStateSummary: '轻伤但仍可行动',
      }],
    });

    expect(html).toContain('data-testid="streaming-report-card"');
    expect(html).toContain('# 房间终局');
    expect(html).toContain('雨夜车站');
    expect(html).toContain('守护无辜者');
    expect(html).toContain('突围判定');
    expect(html).toContain('晓');
    expect(html).toContain('守住了车站');
    expect(html).toContain('轻伤但仍可行动');
    expect(html).not.toContain('重做角色更新');
    expect(html).not.toContain('应用手动修改');
    expect(html).not.toContain('下载更新设定');
    expect(html).not.toContain('保存到云端');
  });

  it('保留结构化战报卡适配入口', () => {
    const html = render({
      report: {
        format: 'structured-report',
        mode: 'classic',
        report: {
          headline: '结构化终局',
          reporterInfo: { name: '记者', publication: '日报' },
          article: { body: '正文', analysis: '分析' },
          officialReport: { winner: '晓', conclusion: '结论' },
        },
      },
    });

    expect(html).toContain('data-testid="structured-report-card"');
    expect(html).toContain('结构化终局');
  });

  it('房间 viewer 可以沿用主战报卡的保存图片动作', async () => {
    const onSaveImage = vi.fn();
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => root.render(
      <BattleResultPresentation
        report={{
          format: 'stream-markdown',
          content: '# 可保存的房间战报',
          mode: 'classic',
        }}
        onSaveImage={onSaveImage}
      />,
    ));
    const saveButton = [...container.querySelectorAll('button')]
      .find((candidate) => candidate.textContent === '保存战报图片');
    if (!(saveButton instanceof HTMLButtonElement)) throw new Error('保存图片按钮缺失');
    await act(async () => saveButton.click());

    expect(onSaveImage).toHaveBeenCalledOnce();
    expect(onSaveImage).toHaveBeenCalledWith('blob:room-report');
    await act(async () => root.unmount());
    container.remove();
  });
});
