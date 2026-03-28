import { describe, expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { SublimationArenaHistoryStrategyFieldset } from '@/components/shared/SublimationArenaHistoryStrategyFieldset';
import {
  ARENA_HISTORY_RETENTION_DESCRIPTIONS,
  ARENA_HISTORY_RETENTION_LABELS,
} from '@/lib/sublimation/arena-history';

describe('SublimationArenaHistoryStrategyFieldset', () => {
  test('writeArenaHistory=false 时不渲染策略单选组', () => {
    const html = renderToStaticMarkup(
      React.createElement(SublimationArenaHistoryStrategyFieldset, {
        readArenaHistory: true,
        writeArenaHistory: false,
        retentionStrategy: 'keep-all',
        disabled: false,
        onReadArenaHistoryChange: () => {},
        onWriteArenaHistoryChange: () => {},
        onRetentionStrategyChange: () => {},
      }),
    );

    expect(html).toContain('升华时读取');
    expect(html).toContain('升华后写入');
    expect(html).not.toContain(ARENA_HISTORY_RETENTION_LABELS['keep-all']);
    expect(html).not.toContain(ARENA_HISTORY_RETENTION_LABELS['keep-sublimation-only']);
    expect(html).not.toContain(ARENA_HISTORY_RETENTION_LABELS['reset-all']);
  });

  test('writeArenaHistory=true 时渲染三种策略与即时说明', () => {
    const html = renderToStaticMarkup(
      React.createElement(SublimationArenaHistoryStrategyFieldset, {
        readArenaHistory: true,
        writeArenaHistory: true,
        retentionStrategy: 'reset-all',
        disabled: false,
        onReadArenaHistoryChange: () => {},
        onWriteArenaHistoryChange: () => {},
        onRetentionStrategyChange: () => {},
      }),
    );

    expect(html).toContain(ARENA_HISTORY_RETENTION_LABELS['keep-all']);
    expect(html).toContain(ARENA_HISTORY_RETENTION_LABELS['keep-sublimation-only']);
    expect(html).toContain(ARENA_HISTORY_RETENTION_LABELS['reset-all']);
    expect(html).toContain(ARENA_HISTORY_RETENTION_DESCRIPTIONS['reset-all']);
  });

  test('disabled=true 时所有输入均为禁用态', () => {
    const html = renderToStaticMarkup(
      React.createElement(SublimationArenaHistoryStrategyFieldset, {
        readArenaHistory: false,
        writeArenaHistory: true,
        retentionStrategy: 'keep-sublimation-only',
        disabled: true,
        onReadArenaHistoryChange: () => {},
        onWriteArenaHistoryChange: () => {},
        onRetentionStrategyChange: () => {},
      }),
    );

    const disabledCount = (html.match(/disabled=\"\"/g) ?? []).length;
    expect(disabledCount).toBe(5);
  });
});
