// @vitest-environment jsdom
/**
 * Desktop 设置页分组壳（D5.1-S1 / DESK-SET-001 / DESK-SET-007）。
 *
 * 守三件事：
 *
 * 1. **分组与深链**：`/settings` 渲染共享分组壳，锚点 `settings-<group>`；
 *    `?section=<group>` 是合法深链并定位到对应分组，非法值静默回落。
 * 2. **设备偏好真本地**：外观/交互字段只写 localStorage——不触发任何账号
 *    或网络 IPC（DESK-SET-007「离线可改」）。
 * 3. **页偏好同一 owner**：设置页对草稿文档做字段级手术——改字段写回
 *    `mahoshojo.desktop.*.draft.v1` 同一键；重置只删偏好键，草稿原样保留。
 */
import { act } from 'react';
import { RouterProvider } from '@tanstack/react-router';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeMock, defaultInvokeImpl } = vi.hoisted(() => {
  const impl = async (command: string): Promise<unknown> => {
    if (command === 'cloud_cached_account') return null;
    if (command === 'cloud_auth_status') return { state: 'signed-out' as const };
    if (command === 'announcements_get_cached') return null;
    if (command === 'announcements_refresh') {
      return {
        status: 'not-modified',
        snapshot: { fetchedAt: '2026-10-10T00:00:00Z', announcements: [] },
      };
    }
    if (command === 'desktop_config_read') {
      return {
        path: 'C:\\cfg\\config.json',
        directory: 'C:\\cfg',
        backupPresent: false,
        invalidPresent: false,
        file: { status: 'missing' as const },
      };
    }
    if (command === 'desktop_config_write') {
      return { revision: 'sha256:'.padEnd(7 + 64, '0') };
    }
    if (command === 'list_provider_profile_ids') return [];
    if (command === 'desktop_runtime_info') {
      return {
        appVersion: '0.0.0-test',
        tauriVersion: '2.x',
        os: 'windows',
        arch: 'x86_64',
        packaged: false,
      };
    }
    return undefined;
  };
  return { invokeMock: vi.fn(impl), defaultInvokeImpl: impl };
});

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: invokeMock }));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ onCloseRequested: async () => () => {} }),
}));

import { createDesktopRouter } from '../src/app/router';
import { DESKTOP_CANSHOU_PREFERENCES, DESKTOP_DETAILS_PREFERENCES } from '../src/app/settings-page-preferences';
import { DETAILS_DRAFT_KEY } from '../src/features/details/session';
import { resetDesktopCloudSessionStoreForTests } from '../src/features/account/use-desktop-cloud-session';
import { resetDesktopAiConfigStoreForTests } from '../src/features/ai-config/use-desktop-ai-config';
import { resetTopbarAvatarForTests } from '../src/features/account/use-topbar-avatar';
import { resetDesktopAnnouncementsStoreForTests } from '../src/features/announcements/use-desktop-announcements';
import { resetDesktopConfigStoreForTests } from '../src/features/config/use-desktop-config';

let container: HTMLDivElement;
let root: Root;
const scrollIntoView = vi.fn();

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  Element.prototype.scrollIntoView = scrollIntoView;
  window.location.hash = '';
  window.localStorage.clear();
  delete document.documentElement.dataset.motion;
  scrollIntoView.mockClear();
  invokeMock.mockClear();
  invokeMock.mockImplementation(defaultInvokeImpl);
  resetDesktopCloudSessionStoreForTests();
  resetDesktopAiConfigStoreForTests();
  resetTopbarAvatarForTests();
  resetDesktopAnnouncementsStoreForTests();
  resetDesktopConfigStoreForTests();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const settle = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
};

const mountAt = async (path: string) => {
  const router = createDesktopRouter();
  await router.load();
  act(() => {
    root.render(<RouterProvider router={router} />);
  });
  const [pathname, query] = path.split('?');
  const search = Object.fromEntries(new URLSearchParams(query ?? ''));
  await act(async () => {
    await router.navigate({ to: pathname, search });
  });
  await settle();
  return router;
};

