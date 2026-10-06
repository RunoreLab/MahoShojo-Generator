// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DesktopLocalLibraryAuditFinding,
  DesktopLocalLibraryAuditReport,
} from '@mahoshojo/contracts/desktop-ipc';

import { LocalLibraryAuditPanel } from '../src/features/audit/LocalLibraryAuditPanel';
import {
  AUDIT_LOCAL_LIBRARY_COMMAND,
  COLLECT_LOCAL_GARBAGE_COMMAND,
} from '../src/platform/local-library-audit';

const bridge = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: bridge.invoke }));

/** 与桥接测试读同一份跨运行时 fixture（DESK-033）：桶形状以契约为准。 */
const maintenanceFixture = () => {
  const parsed = JSON.parse(
    readFileSync(
      path.resolve(process.cwd(), '..', '..', 'packages', 'contracts', 'fixtures', 'desktop-local-cards.json'),
      'utf8',
    ),
  ) as { maintenance: Record<string, Record<string, unknown> & { $case?: string }> };
  return parsed.maintenance;
};
const fixture = maintenanceFixture();
const stripCase = (value: Record<string, unknown>) => {
  const { $case: _case, ...rest } = value;
  return rest;
};
const finding = (key: string) =>
  stripCase(fixture[key]) as unknown as DesktopLocalLibraryAuditFinding;

const cleanReport: DesktopLocalLibraryAuditReport = {
  findings: [],
  schemaVersion: 4,
  referencedBlobCount: 3,
  blobMetadataCount: 3,
  webPackageCount: 2,
} as DesktopLocalLibraryAuditReport;

let root: Root;
let container: HTMLDivElement;
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
const waitFor = async (predicate: () => boolean, timeoutMs = 3000) => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('等待条件超时');
    await settle();
  }
};
const button = (label: string) =>
  [...container.querySelectorAll('button')].find((item) => item.textContent?.trim() === label) as HTMLButtonElement | undefined;
const click = (target: Element | undefined) => act(async () => {
  target!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});

/** 用真实计数器实现互斥，断言锁确实被获取/释放而不只是 prop 被传下去。 */
const lock = () => {
  let held = false;
  return {
    acquireOperation: vi.fn((): boolean => {
      if (held) return false;
      held = true;
      return true;
    }),
    releaseOperation: vi.fn((): void => {
      held = false;
    }),
  };
};

