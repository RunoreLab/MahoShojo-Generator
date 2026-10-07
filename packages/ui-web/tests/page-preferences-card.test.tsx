// @vitest-environment jsdom
/**
 * 页偏好卡片写失败的错误投影（D5.1-S1-r1 / DESK-SET-001「错误投影」）。
 *
 * `adapter.writeField` 返回 `false`（存储仍可读但 `setItem` 抛错，如
 * quota/WebView 存储故障）或值校验抛错时，select / toggle / text 三种
 * 可写控件都必须把失败如实投影到卡片级 notice——控件随重渲染回落到
 * 存储真值，不出现「界面改了但没保存」的静默态。
 */
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PagePreferencesCard } from '../src/settings/PagePreferencesCard';
import {
  createPagePreferencesAdapter,
  type PagePreferenceSource,
  type SettingsStorageLike,
} from '../src/settings/page-preferences';

/** 内存存储：`failWrites()` 后 setItem 抛错——模拟可读不可写的故障面。 */
const createStorage = () => {
  const map = new Map<string, string>();
  let writable = true;
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (!writable) throw new Error('QuotaExceededError');
      map.set(key, value);
    },
    removeItem: (key: string) => void map.delete(key),
    seed: (key: string, value: string) => void map.set(key, value),
    failWrites: () => {
      writable = false;
    },
    restoreWrites: () => {
      writable = true;
    },
    dump: () => Object.fromEntries(map),
  } satisfies SettingsStorageLike & {
    seed(key: string, value: string): void;
    failWrites(): void;
    restoreWrites(): void;
    dump(): Record<string, string>;
  };
};

const SOURCE: PagePreferenceSource = {
  pageId: 'details',
  title: '设定生成（/details）',
  pagePath: '/details',
  storageKey: 'test.details.preferences.v1',
  scope: 'blob',
  fields: [
    {
      key: 'imageSaveMode',
      label: '设定长图保存方式',
      kind: 'select',
      options: [
        { value: 'download', label: '一键下载' },
        { value: 'modal', label: '预览弹窗保存' },
      ],
    },
    { key: 'showDetails', label: '默认展开「设定说明」', kind: 'boolean' },
    { key: 'nickname', label: '署名', kind: 'text' },
  ],
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = async (node: ReactNode): Promise<void> => {
  await act(async () => {
    root.render(node);
  });
};

const click = async (element: Element | null): Promise<void> => {
  expect(element).not.toBeNull();
  await act(async () => {
    element?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
};

const findButton = (text: string): Element | null =>
  [...container.querySelectorAll('button')].find((button) => button.textContent === text) ?? null;

const findToggle = (label: string): Element | null =>
  container.querySelector(`[role="switch"][aria-label="${label}"]`);

const alertText = (): string | null =>
  container.querySelector('[role="alert"]')?.textContent ?? null;

describe('page preferences card — write failure projection', () => {
  it('select write failure surfaces a card notice and the value stays unchanged', async () => {
    const storage = createStorage();
    storage.seed(SOURCE.storageKey, JSON.stringify({ imageSaveMode: 'download', showDetails: false }));
    storage.failWrites();
    await render(<PagePreferencesCard adapter={createPagePreferencesAdapter(SOURCE, storage)} />);

    await click(findButton('预览弹窗保存'));

    // 错误投影到卡片 notice；存储真值不变，选项按钮回落为 download。
    expect(alertText()).toContain('写入失败');
    expect(alertText()).toContain('设定长图保存方式');
    expect(storage.dump()[SOURCE.storageKey]).toBe(
      JSON.stringify({ imageSaveMode: 'download', showDetails: false }),
    );
    expect(findButton('一键下载')?.getAttribute('aria-pressed')).toBe('true');
    expect(findButton('预览弹窗保存')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('toggle write failure surfaces a card notice and the value stays unchanged', async () => {
    const storage = createStorage();
    storage.seed(SOURCE.storageKey, JSON.stringify({ imageSaveMode: 'download', showDetails: false }));
    storage.failWrites();
    await render(<PagePreferencesCard adapter={createPagePreferencesAdapter(SOURCE, storage)} />);

    await click(findToggle('默认展开「设定说明」'));

    expect(alertText()).toContain('写入失败');
    expect(alertText()).toContain('默认展开「设定说明」');
    expect(storage.dump()[SOURCE.storageKey]).toBe(
      JSON.stringify({ imageSaveMode: 'download', showDetails: false }),
    );
    expect(findToggle('默认展开「设定说明」')?.getAttribute('aria-checked')).toBe('false');
  });

  it('a later successful write clears the earlier failure notice', async () => {
    const storage = createStorage();
    storage.seed(SOURCE.storageKey, JSON.stringify({ imageSaveMode: 'download' }));
    storage.failWrites();
    const adapter = createPagePreferencesAdapter(SOURCE, storage);
    await render(<PagePreferencesCard adapter={adapter} />);

    await click(findButton('预览弹窗保存'));
    expect(alertText()).toContain('写入失败');

    // 恢复可写后再次提交同一选择：写入成功，旧错误提示被清掉。
    storage.restoreWrites();
    await click(findButton('预览弹窗保存'));

    expect(alertText()).toBeNull();
    expect(JSON.parse(storage.dump()[SOURCE.storageKey])).toEqual({
      imageSaveMode: 'modal',
    });
  });
});