const click = async (element: Element | null): Promise<void> => {
  expect(element).not.toBeNull();
  await act(async () => {
    element?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await settle();
};

describe('desktop settings shell', () => {
  it('renders the shared grouped shell with section anchors and delivered panels', async () => {
    await mountAt('/settings');

    expect(container.querySelector('[data-testid="settings-page"]')).not.toBeNull();
    for (const group of ['account', 'appearance', 'generation', 'data', 'advanced']) {
      expect(container.querySelector(`#settings-${group}`)).not.toBeNull();
    }
    // 既有真实面板仍在（不丢功能）：账号面板、AI 连接、Web 包诊断与运行时自述。
    expect(container.querySelector('[data-testid="account-panel"]')).not.toBeNull();
    expect(container.textContent).toContain('Web Package 受限 webview');
    expect(container.textContent).toContain('本地运行时');
    // 设备级字段直接可读：主题/减少动态效果/结果自动定位。
    expect(container.textContent).toContain('减少动态效果');
    expect(container.textContent).toContain('结果自动定位');
    // S2 交付的「在线与通知」组：公告策略与外链确认都接 config.json。
    expect(container.querySelector('#settings-online')).not.toBeNull();
  });

  it('online group reads and writes config.json through the narrow commands only', async () => {
    await mountAt('/settings?section=online');

    // 文件缺失 → 默认值生效（公告 on-launch、内容外链确认开），不写空壳文件。
    expect(container.textContent).toContain('公告检查');
    expect(container.textContent).toContain('内容外链确认');
    expect(container.textContent).toContain('C:\\cfg\\config.json');
    expect(
      invokeMock.mock.calls.filter((call) => call[0] === 'desktop_config_read'),
    ).toHaveLength(1);
    expect(
      invokeMock.mock.calls.filter((call) => call[0] === 'desktop_config_write'),
    ).toHaveLength(0);

    // 关掉「内容外链确认」→ 整份文档写回，expectedRevision=null（缺失文件的首次创建）。
    const toggle = [...container.querySelectorAll('[role="switch"]')].find(
      (el) => el.getAttribute('aria-label') === '内容外链确认',
    );
    await click(toggle ?? null);

    const writeCalls = invokeMock.mock.calls.filter(
      (call) => call[0] === 'desktop_config_write',
    );
    expect(writeCalls).toHaveLength(1);
    const request = (writeCalls[0]?.[1] as { request?: { expectedRevision: string | null; content: string } })
      ?.request;
    expect(request?.expectedRevision).toBeNull();
    const doc = JSON.parse(request?.content ?? '{}') as {
      version?: number;
      externalLinks?: { confirmContentLinks?: boolean };
    };
    expect(doc.version).toBe(1);
    expect(doc.externalLinks?.confirmContentLinks).toBe(false);
  });

  it('data group carries the public cache card — stats read plus captureEnabled write (D5.1-K1)', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'public_read_cache_stats') {
        return {
          status: 'ready',
          path: 'C:\\data\\public-read-cache.sqlite',
          usageBytes: 2 * 1024 * 1024,
          entryCount: 3,
          summaryCount: 3,
          bodyCount: 2,
          withdrawnCount: 1,
          appliedPolicy: { captureEnabled: true, maxBytes: 268_435_456, whenFull: 'pause' },
        };
      }
      return defaultInvokeImpl(command);
    });
    await mountAt('/settings?section=data');

    // 缓存卡挂在「数据」组：三个策略控件 + 统计读取经窄命令。
    expect(container.querySelector('#settings-data')).not.toBeNull();
    expect(container.textContent).toContain('公开资料缓存');
    expect(container.textContent).toContain('public-read-cache.sqlite');
    expect(
      invokeMock.mock.calls.filter((call) => call[0] === 'public_read_cache_stats'),
    ).toHaveLength(1);

    // 文件缺失 → 默认 captureEnabled=true 生效；关闭后整份文档写回。
    const toggle = [...container.querySelectorAll('[role="switch"]')].find(
      (el) => el.getAttribute('aria-label') === '缓存公开资料',
    );
    expect(toggle?.getAttribute('aria-checked')).toBe('true');
    await click(toggle ?? null);

    const writeCalls = invokeMock.mock.calls.filter(
      (call) => call[0] === 'desktop_config_write',
    );
    expect(writeCalls).toHaveLength(1);
    const request = (writeCalls[0]?.[1] as { request?: { content?: string } })?.request;
    const doc = JSON.parse(request?.content ?? '{}') as {
      publicLibraryCache?: { captureEnabled?: boolean; maxBytes?: unknown; whenFull?: string };
    };
    expect(doc.publicLibraryCache?.captureEnabled).toBe(false);
    expect(doc.publicLibraryCache?.maxBytes).toBe(268_435_456);
    expect(doc.publicLibraryCache?.whenFull).toBe('pause');

    // 两步确认才发 clear——第一步点击不出 IPC。
    const clearButton = [...container.querySelectorAll('button')].find(
      (el) => el.textContent === '清除公开缓存',
    );
    await click(clearButton ?? null);
    expect(
      invokeMock.mock.calls.filter((call) => call[0] === 'public_read_cache_clear'),
    ).toHaveLength(0);
    const confirm = [...container.querySelectorAll('button')].find(
      (el) => el.textContent === '确认清除',
    );
    await click(confirm ?? null);
    expect(
      invokeMock.mock.calls.filter((call) => call[0] === 'public_read_cache_clear'),
    ).toHaveLength(1);
  });

  it('enabling eviction or lowering budget below usage requires explicit confirmation (K1-r1)', async () => {
    // DESK-CACHE-003：会真实删除已缓存副本的两个动作（开自动清理、evict
    // 模式下把上限调到低于当前用量）必须先经确认条，确认才写回 config。
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'public_read_cache_stats') {
        return {
          status: 'ready',
          path: 'C:\\data\\public-read-cache.sqlite',
          usageBytes: 300 * 1024 * 1024,
          entryCount: 12,
          summaryCount: 12,
          bodyCount: 5,
          withdrawnCount: 0,
          appliedPolicy: {
            captureEnabled: true,
            maxBytes: 268_435_456,
            whenFull: 'evict-least-recently-used',
          },
        };
      }
      return defaultInvokeImpl(command);
    });
    const lastWriteDoc = () => {
      const call = invokeMock.mock.calls
        .filter((entry) => entry[0] === 'desktop_config_write')
        .at(-1);
      return JSON.parse(
        (call?.[1] as { request?: { content?: string } })?.request?.content ?? '{}',
      ) as { publicLibraryCache?: { whenFull?: string; maxBytes?: unknown } };
    };
    const writeCount = () =>
      invokeMock.mock.calls.filter((call) => call[0] === 'desktop_config_write').length;
    await mountAt('/settings?section=data');
    // 等统计就绪——用量判断依赖 stats，未就绪时降预算走「用量未知」确认分支。
    await vi.waitFor(() => {
      expect(container.textContent).toContain('public-read-cache.sqlite');
    });

    // 取消路径：选「自动清理最久未用」只出确认条，不落盘。
    const evictOption = [...container.querySelectorAll('button')].find(
      (el) => el.textContent === '自动清理最久未用',
    );
    await click(evictOption ?? null);
    expect(
      container.querySelector('[data-testid="public-cache-eviction-confirm"]'),
    ).not.toBeNull();
    expect(writeCount()).toBe(0);
    const cancel = [
      ...container.querySelectorAll(
        '[data-testid="public-cache-eviction-confirm"] button',
      ),
    ].find((el) => el.textContent === '取消');
    await click(cancel ?? null);
    expect(
      container.querySelector('[data-testid="public-cache-eviction-confirm"]'),
    ).toBeNull();
    expect(writeCount()).toBe(0);

    // 确认路径：同一选择经确认后写回 evict 策略。
    await click(evictOption ?? null);
    const confirmEvict = [
      ...container.querySelectorAll(
        '[data-testid="public-cache-eviction-confirm"] button',
      ),
    ].find((el) => el.textContent === '确认');
    await click(confirmEvict ?? null);
    await vi.waitFor(() => {
      expect(writeCount()).toBe(1);
    });
    expect(lastWriteDoc().publicLibraryCache?.whenFull).toBe(
      'evict-least-recently-used',
    );

    // evict 模式下把上限调到低于当前用量（300MiB 占用 → 128MiB）：
    // 确认条须列出将回收的条目/正文数量，确认后写回新上限。
    const budget128 = [...container.querySelectorAll('button')].find(
      (el) => el.textContent === '128 MiB',
    );
    await click(budget128 ?? null);
    const confirmBar = container.querySelector(
      '[data-testid="public-cache-eviction-confirm"]',
    );
    expect(confirmBar?.textContent).toContain('12 条');
    expect(confirmBar?.textContent).toContain('5 条');
    expect(writeCount()).toBe(1);
    const confirmBudget = [...confirmBar!.querySelectorAll('button')].find(
      (el) => el.textContent === '确认',
    );
    await click(confirmBudget ?? null);
    await vi.waitFor(() => {
      expect(writeCount()).toBe(2);
    });
    expect(lastWriteDoc().publicLibraryCache?.maxBytes).toBe(128 * 1024 * 1024);
  });

  it('stale stats cannot bypass the budget-lowering confirmation in evict mode (K1-r2)', async () => {
    // 统计是挂载时读的旧快照——缓存增长后「旧统计低于新上限」不能成为
    // 跳过确认的依据：evict 模式下任何降预算都先确认。
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'desktop_config_read') {
        return {
          path: 'C:\\cfg\\config.json',
          directory: 'C:\\cfg',
          backupPresent: false,
          invalidPresent: false,
          file: {
            status: 'ok' as const,
            revision: `sha256:${'a'.repeat(64)}`,
            content:
              '{"version":1,"publicLibraryCache":{"captureEnabled":true,"maxBytes":536870912,"whenFull":"evict-least-recently-used"}}',
          },
        };
      }
      if (command === 'public_read_cache_stats') {
        return {
          status: 'ready',
          path: 'C:\\data\\public-read-cache.sqlite',
          // 旧统计用量低于即将选择的新上限——确认条不得因此缺席。
          usageBytes: 100 * 1024 * 1024,
          entryCount: 4,
          summaryCount: 4,
          bodyCount: 1,
          withdrawnCount: 0,
          appliedPolicy: {
            captureEnabled: true,
            maxBytes: 536_870_912,
            whenFull: 'evict-least-recently-used',
          },
        };
      }
      return defaultInvokeImpl(command);
    });
    await mountAt('/settings?section=data');
    await vi.waitFor(() => {
      expect(container.textContent).toContain('public-read-cache.sqlite');
    });

    const budget256 = [...container.querySelectorAll('button')].find(
      (el) => el.textContent === '256 MiB（默认）',
    );
    await click(budget256 ?? null);
    const confirmBar = container.querySelector(
      '[data-testid="public-cache-eviction-confirm"]',
    );
    expect(confirmBar).not.toBeNull();
    expect(confirmBar?.textContent).toContain('统计可能滞后');
    expect(
      invokeMock.mock.calls.filter((call) => call[0] === 'desktop_config_write'),
    ).toHaveLength(0);
    const confirm = [...confirmBar!.querySelectorAll('button')].find(
      (el) => el.textContent === '确认',
    );
    await click(confirm ?? null);
    await vi.waitFor(() => {
      expect(
        invokeMock.mock.calls.filter((call) => call[0] === 'desktop_config_write'),
      ).toHaveLength(1);
    });
    const request = (
      invokeMock.mock.calls
        .filter((call) => call[0] === 'desktop_config_write')
        .at(-1)?.[1] as { request?: { content?: string } }
    )?.request;
    const doc = JSON.parse(request?.content ?? '{}') as {
      publicLibraryCache?: { maxBytes?: unknown };
    };
    expect(doc.publicLibraryCache?.maxBytes).toBe(256 * 1024 * 1024);
  });

  it('appearance group carries the Esc 快捷菜单 toggle wired to desktop.escapeMenu.enabled', async () => {
    // D5.1-N1：开关是 config.json 字段（desktop.escapeMenu.enabled，默认 true），
    // 挂在外观与交互组——与「在线与通知」共用同一个 DesktopConfigStore 读写路径。
    await mountAt('/settings?section=appearance');

    const toggle = [...container.querySelectorAll('[role="switch"]')].find(
      (el) => el.getAttribute('aria-label') === 'Esc 快捷菜单',
    );
    expect(toggle).not.toBeUndefined();
    // 文件缺失 → 默认 true 生效，且不写空壳文件。
    expect(toggle?.getAttribute('aria-checked')).toBe('true');
    expect(
      invokeMock.mock.calls.filter((call) => call[0] === 'desktop_config_write'),
    ).toHaveLength(0);

    await click(toggle ?? null);

    const writeCalls = invokeMock.mock.calls.filter(
      (call) => call[0] === 'desktop_config_write',
    );
    expect(writeCalls).toHaveLength(1);
    const request = (writeCalls[0]?.[1] as { request?: { content?: string } })?.request;
    const doc = JSON.parse(request?.content ?? '{}') as {
      desktop?: { escapeMenu?: { enabled?: boolean } };
    };
    expect(doc.desktop?.escapeMenu?.enabled).toBe(false);
  });

  it('disables the Esc 快捷菜单 toggle while config.json is unavailable', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'desktop_config_read') {
        throw { code: 'io-error', message: '读取配置文件失败' };
      }
      return defaultInvokeImpl(command);
    });
    await mountAt('/settings?section=appearance');

    // 读失败 → 开关整卡降级为「暂不可用」说明，不渲染可操作控件。
    expect(container.textContent).toContain('配置暂不可用');
    expect(
      [...container.querySelectorAll('[role="switch"]')].find(
        (el) => el.getAttribute('aria-label') === 'Esc 快捷菜单',
      ),
    ).toBeUndefined();
  });

  it('config-conflict surfaces a draft banner — reapply lands the edit over the new base', async () => {
    let reads = 0;
    let writes = 0;
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'desktop_config_read') {
        reads += 1;
        return {
          path: 'C:\\cfg\\config.json',
          directory: 'C:\\cfg',
          backupPresent: false,
          invalidPresent: false,
          file:
            reads === 1
              ? {
                  status: 'ok' as const,
                  revision: `sha256:${'a'.repeat(64)}`,
                  content: '{"version":1}',
                }
              : {
                  status: 'ok' as const,
                  revision: `sha256:${'c'.repeat(64)}`,
                  content: '{"version":1,"announcements":{"checkPolicy":"manual"}}',
                },
        };
      }
      if (command === 'desktop_config_write') {
        writes += 1;
        if (writes === 1) {
          throw { code: 'config-conflict', message: '配置文件已被外部修改；请重新加载后重试' };
        }
        return { revision: `sha256:${'b'.repeat(64)}` };
      }
      return defaultInvokeImpl(command);
    });
    await mountAt('/settings?section=online');

    const toggle = [...container.querySelectorAll('[role="switch"]')].find(
      (el) => el.getAttribute('aria-label') === '内容外链确认',
    );
    await click(toggle ?? null);

    // 磁盘真相生效 + 草稿横幅出现。
    const banner = container.querySelector('[data-testid="config-conflicted-draft"]');
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toContain('内容外链确认');
    expect(writes).toBe(1);

    const reapply = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === '基于最新内容重新应用',
    );
    await click(reapply ?? null);
    expect(writes).toBe(2);
    const lastRequest = (
      invokeMock.mock.calls.filter((call) => call[0] === 'desktop_config_write').at(-1)?.[1] as {
        request?: { expectedRevision?: string | null; content?: string };
      }
    )?.request;
    expect(lastRequest?.expectedRevision).toBe(`sha256:${'c'.repeat(64)}`);
    const doc = JSON.parse(lastRequest?.content ?? '{}') as {
      externalLinks?: { confirmContentLinks?: boolean };
    };
    expect(doc.externalLinks?.confirmContentLinks).toBe(false);
    expect(container.querySelector('[data-testid="config-conflicted-draft"]')).toBeNull();
  });

  it('config-conflict on a non-online field surfaces the page-level draft banner (D5.1-N1-r1)', async () => {
    // 回归：Esc 开关在「外观与交互」组，但冲突草稿是文件级状态——反馈归
    // 页面共同位置的横幅，用户在哪个分组都能看到，不再藏进「在线与通知」。
    let writes = 0;
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'desktop_config_read') {
        return {
          path: 'C:\\cfg\\config.json',
          directory: 'C:\\cfg',
          backupPresent: false,
          invalidPresent: false,
          file: {
            status: 'ok' as const,
            revision: `sha256:${'a'.repeat(64)}`,
            content: '{"version":1}',
          },
        };
      }
      if (command === 'desktop_config_write') {
        writes += 1;
        throw { code: 'config-conflict', message: '配置文件已被外部修改；请重新加载后重试' };
      }
      return defaultInvokeImpl(command);
    });
    await mountAt('/settings?section=appearance');

    const toggle = [...container.querySelectorAll('[role="switch"]')].find(
      (el) => el.getAttribute('aria-label') === 'Esc 快捷菜单',
    );
    await click(toggle ?? null);

    const banner = container.querySelector('[data-testid="config-conflicted-draft"]');
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toContain('Esc 快捷菜单');
    // 横幅在页面级（不属于任一分组卡内），且保留 reapply/discard 动作。
    expect(container.querySelector('[data-testid="config-feedback"]')).not.toBeNull();
    expect(banner?.textContent).toContain('基于最新内容重新应用');
    expect(writes).toBe(1);
  });

  it('missing file with an .invalid quarantine leftover is reported, not read as never-created', async () => {
    // 回归（D5.1-S2-r3）：隔离恢复后落位失败的形态是「config.json 缺失 +
    // .invalid 存在」——设置页如实说明，不把它混同普通「从未创建」。
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'desktop_config_read') {
        return {
          path: 'C:\\cfg\\config.json',
          directory: 'C:\\cfg',
          backupPresent: false,
          invalidPresent: true,
          file: { status: 'missing' as const },
        };
      }
      return defaultInvokeImpl(command);
    });
    await mountAt('/settings?section=data');

    expect(container.querySelector('[data-testid="config-invalid-present"]')).not.toBeNull();
    expect(container.textContent).toContain('config.json.invalid');
    // 该形态按坏配置降级：缓存卡提示暂停，普通字段编辑整体禁用
    // （K1-r2：顺手改公告/Esc 不得顺手创建文件复活捕获），唯一出口是
    // 「创建默认配置」。
    expect(container.textContent).toContain('缓存配置无法校验');
    const cacheToggle = [...container.querySelectorAll('[role="switch"]')].find(
      (el) => el.getAttribute('aria-label') === '缓存公开资料',
    );
    expect((cacheToggle as HTMLButtonElement | undefined)?.disabled).toBe(true);
    expect(
      [...container.querySelectorAll('button')].some(
        (button) => button.textContent === '创建默认配置',
      ),
    ).toBe(true);
  });

  it('creating a default config over a quarantined-missing state issues a no-clobber write (K1-r1)', async () => {
    let writes = 0;
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'desktop_config_read') {
        return {
          path: 'C:\\cfg\\config.json',
          directory: 'C:\\cfg',
          backupPresent: false,
          invalidPresent: true,
          file: { status: 'missing' as const },
        };
      }
      if (command === 'desktop_config_write') {
        writes += 1;
        return { revision: `sha256:${'b'.repeat(64)}` };
      }
      return defaultInvokeImpl(command);
    });
    await mountAt('/settings?section=data');

    const createButton = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === '创建默认配置',
    );
    await click(createButton ?? null);

    await vi.waitFor(() => {
      expect(writes).toBe(1);
    });
    const request = (
      invokeMock.mock.calls.filter((call) => call[0] === 'desktop_config_write').at(-1)?.[1] as {
        request?: { expectedRevision?: string | null; content?: string };
      }
    )?.request;
    // no-clobber 首写不带 revision；写入的是完整默认文档。
    expect(request?.expectedRevision).toBeNull();
    const doc = JSON.parse(request?.content ?? '{}') as Record<string, unknown>;
    expect(doc.version).toBe(1);
    // 隔离残留如实保留，降级提示随落盘成功消失。
    expect(container.querySelector('[data-testid="config-invalid-present"]')).not.toBeNull();
    await vi.waitFor(() => {
      expect(container.textContent).not.toContain('缓存配置无法校验');
    });
  });

  it('device controls write only localStorage — no account or network IPC', async () => {
    await mountAt('/settings');
    invokeMock.mockClear();

    // 「减少动态效果」选项组里点「减少」档 → 存储键 + data-motion 根标记。
    const reduceButton = [...container.querySelectorAll('[role="radiogroup"] [role="radio"]')].find(
      (button) => button.textContent === '减少动态效果',
    );
    await click(reduceButton ?? null);

    expect(window.localStorage.getItem('mahoshojo.motion-preference')).toBe('reduce');
    expect(document.documentElement.dataset.motion).toBe('reduce');
    // 设备偏好不触发任何 IPC——离线可改（DESK-SET-007）。
    expect(invokeMock.mock.calls).toHaveLength(0);
  });

  it('accepts ?section= deep links and scrolls the matching group into view', async () => {
    await mountAt('/settings?section=generation');

    expect(container.querySelector('#settings-generation')).not.toBeNull();
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it('silently tolerates an invalid ?section= value', async () => {
    await mountAt('/settings?section=bogus');

    expect(container.querySelector('[data-testid="settings-page"]')).not.toBeNull();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});

describe('desktop settings page preferences', () => {
  const draftOutput = { mode: 'direct-local', phase: 'cancelled', rawText: '保留正文', card: null, some: 'result' };
  const seedDetailsDraft = () => {
    window.localStorage.setItem(
      DETAILS_DRAFT_KEY,
      JSON.stringify({
        version: 1,
        answers: { q1: '答复内容' },
        output: draftOutput,
        language: 'zh-CN',
        imageSaveMode: 'download',
        jsonSaveMode: 'download',
        showDetails: true,
        allowMultipleQuestionnaires: false,
        questionnaireSelections: ['q-a'],
      }),
    );
  };

  const readDraft = () => JSON.parse(window.localStorage.getItem(DETAILS_DRAFT_KEY) ?? 'null');

  it('shows the page preference fields from the draft document itself', async () => {
    seedDetailsDraft();
    await mountAt('/settings?section=generation');

    expect(container.textContent).toContain('设定生成（/details）');
    expect(container.textContent).toContain('残兽生成（/canshou）');
    expect(container.textContent).toContain('自由生成（/free）');
    // fields 形态如实告知：偏好与草稿同存一个键。
    expect(container.textContent).toContain(DETAILS_DRAFT_KEY);
  });

  it('empty draft key still renders default-valued controls — first change writes a valid draft shell', async () => {
    // 不预置草稿键：该页从未写入任何偏好（D5.1-S1-r1）。
    await mountAt('/settings?section=generation');

    expect(container.textContent).toContain('设定生成（/details）');
    expect(container.textContent).toContain('尚未写入任何偏好');
    const option = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === '预览弹窗保存',
    );
    await click(option ?? null);

    // fields 首写经草稿领域工厂：必填面（version/answers/language）+ 被改字段，
    // 不是 {imageSaveMode} 裸对象——产物能过 parseDraft 且被判为残余草稿。
    const draft = readDraft();
    expect(draft).toEqual({
      version: 1,
      answers: {},
      language: 'zh-CN',
      imageSaveMode: 'modal',
    });
  });

  it('writing a field goes to the page-owned draft key, preserving draft content', async () => {
    seedDetailsDraft();
    await mountAt('/settings?section=generation');

    // details 卡片里「设定长图保存方式」的「预览弹窗保存」选项。
    const option = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === '预览弹窗保存',
    );
    await click(option ?? null);

    const draft = readDraft();
    expect(draft.imageSaveMode).toBe('modal');
    // 字段级手术：草稿与结果原样保留。
    expect(draft.answers).toEqual({ q1: '答复内容' });
    expect(draft.output).toEqual(draftOutput);
    expect(draft.language).toBe('zh-CN');
  });

  it('resetting removes only preference keys — draft fields and language survive', async () => {
    seedDetailsDraft();
    await mountAt('/settings?section=generation');

    const resetButton = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === '重置该页偏好',
    );
    // 两步确认：第一次点击只是请求确认。
    await click(resetButton ?? null);
    const confirmButton = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === '确认重置',
    );
    await click(confirmButton ?? null);

    const draft = readDraft();
    expect(draft).not.toBeNull();
    for (const key of ['imageSaveMode', 'jsonSaveMode', 'showDetails', 'allowMultipleQuestionnaires', 'questionnaireSelections']) {
      expect(draft).not.toHaveProperty(key);
    }
    expect(draft.answers).toEqual({ q1: '答复内容' });
    expect(draft.output).toEqual(draftOutput);
    // 草稿自有字段不属于「页偏好」，重置不动它。
    expect(draft.language).toBe('zh-CN');
    expect(draft.version).toBe(1);
  });
});