const mount = async (theLock = lock(), enabled = true, maintenanceBusy = false) => {
  await act(async () => {
    root.render(
      <LocalLibraryAuditPanel
      enabled={enabled}
      maintenanceBusy={maintenanceBusy}
      acquireOperation={theLock.acquireOperation}
      releaseOperation={theLock.releaseOperation}
      />,
    );
  });
  await settle();
  return theLock;
};

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  bridge.invoke.mockResolvedValue(cleanReport);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe('本地库完整性面板（IPC mock）', () => {
  it('初始态：可检查，清理入口在出报告前不开放', async () => {
    await mount();
    expect(button('检查完整性')?.disabled).toBe(false);
    expect(button('清理可回收空间')?.disabled).toBe(true);
  });

  it('干净报告显示规模分母与「未发现不一致」，清理入口保持关闭', async () => {
    await mount();
    await click(button('检查完整性'));
    await waitFor(() => container.textContent?.includes('未发现不一致') === true);
    expect(bridge.invoke).toHaveBeenCalledWith(AUDIT_LOCAL_LIBRARY_COMMAND, undefined);
    expect(container.textContent).toContain('本次检查覆盖 2 个包 / 3 份引用内容 / 3 条内容记录');
    expect(button('清理可回收空间')?.disabled).toBe(true);
  });

  it('损坏桶按警示呈现，可回收桶不作为损坏告警', async () => {
    bridge.invoke.mockResolvedValue({
      ...cleanReport,
      findings: [finding('auditFindingReferenceFileMissing'), finding('auditFindingOrphanFile')],
    });
    await mount();
    await click(button('检查完整性'));
    await waitFor(() => container.textContent?.includes('发现可能影响使用的问题') === true);
    expect(container.querySelector('p[role="alert"]')?.textContent).toContain('归档导出会跳过打不开的内容');
    expect(container.textContent).toContain('包找不到内容文件（1 条）');
    expect(container.textContent).toContain('无记录的文件（可回收空间）（1 条）');
    // 可回收候选存在 → 清理入口开放。
    expect(button('清理可回收空间')?.disabled).toBe(false);
  });

  it('清理走 collect_local_garbage 并在回收后重跑审计，报告真实回收结果', async () => {
    const gcReport = stripCase(fixture.gcReport);
    bridge.invoke.mockImplementation(async (command: string) => {
      if (command === AUDIT_LOCAL_LIBRARY_COMMAND) {
        return {
          ...cleanReport,
          findings: bridge.invoke.mock.calls.filter(([name]) => name === AUDIT_LOCAL_LIBRARY_COMMAND).length === 1
            ? [finding('auditFindingOrphanFile')]
            : [],
        };
      }
      if (command === COLLECT_LOCAL_GARBAGE_COMMAND) return gcReport;
      return undefined;
    });
    const theLock = await mount();
    await click(button('检查完整性'));
    await waitFor(() => button('清理可回收空间')?.disabled === false);

    await click(button('清理可回收空间'));
    await waitFor(() => container.textContent?.includes('已清理') === true);
    expect(bridge.invoke).toHaveBeenCalledWith(COLLECT_LOCAL_GARBAGE_COMMAND, undefined);
    // 回收改变了库状态：报告留在原地会冒充现状，必须重跑一次审计。
    const auditCalls = bridge.invoke.mock.calls.filter(([name]) => name === AUDIT_LOCAL_LIBRARY_COMMAND);
    expect(auditCalls).toHaveLength(2);
    await waitFor(() => container.textContent?.includes('未发现不一致') === true);
    // 回收完成后锁释放，下一次操作可以获取。
    expect(theLock.acquireOperation.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(theLock.releaseOperation).toHaveBeenCalledTimes(2);
  });

  it('部分文件删除失败时报告为警示而非静默成功', async () => {
    bridge.invoke.mockImplementation(async (command: string) => {
      if (command === AUDIT_LOCAL_LIBRARY_COMMAND) {
        return { ...cleanReport, findings: [finding('auditFindingOrphanFile')] };
      }
      if (command === COLLECT_LOCAL_GARBAGE_COMMAND) {
        return { ...stripCase(fixture.gcReport), filesFailed: 1 };
      }
      return undefined;
    });
    await mount();
    await click(button('检查完整性'));
    await waitFor(() => button('清理可回收空间')?.disabled === false);
    await click(button('清理可回收空间'));
    await waitFor(() => container.textContent?.includes('未能删除') === true);
    const alerts = [...container.querySelectorAll('p[role="alert"]')];
    expect(alerts.some((item) => item.textContent?.includes('会保留为无记录文件'))).toBe(true);
  });

  it('审计失败显示可诊断错误并释放锁，可重试', async () => {
    bridge.invoke.mockRejectedValueOnce({ code: 'audit-unavailable', message: '审计通道不可用' });
    const theLock = await mount();
    await click(button('检查完整性'));
    await waitFor(() => container.querySelector('p[role="alert"]') !== null);
    expect(container.querySelector('p[role="alert"]')?.textContent).toBe('审计通道不可用');
    expect(theLock.releaseOperation).toHaveBeenCalledTimes(1);

    bridge.invoke.mockResolvedValue(cleanReport);
    await click(button('检查完整性'));
    await waitFor(() => container.textContent?.includes('未发现不一致') === true);
  });

  it('维护锁被占时点击不发出任何 IPC——互斥是行为不是装饰', async () => {
    const theLock = lock();
    theLock.acquireOperation.mockReturnValueOnce(false);
    await mount(theLock);
    await click(button('检查完整性'));
    await settle();
    expect(bridge.invoke).not.toHaveBeenCalled();
    expect(theLock.releaseOperation).not.toHaveBeenCalled();
  });

  it('enabled=false 时两个操作入口都禁用', async () => {
    await mount(lock(), false);
    expect(button('检查完整性')?.disabled).toBe(true);
    expect(button('清理可回收空间')?.disabled).toBe(true);
  });

  it('页面级维护忙态下入口禁用且不可点出 IPC——互斥要有可见反馈', async () => {
    const theLock = await mount(lock(), true, true);
    expect(button('检查完整性')?.disabled).toBe(true);
    await click(button('检查完整性'));
    await settle();
    expect(bridge.invoke).not.toHaveBeenCalled();
    expect(theLock.acquireOperation).not.toHaveBeenCalled();
  });
});
