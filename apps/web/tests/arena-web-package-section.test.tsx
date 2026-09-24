// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ArenaWebPackageSection } from '@/components/arena/editor/features/web-package/ArenaWebPackageSection';
import type { ArenaWebPackageSectionModel } from '@/components/arena/editor/features/web-package/web-package-contract';
import { BUILTIN_VISUAL_NOVEL_PACKAGE_REF } from '@mahoshojo/web-package';

let container: HTMLDivElement;
let root: Root;

const model = (overrides: Partial<ArenaWebPackageSectionModel> = {}): ArenaWebPackageSectionModel => ({
  disabled: false,
  active: true,
  selected: null,
  options: [{
    digest: BUILTIN_VISUAL_NOVEL_PACKAGE_REF.digest,
    title: 'Visual Novel Lite',
    kind: 'builtin',
    ref: BUILTIN_VISUAL_NOVEL_PACKAGE_REF,
    summary: '内置视觉小说阅读器',
  }],
  localSummary: null,
  importError: null,
  downloadError: null,
  importing: false,
  downloading: false,
  capabilities: {
    importLocal: false,
    downloadPreset: false,
    remove: true,
    replace: true,
  },
  actions: {
    select: vi.fn(),
    remove: vi.fn(),
    downloadPreset: vi.fn(async () => {}),
    importFile: vi.fn(async () => {}),
  },
  ...overrides,
});

const render = async (input: ArenaWebPackageSectionModel) => {
  await act(async () => root.render(<ArenaWebPackageSection model={input} />));
};

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('ArenaWebPackageSection', () => {
  it('默认简洁：Markdown 时只提示切换，不展示选择器细节', async () => {
    await render(model({ active: false }));
    expect(container.querySelector('[data-testid="arena-web-package-section"]')).toBeNull();
    expect(container.textContent).toContain('当前为 Markdown 战报');
    expect(container.querySelector('select')).toBeNull();
  });

  it('未选择时呈现自由 Web，无「禁用包」选项', async () => {
    await render(model());
    expect(container.querySelector('[data-testid="arena-web-package-selected"]')?.textContent)
      .toBe('自由生成网页（未选择 Web 包）');
    const options = [...container.querySelectorAll('option')].map((item) => item.textContent);
    expect(options[0]).toBe('自由生成网页');
    expect(options).not.toContain('禁用包');
  });

  it('多人能力关闭时不展示本地导入入口与预设下载按钮', async () => {
    await render(model({
      selected: {
        digest: BUILTIN_VISUAL_NOVEL_PACKAGE_REF.digest,
        title: 'Visual Novel Lite',
        kind: 'builtin',
        ref: BUILTIN_VISUAL_NOVEL_PACKAGE_REF,
      },
      capabilities: {
        importLocal: false,
        downloadPreset: false,
        remove: true,
        replace: true,
      },
    }));
    expect(container.querySelector('[data-testid="arena-web-package-import"]')).toBeNull();
    expect(container.querySelector('[data-testid="arena-web-package-import-input"]')).toBeNull();
    expect(container.querySelector('[data-testid="arena-web-package-download"]')).toBeNull();
    expect(container.textContent).toContain('多人模式仅支持可共享的内置预设');
  });

  it('单人能力开启时展示导入与独立下载按钮，并暴露失败原因', async () => {
    await render(model({
      selected: {
        digest: BUILTIN_VISUAL_NOVEL_PACKAGE_REF.digest,
        title: 'Visual Novel Lite',
        kind: 'builtin',
        ref: BUILTIN_VISUAL_NOVEL_PACKAGE_REF,
      },
      importError: 'ZIP 结构不合法',
      capabilities: {
        importLocal: true,
        downloadPreset: true,
        remove: true,
        replace: true,
      },
    }));
    expect(container.querySelector('[data-testid="arena-web-package-import"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="arena-web-package-download"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="arena-web-package-import-error"]')?.textContent)
      .toBe('ZIP 结构不合法');
  });

  it('本地包展示本地前缀、摘要与移除入口', async () => {
    await render(model({
      selected: {
        digest: 'sha256:b'.repeat(64),
        title: '我的阅读器',
        kind: 'local',
        ref: null,
        summary: 'local.side@1.0.0',
      },
      localSummary: '已加载本地 Web 包（我的阅读器）。',
      options: [{
        digest: 'sha256:b'.repeat(64),
        title: '我的阅读器',
        kind: 'local',
        ref: null,
        summary: 'local.side@1.0.0',
      }],
      capabilities: {
        importLocal: true,
        downloadPreset: false,
        remove: true,
        replace: true,
      },
    }));
    expect(container.querySelector('[data-testid="arena-web-package-selected"]')?.textContent)
      .toContain('本地：我的阅读器');
    expect(container.textContent).toContain('已加载本地 Web 包');
    const removeButton = [...container.querySelectorAll('button')].find((item) => item.textContent === '移除');
    expect(removeButton).toBeTruthy();
    await act(async () => removeButton!.click());
  });
});