describe.each([DESKTOP_DETAILS_PREFERENCES, DESKTOP_CANSHOU_PREFERENCES])('$pageId settings draft protection feedback', (source) => {
  const validDraft = { version: 1, answers: { q1: '保留回答' }, language: 'zh-CN', imageSaveMode: 'download', showDetails: true };
  const findCard = (): HTMLElement => {
    const card = [...container.querySelectorAll('h3')].find((heading) => heading.textContent === source.title)?.closest('section');
    expect(card).toBeDefined();
    return card!;
  };
  const findButton = (card: HTMLElement, text: string): HTMLButtonElement | null =>
    [...card.querySelectorAll('button')].find((button) => button.textContent === text) ?? null;

  it.each([
    ['future version', { ...validDraft, version: 99 }],
    ['invalid answers', { ...validDraft, answers: { q1: 7 } }],
  ])('shows the protection message and disables edits/reset for %s', async (_label, draft) => {
    const raw = JSON.stringify(draft, null, 2);
    window.localStorage.setItem(source.storageKey, raw);
    await mountAt('/settings?section=generation');

    const card = findCard();
    expect(card.textContent).toContain('草稿数据无法解析，为保护内容暂不可在此修改');
    expect(card.querySelector('[role="radio"], [role="switch"], input')).toBeNull();
    const reset = findButton(card, '重置该页偏好');
    expect(reset?.disabled).toBe(true);
    await click(reset);
    expect(findButton(card, '确认重置')).toBeNull();
    expect(card.querySelector('[role="status"]')).toBeNull();
    expect(window.localStorage.getItem(source.storageKey)).toBe(raw);
  });

  it.each(['write', 'reset'])('reports a failed %s if the draft becomes unsupported after render', async (action) => {
    window.localStorage.setItem(source.storageKey, JSON.stringify(validDraft));
    await mountAt('/settings?section=generation');
    const card = findCard();
    if (action === 'reset') await click(findButton(card, '重置该页偏好'));

    // 模拟 UI 仍持有旧读结果、提交前存储已改变；写入必须重新过 owner 校验。
    const raw = JSON.stringify({ ...validDraft, version: 99, extension: { keep: true } }, null, 2);
    window.localStorage.setItem(source.storageKey, raw);
    await click(findButton(card, action === 'write' ? '预览弹窗保存' : '确认重置'));

    expect(card.querySelector('[role="alert"]')?.textContent).toContain(action === 'write' ? '写入失败' : '重置失败');
    expect(card.querySelector('[role="status"]')).toBeNull();
    expect(card.textContent).toContain('草稿数据无法解析，为保护内容暂不可在此修改');
    expect(findButton(card, '重置该页偏好')?.disabled).toBe(true);
    expect(window.localStorage.getItem(source.storageKey)).toBe(raw);
  });
});
