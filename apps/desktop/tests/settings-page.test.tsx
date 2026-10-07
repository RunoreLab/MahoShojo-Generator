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
  const seedDetailsDraft = () => {
    window.localStorage.setItem(
      DETAILS_DRAFT_KEY,
      JSON.stringify({
        version: 1,
        answers: { q1: '答复内容' },
        output: { some: 'result' },
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
    expect(draft.output).toEqual({ some: 'result' });
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
    expect(draft.output).toEqual({ some: 'result' });
    // 草稿自有字段不属于「页偏好」，重置不动它。
    expect(draft.language).toBe('zh-CN');
    expect(draft.version).toBe(1);
  });
});
