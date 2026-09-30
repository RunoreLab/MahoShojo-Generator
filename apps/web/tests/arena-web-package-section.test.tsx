// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ArenaWebPackageSection } from '@/components/arena/editor/features/web-package/ArenaWebPackageSection';
import type { ArenaWebPackageOptionView, ArenaWebPackageSectionModel } from '@/components/arena/editor/features/web-package/web-package-contract';
import { BUILTIN_ARENA_NEWS_PACKAGE_REF } from '@mahoshojo/web-package';

let container: HTMLDivElement;
let root: Root;

const LOCAL_DIGEST = `sha256:${'b'.repeat(64)}`;

const preset: ArenaWebPackageOptionView = {
  digest: BUILTIN_ARENA_NEWS_PACKAGE_REF.digest,
  title: '竞技场新闻',
  kind: 'builtin',
  ref: BUILTIN_ARENA_NEWS_PACKAGE_REF,
  summary: '新闻网站创作资源',
};

const libraryItem: ArenaWebPackageOptionView = {
  digest: LOCAL_DIGEST,
  title: '我的阅读器',
  kind: 'local',
  ref: { id: 'local.side', version: '1.0.0', digest: LOCAL_DIGEST },
  summary: 'local.side@1.0.0',
  byteLength: 2048,
};

const model = (overrides: Partial<ArenaWebPackageSectionModel> = {}): ArenaWebPackageSectionModel => ({
  disabled: false,
  active: true,
  selected: null,
  presets: [preset],
  library: [libraryItem],
  importFeedback: null,
  downloadError: null,
  importing: false,
  downloading: false,
  busyDigest: null,
  saveImportedToLibrary: false,
  capabilities: {
    importLocal: false,
    downloadPreset: true,
    remove: true,
    replace: true,
    manageLibrary: false,
  },
  actions: {
    select: vi.fn(),
    remove: vi.fn(),
    downloadPreset: vi.fn(async () => {}),
    downloadFromLibrary: vi.fn(async () => {}),
    importFile: vi.fn(async () => {}),
    removeFromLibrary: vi.fn(async () => {}),
    setSaveImportedToLibrary: vi.fn(),
  },
  ...overrides,
});

const render = async (input: ArenaWebPackageSectionModel) => {
  await act(async () => root.render(<ArenaWebPackageSection model={input} />));
};

const openPicker = async (): Promise<void> => {
  await act(async () => {
    document.querySelector<HTMLButtonElement>('[data-testid="arena-web-package-open-picker"]')!.click();
  });
};

const soloCapabilities = {
  importLocal: true,
  downloadPreset: true,
  remove: true,
  replace: true,
  manageLibrary: true,
} as const;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.querySelectorAll('[data-web-package-picker-root]').forEach((node) => node.remove());
  vi.restoreAllMocks();
});

