// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ArenaRosterList,
  ArenaRosterRow,
  type ArenaRosterItemView,
} from '@/components/arena/editor/presentation/ArenaRoster';
import { ArenaAuxScenarioList } from '@/components/arena/editor/presentation/ArenaScenarioList';
import { ArenaMaterialList } from '@/components/arena/editor/presentation/ArenaMaterialList';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const safeStub: ArenaRosterItemView = {
  key: 'data-card:character-1',
  displayName: '公开角色',
  typeLabel: '魔法少女',
  guidance: '保护队友',
  teamLabel: '星光队',
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('Arena editor safe roster presentation', () => {
  it('full row 仅按 capability 显示详情、下载、复制与排名信息', async () => {
    const onShowDetails = vi.fn();
    const onDownload = vi.fn();
    const onCopy = vi.fn();

    await act(async () => root.render(
      <ArenaRosterRow
        item={safeStub}
        index={0}
        total={1}
        capabilities={{ details: true, download: true, copy: true, ranking: true }}
        onShowDetails={onShowDetails}
        onDownload={onDownload}
        onCopy={onCopy}
        ranking={<span>严格：1200</span>}
      />,
    ));

    for (const label of ['详情', '下载', '复制']) {
      const button = [...container.querySelectorAll('button')]
        .find((candidate) => candidate.textContent?.trim() === label);
      expect(button, label).toBeInstanceOf(HTMLButtonElement);
      await act(async () => button?.click());
    }
    expect(onShowDetails).toHaveBeenCalledOnce();
    expect(onDownload).toHaveBeenCalledOnce();
    expect(onCopy).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('严格：1200');
  });

  it('safe stub 即使收到敏感 callback/slot 也不显示或触发敏感能力', async () => {
    const onShowDetails = vi.fn();
    const onDownload = vi.fn();
    const onCopy = vi.fn();

    await act(async () => root.render(
      <ArenaRosterRow
        item={safeStub}
        index={0}
        total={1}
        capabilities={{ guidance: true, remove: true, reorder: true }}
        onShowDetails={onShowDetails}
        onDownload={onDownload}
        onCopy={onCopy}
        rankingBadge={<span>黄金段位</span>}
        ranking={<button onClick={onShowDetails}>泄漏排名入口</button>}
        onRemove={() => {}}
        onMove={() => {}}
      />,
    ));

    expect(container.textContent).toContain('公开角色');
    expect(container.textContent).toContain('保护队友');
    expect(container.textContent).toContain('星光队');
    expect(container.textContent).not.toContain('详情');
    expect(container.textContent).not.toContain('下载');
    expect(container.textContent).not.toContain('复制');
    expect(container.textContent).not.toContain('泄漏排名入口');
    expect(container.textContent).not.toContain('黄金段位');
    expect(container.querySelector('[data-sensitive-roster-metadata]')).toBeNull();
    expect(onShowDetails).not.toHaveBeenCalled();
    expect(onDownload).not.toHaveBeenCalled();
    expect(onCopy).not.toHaveBeenCalled();
  });

  it('roster/scenario/material list 都保持受控排序与移除动作', async () => {
    const moveRoster = vi.fn();
    const removeScenario = vi.fn();
    const moveMaterial = vi.fn();

    await act(async () => root.render(
      <>
        <ArenaRosterList
          items={[safeStub]}
          renderItem={(item, index) => (
            <ArenaRosterRow
              item={item}
              index={index}
              total={1}
              capabilities={{ reorder: true }}
              onMove={moveRoster}
            />
          )}
        />
        <ArenaAuxScenarioList
          items={[{ key: 'scenario-1', title: '雨夜', isNative: true }]}
          disabled={false}
          onMove={() => {}}
          onRemove={removeScenario}
        />
        <ArenaMaterialList
          items={[{ key: 'material-1', name: '车站资料', sourceLabel: '数据卡 / material' }]}
          disabled={false}
          onMove={moveMaterial}
          onRemove={() => {}}
        />
      </>,
    ));

    expect(container.textContent).toContain('雨夜');
    expect(container.textContent).toContain('车站资料');

    const removeRain = container.querySelector<HTMLButtonElement>('button[aria-label="移除 雨夜"]');
    await act(async () => removeRain?.click());
    expect(removeScenario).toHaveBeenCalledWith('scenario-1');

    const materialDown = container.querySelector<HTMLButtonElement>('button[aria-label="下移 车站资料"]');
    expect(materialDown?.disabled).toBe(true);
    expect(moveMaterial).not.toHaveBeenCalled();
    expect(moveRoster).not.toHaveBeenCalled();
  });

  it('共享列表的移动与移除按钮提供适合触屏的最小触控尺寸', async () => {
    await act(async () => root.render(
      <>
        <ArenaRosterRow
          item={safeStub}
          index={1}
          total={3}
          capabilities={{ reorder: true, remove: true }}
          onMove={() => {}}
          onRemove={() => {}}
        />
        <ArenaAuxScenarioList
          items={[{ key: 'scenario-1', title: '雨夜' }, { key: 'scenario-2', title: '白昼' }]}
          onMove={() => {}}
          onRemove={() => {}}
        />
        <ArenaMaterialList
          items={[{ key: 'material-1', name: '车站资料', sourceLabel: '公开' }]}
          onMove={() => {}}
          onRemove={() => {}}
        />
      </>,
    ));

    for (const button of container.querySelectorAll('button[aria-label^="上移"], button[aria-label^="下移"], button[aria-label^="移除"]')) {
      expect(button.className).toMatch(/(?:min-w-10|min-h-10|w-10|h-10)/);
    }
  });
});