describe('ArenaWebPackageSection', () => {
  it('未选择时呈现自由 Web，无「禁用包」选项', async () => {
    await render(model());
    expect(container.querySelector('[data-testid="arena-web-package-selected"]')?.textContent)
      .toBe('自由生成网页（未选择 Web 包）');
    expect(container.textContent).not.toContain('禁用包');
    expect(container.textContent).toContain('选择 Web 包');
  });

  it('默认简洁：Markdown 时只提示切换，不展示选择器细节', async () => {
    await render(model({ active: false }));
    expect(container.querySelector('[data-testid="arena-web-package-section"]')).toBeNull();
    expect(container.textContent).toContain('当前为 Markdown 战报');
  });

  it('网格不再内联在生成方式区块里，必须先打开模态框', async () => {
    await render(model({ capabilities: soloCapabilities }));
    // 折叠区块里只保留摘要与入口，卡片网格、搜索、导入都在模态框内。
    expect(container.querySelector('[aria-label="选择 Web 包：竞技场新闻"]')).toBeNull();
    expect(container.querySelector('[data-testid="web-package-import"]')).toBeNull();

    await openPicker();
    expect(document.querySelector('[aria-label="选择 Web 包：竞技场新闻"]')).toBeTruthy();
  });

  it('内置预设与本地库分属两个 tab，不再混在同一网格里', async () => {
    await render(model({ capabilities: soloCapabilities }));
    await openPicker();

    expect(document.querySelector('[aria-label="选择 Web 包：我的阅读器"]')).toBeNull();
    await act(async () => {
      [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('本地库 ('))!.click();
    });
    expect(document.querySelector('[aria-label="选择 Web 包：我的阅读器"]')).toBeTruthy();
    expect(document.querySelector('[aria-label="选择 Web 包：竞技场新闻"]')).toBeNull();
  });

  it('本地库卡片提供删除与导出，内置预设不提供删除', async () => {
    await render(model({ capabilities: soloCapabilities }));
    await openPicker();
    await act(async () => {
      [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('本地库 ('))!.click();
    });

    expect(document.querySelector('[title="从本地库删除：我的阅读器"]')).toBeTruthy();
    expect(document.querySelector('[title="下载 Web 包 ZIP：我的阅读器"]')).toBeTruthy();

    await act(async () => {
      [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('内置预设 ('))!.click();
    });
    expect(document.querySelector('[title="下载 Web 包 ZIP：竞技场新闻"]')).toBeTruthy();
  });

  it('删除本地库条目必须先确认，确认后才调用删除', async () => {
    const input = model({ capabilities: soloCapabilities });
    await render(input);
    await openPicker();
    await act(async () => {
      [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('本地库 ('))!.click();
    });

    await act(async () => {
      document.querySelector<HTMLButtonElement>('[title="从本地库删除：我的阅读器"]')!.click();
    });
    expect(input.actions.removeFromLibrary).not.toHaveBeenCalled();
    // 确认文案必须说明历史战报会退化，避免用户误以为只是"取消选择"。
    expect(document.body.textContent).toContain('将无法再原样重放');

    // 确认按钮在"删除"对话框内；卡片上的删除入口用的是图标 + sr-only 文案，不能靠文案匹配。
    const confirmDialog = document.querySelector('[aria-labelledby="web-package-remove-title"]')!;
    expect(confirmDialog).toBeTruthy();
    await act(async () => {
      [...confirmDialog.querySelectorAll('button')].find((button) => button.textContent === '删除')!.click();
    });
    expect(input.actions.removeFromLibrary).toHaveBeenCalledWith(LOCAL_DIGEST);
  });

  it('「移除选择」只取消选择，不动本地库', async () => {
    const input = model({ selected: libraryItem, capabilities: soloCapabilities });
    await render(input);
    expect(container.querySelector('[data-testid="arena-web-package-selected"]')?.textContent)
      .toContain('本地：我的阅读器');

    await act(async () => {
      [...container.querySelectorAll('button')].find((item) => item.textContent === '移除选择')!.click();
    });
    expect(input.actions.remove).toHaveBeenCalled();
    expect(input.actions.removeFromLibrary).not.toHaveBeenCalled();
  });

  it('多人能力关闭时不展示本地导入入口、预设下载与本地库管理', async () => {
    await render(model({
      selected: preset,
      capabilities: { importLocal: false, downloadPreset: false, remove: true, replace: true, manageLibrary: false },
    }));
    await openPicker();
    expect(document.querySelector('[data-testid="web-package-import"]')).toBeNull();
    expect(document.querySelector('[data-testid="web-package-import-input"]')).toBeNull();
    expect(document.querySelector('[title="下载 Web 包 ZIP：竞技场新闻"]')).toBeNull();
    expect(document.body.textContent).toContain('多人模式仅支持可共享的内置预设');
  });

  it('单人导入区展示「保存到本地库」偏好并透传变更', async () => {
    const input = model({ capabilities: soloCapabilities, saveImportedToLibrary: true });
    await render(input);
    await openPicker();

    const checkbox = [...document.querySelectorAll('input[type="checkbox"]')]
      .find((item) => (item as HTMLInputElement).closest('label')?.textContent?.includes('导入时保存到本地库')) as HTMLInputElement | undefined;
    expect(checkbox?.checked).toBe(true);
    await act(async () => { checkbox!.click(); });
    expect(input.actions.setSaveImportedToLibrary).toHaveBeenCalledWith(false);
  });

  it('导入失败时把原因与可操作的补救一起显示', async () => {
    await render(model({
      capabilities: soloCapabilities,
      importFeedback: { message: 'ZIP 结构不合法', hint: '请确认选择的是 Web 包 ZIP。', diagnostics: [] },
    }));
    await openPicker();
    expect(document.querySelector('[data-testid="web-package-import-feedback"]')?.textContent)
      .toContain('ZIP 结构不合法');
    expect(document.querySelector('[data-testid="web-package-import-feedback"]')?.textContent)
      .toContain('请确认选择的是 Web 包 ZIP。');
  });

  it('导入成功时展示归一化与缺省填充说明', async () => {
    await render(model({
      capabilities: soloCapabilities,
      importFeedback: { message: '', hint: '', diagnostics: ['已识别包根目录 site/，导入后路径以此为基准。'] },
    }));
    await openPicker();
    expect(document.querySelector('[data-testid="web-package-import-feedback"]')?.textContent)
      .toContain('已识别包根目录 site/');
  });

  it('生成期间仍能打开选择器并下载预设 ZIP（只读动作不应被 disabled 吞掉）', async () => {
    await render(model({ selected: preset, capabilities: soloCapabilities }));
    await render(model({ disabled: true, selected: preset, capabilities: soloCapabilities }));
    await openPicker();

    const selectButton = document.querySelector<HTMLButtonElement>('[aria-label^="取消选择 Web 包："]')!;
    const downloadButton = document.querySelector<HTMLButtonElement>('[title^="下载 Web 包 ZIP："]')!;
    expect(selectButton.disabled).toBe(true);
    expect(downloadButton.disabled).toBe(false);
  });

  it('本地包字节缺失时在网格里点名，而不是等用户点下去才失败', async () => {
    await render(model({
      capabilities: soloCapabilities,
      library: [{ ...libraryItem, broken: true }],
    }));
    await openPicker();
    await act(async () => {
      [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('本地库 ('))!.click();
    });
    expect(document.body.textContent).toContain('文件已缺失');
    const selectButton = document.querySelector<HTMLButtonElement>('[aria-label="选择 Web 包：我的阅读器"]')!;
    expect(selectButton.disabled).toBe(true);
  });

  it('详情把 id@version 归到「身份」、描述归到「描述」，不再把描述当身份展示', async () => {
    await render(model({
      capabilities: soloCapabilities,
      presets: [{
        ...preset,
        summary: '提供新闻样式、素材和互动组件，由 AI 自由创作完整新闻站。',
      }],
    }));
    await openPicker();
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[title="查看 Web 包详情：竞技场新闻"]')!.click();
    });

    const detail = document.querySelector<HTMLElement>('[aria-labelledby="web-package-detail-title"]')!;
    const rows = new Map([...detail.querySelectorAll('dt')]
      .map((dt) => [dt.textContent, dt.nextElementSibling?.textContent ?? '']));
    expect(rows.get('身份')).toBe(`${BUILTIN_ARENA_NEWS_PACKAGE_REF.id}@${BUILTIN_ARENA_NEWS_PACKAGE_REF.version}`);
    expect(rows.get('描述')).toContain('提供新闻样式');
    expect(rows.get('身份')).not.toContain('提供新闻样式');
  });

  it('本地库条目的身份与描述不重复；仅本次会话的暂存包不说自己可删除', async () => {
    const sessionItem: ArenaWebPackageOptionView = {
      ...libraryItem,
      summary: 'local.side@1.0.0',
      sessionOnly: true,
    };
    await render(model({ capabilities: soloCapabilities, library: [sessionItem], selected: sessionItem }));
    await openPicker();
    await act(async () => {
      [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('本地库 ('))!.click();
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[title="查看 Web 包详情：我的阅读器"]')!.click();
    });

    const detail = document.querySelector<HTMLElement>('[aria-labelledby="web-package-detail-title"]')!;
    const labels = [...detail.querySelectorAll('dt')].map((dt) => dt.textContent);
    expect(labels).toContain('身份');
    // summary 就是身份时不重复展示成「描述」。
    expect(labels).not.toContain('描述');
    expect(detail.textContent).toContain('仅本次会话暂存');
    expect(detail.textContent).not.toContain('可删除、可导出');
    // 折叠区块里也不能把暂存包说成来自本地库。
    expect(container.textContent).toContain('仅本次会话暂存；刷新后需要重新导入。');
  });

  it('搜索能按 id@version 命中内置预设（其卡片摘要不是身份）', async () => {
    await render(model({ capabilities: soloCapabilities }));
    await openPicker();

    const search = document.querySelector<HTMLInputElement>('input[type="search"]')!;
    const typeKeyword = async (value: string) => {
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
        setter.call(search, value);
        search.dispatchEvent(new Event('input', { bubbles: true }));
      });
    };

    await typeKeyword('竞技场');
    expect(document.querySelector('[aria-label$="Web 包：竞技场新闻"]')).toBeTruthy();

    await typeKeyword(`${BUILTIN_ARENA_NEWS_PACKAGE_REF.id}@${BUILTIN_ARENA_NEWS_PACKAGE_REF.version}`);
    expect(document.querySelector('[aria-label$="Web 包：竞技场新闻"]')).toBeTruthy();
  });

  it('在详情里按 Escape 只关详情，选择器与已输入的搜索词都留着', async () => {
    await render(model({ capabilities: soloCapabilities }));
    await openPicker();
    const search = document.querySelector<HTMLInputElement>('input[type="search"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(search, '竞技场');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[title="查看 Web 包详情：竞技场新闻"]')!.click();
    });
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(document.querySelector('[aria-labelledby="web-package-detail-title"]')).toBeNull();
    expect(document.querySelector('[data-testid="web-package-import-input"]')).toBeTruthy();
    expect(document.querySelector<HTMLInputElement>('input[type="search"]')?.value).toBe('竞技场');
  });

  it('详情与删除确认互斥，不会同时挂在选择器之上', async () => {
    await render(model({ capabilities: soloCapabilities }));
    await openPicker();
    await act(async () => {
      [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('本地库 ('))!.click();
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[title="查看 Web 包详情：我的阅读器"]')!.click();
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[title="从本地库删除：我的阅读器"]')!.click();
    });

    expect(document.querySelector('[aria-labelledby="web-package-detail-title"]')).toBeNull();
    expect(document.querySelector('[aria-labelledby="web-package-remove-title"]')).toBeTruthy();
  });

  it('待确认的条目从列表消失后不再留着确认框', async () => {
    const input = model({ capabilities: soloCapabilities });
    await render(input);
    await openPicker();
    await act(async () => {
      [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('本地库 ('))!.click();
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[title="从本地库删除：我的阅读器"]')!.click();
    });
    expect(document.querySelector('[aria-labelledby="web-package-remove-title"]')).toBeTruthy();

    // 库记录被别处清掉：确认框必须跟着消失，而不是等这条记录再次出现时无声弹回。
    await render(model({ capabilities: soloCapabilities, library: [] }));
    expect(document.querySelector('[aria-labelledby="web-package-remove-title"]')).toBeNull();
  });
});
