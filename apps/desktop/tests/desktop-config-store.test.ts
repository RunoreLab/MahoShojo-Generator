/**
 * `DesktopConfigStore` 的编排语义（D5.1-S2，DESK-SET-004..007）。
 *
 * 钉住的产品口径：
 *
 * 1. 文件状态如实投影：missing 用默认且不写空壳；oversized/invalid-utf8/域 fatal
 *    按默认值生效且不可编辑，但 revision 保留给显式「恢复默认」；
 * 2. 生效值 = 落盘值：写成功才前进 base；写失败不把内存值冒充已保存；
 * 3. 冲突让位：`config-conflict` 时未落盘编辑收拢为 delta 草稿并自动重载
 *    磁盘真相——effective = persisted，草稿不自动重放，可显式重新应用/放弃；
 * 4. 未登记键写回原样保留——UI 保存不毁损手工编辑过的文件；
 * 5. 连续写不丢更新：IPC 在途期间的编辑基于 `inFlight` 合并，不从旧 base
 *    重建而把在途写悄悄吞掉。
 */

import { describe, expect, it, vi } from 'vitest';

import { DESKTOP_CONFIG_DEFAULTS } from '@mahoshojo/contracts/desktop-config';

import { DesktopConfigStore } from '../src/features/config/desktop-config-store';

const REV_A = `sha256:${'a'.repeat(64)}`;
const REV_B = `sha256:${'b'.repeat(64)}`;
const REV_C = `sha256:${'c'.repeat(64)}`;

const readResult = (file: Record<string, unknown>) => ({
  path: 'C:\\cfg\\config.json',
  directory: 'C:\\cfg',
  backupPresent: false,
  file,
});

const okFile = (content: string, revision = REV_A) => ({
  status: 'ok' as const,
  revision,
  content,
});

// 返回值不注解为 InvokeFn——注解会把 vi.fn 的 Mock 类型擦成纯函数签名。
const makeInvoke = (impl: (command: string, args?: Record<string, unknown>) => Promise<unknown>) =>
  vi.fn(impl);

describe('desktop config store — read projection', () => {
  it('missing file yields defaults and stays editable without writing a shell file', async () => {
    const invoke = makeInvoke(async (command) => {
      if (command === 'desktop_config_read') return readResult({ status: 'missing' });
      return undefined;
    });
    const store = new DesktopConfigStore({ invoke });

    await store.ready();

    expect(store.getSnapshot().status).toBe('ready');
    expect(store.getSnapshot().fileStatus).toBe('missing');
    expect(store.getSnapshot().values).toEqual(DESKTOP_CONFIG_DEFAULTS);
    expect(store.getSnapshot().diagnostics).toEqual([]);
    expect(store.editable()).toBe(true);
    // 只读不写：缺失是正常形态，不产生 desktop_config_write。
    expect(invoke.mock.calls.map((call) => call[0])).not.toContain('desktop_config_write');
  });

  it('ready() is idempotent — one read per process, not one per caller', async () => {
    const invoke = makeInvoke(async (command) => {
      if (command === 'desktop_config_read') return readResult({ status: 'missing' });
      return undefined;
    });
    const store = new DesktopConfigStore({ invoke });

    await Promise.all([store.ready(), store.ready(), store.ready()]);

    expect(
      invoke.mock.calls.filter((call) => call[0] === 'desktop_config_read'),
    ).toHaveLength(1);
  });

  it('projects registered values and per-field diagnostics from an ok file', async () => {
    const invoke = makeInvoke(async (command) => {
      if (command === 'desktop_config_read') {
        return readResult(
          okFile(
            JSON.stringify({
              version: 1,
              announcements: { checkPolicy: 'manual' },
              externalLinks: { confirmContentLinks: 'yes' },
            }),
          ),
        );
      }
      return undefined;
    });
    const store = new DesktopConfigStore({ invoke });

    await store.ready();

    const state = store.getSnapshot();
    expect(state.values.announcementsCheckPolicy).toBe('manual');
    // 非法值按更保守的 true 降级并留诊断（DESK-SET-007）。
    expect(state.values.confirmContentLinks).toBe(true);
    expect(state.diagnostics).toHaveLength(1);
    expect(state.diagnostics[0]?.path).toBe('$.externalLinks.confirmContentLinks');
    expect(store.editable()).toBe(true);
  });

  it('fatal file (version/JSON) yields defaults, diagnostics and a non-editable surface', async () => {
    const invoke = makeInvoke(async (command) => {
      if (command === 'desktop_config_read') {
        return readResult(okFile('{"version":2,"announcements":{"checkPolicy":"manual"}}'));
      }
      return undefined;
    });
    const store = new DesktopConfigStore({ invoke });

    await store.ready();

    const state = store.getSnapshot();
    expect(state.fileFatal).toBe(true);
    expect(state.values).toEqual(DESKTOP_CONFIG_DEFAULTS);
    expect(state.diagnostics.some((d) => d.path === '$')).toBe(true);
    expect(store.editable()).toBe(false);
  });

  it('oversized and invalid-utf8 files keep revision for explicit reset, defaults in effect', async () => {
    for (const file of [
      { status: 'oversized' as const, revision: REV_A, bytes: 70 * 1024 },
      { status: 'invalid-utf8' as const, revision: REV_A },
    ]) {
      const invoke = makeInvoke(async (command) => {
        if (command === 'desktop_config_read') return readResult(file);
        return undefined;
      });
      const store = new DesktopConfigStore({ invoke });

      await store.ready();

      expect(store.getSnapshot().fileStatus).toBe(file.status);
      expect(store.getSnapshot().values).toEqual(DESKTOP_CONFIG_DEFAULTS);
      expect(store.editable()).toBe(false);
    }
  });

  it('IPC failure lands in unavailable with defaults — consumers degrade by their own rules', async () => {
    const invoke = makeInvoke(async (command) => {
      if (command === 'desktop_config_read') {
        throw { code: 'storage-unavailable', message: '配置目录不可写' };
      }
      return undefined;
    });
    const store = new DesktopConfigStore({ invoke });

    await store.ready();

    expect(store.getSnapshot().status).toBe('unavailable');
    expect(store.getSnapshot().readError).toContain('配置目录不可写');
    expect(store.getSnapshot().values).toEqual(DESKTOP_CONFIG_DEFAULTS);
    expect(store.editable()).toBe(false);
  });
});

describe('desktop config store — write semantics', () => {
  it('setField advances the effective value only after the write lands', async () => {
    const invoke = makeInvoke(async (command) => {
      if (command === 'desktop_config_read') {
        return readResult(okFile('{"version":1,"announcements":{"checkPolicy":"on-launch"}}'));
      }
      if (command === 'desktop_config_write') return { revision: REV_B };
      return undefined;
    });
    const store = new DesktopConfigStore({ invoke });
    await store.ready();

    store.setField('confirmContentLinks', false);
    await vi.waitFor(() => {
      expect(store.getSnapshot().saving).toBe(false);
    });

    expect(invoke.mock.calls.filter((call) => call[0] === 'desktop_config_write')).toHaveLength(1);
    expect(store.getSnapshot().values.confirmContentLinks).toBe(false);
    expect(store.getSnapshot().saveError).toBeNull();
  });

  it('write request carries expectedRevision and preserves unregistered keys', async () => {
    const original =
      '{"version":1,"announcements":{"checkPolicy":"on-launch","futureKey":42},"custom":true}';
    let captured: { expectedRevision?: string | null; content?: string } | null = null;
    const invoke = makeInvoke(async (command, args) => {
      if (command === 'desktop_config_read') return readResult(okFile(original));
      if (command === 'desktop_config_write') {
        captured = (args?.request ?? null) as typeof captured;
        return { revision: REV_B };
      }
      return undefined;
    });
    const store = new DesktopConfigStore({ invoke });
    await store.ready();

    store.setField('announcementsCheckPolicy', 'manual');
    await vi.waitFor(() => {
      expect(
        invoke.mock.calls.filter((call) => call[0] === 'desktop_config_write'),
      ).toHaveLength(1);
    });

    expect(captured?.expectedRevision).toBe(REV_A);
    const doc = JSON.parse(captured?.content ?? '{}') as Record<string, unknown>;
    expect(doc).toMatchObject({
      version: 1,
      announcements: { checkPolicy: 'manual', futureKey: 42 },
      custom: true,
    });
    expect(store.getSnapshot().values.announcementsCheckPolicy).toBe('manual');
    // 未登记键仍按诊断列出——文件能用但不是「完全干净」。
    expect(store.getSnapshot().diagnostics.length).toBeGreaterThan(0);
  });

  it('write failure surfaces saveError and does not pretend the value persisted', async () => {
    const invoke = makeInvoke(async (command) => {
      if (command === 'desktop_config_read') {
        return readResult(okFile('{"version":1}'));
      }
      if (command === 'desktop_config_write') {
        throw { code: 'storage-unavailable', message: '磁盘只读' };
      }
      return undefined;
    });
    const store = new DesktopConfigStore({ invoke });
    await store.ready();

    store.setField('confirmContentLinks', false);
    await vi.waitFor(() => {
      expect(store.getSnapshot().saveError).not.toBeNull();
    });

    expect(store.getSnapshot().saveError).toContain('磁盘只读');
    // 生效值不冒充落盘：base 仍停在磁盘事实。
    expect(store.getSnapshot().values.confirmContentLinks).toBe(true);
  });

  it('config-conflict reloads disk truth instead of overwriting both sides', async () => {
    const externalContent =
      '{"version":1,"announcements":{"checkPolicy":"manual"},"externalLinks":{"confirmContentLinks":false}}';
    let reads = 0;
    const invoke = makeInvoke(async (command) => {
      if (command === 'desktop_config_read') {
        reads += 1;
        // 第二次读返回外部改动后的文件。
        return readResult(
          reads === 1
            ? okFile('{"version":1}')
            : okFile(externalContent, REV_C),
        );
      }
      if (command === 'desktop_config_write') {
        throw { code: 'config-conflict', message: '配置文件已被外部修改；请重新加载后重试' };
      }
      return undefined;
    });
    const store = new DesktopConfigStore({ invoke });
    await store.ready();

    store.setField('confirmContentLinks', true);
    await vi.waitFor(() => {
      expect(reads).toBe(2);
    });

    const state = store.getSnapshot();
    // 冲突后自动重载：显示磁盘真相，不报「已保存」。
    expect(state.values.announcementsCheckPolicy).toBe('manual');
    expect(state.values.confirmContentLinks).toBe(false);
    expect(state.saving).toBe(false);
  });

  it('config-conflict keeps the attempted edit as a draft, reapplied over the new base only on demand', async () => {
    const externalContent = '{"version":1,"announcements":{"checkPolicy":"manual"}}';
    let reads = 0;
    let writes = 0;
    let lastWrite: { expectedRevision?: string | null; content?: string } | null = null;
    const invoke = makeInvoke(async (command, args) => {
      if (command === 'desktop_config_read') {
        reads += 1;
        return readResult(reads === 1 ? okFile('{"version":1}') : okFile(externalContent, REV_C));
      }
      if (command === 'desktop_config_write') {
        writes += 1;
        lastWrite = (args?.request ?? null) as typeof lastWrite;
        if (writes === 1) {
          throw { code: 'config-conflict', message: '配置文件已被外部修改；请重新加载后重试' };
        }
        return { revision: REV_B };
      }
      return undefined;
    });
    const store = new DesktopConfigStore({ invoke });
    await store.ready();

    store.setField('confirmContentLinks', false);
    await vi.waitFor(() => {
      expect(reads).toBe(2);
    });

    // 磁盘版本立即成为 effective；刚才的修改是草稿，不自动重放。
    let state = store.getSnapshot();
    expect(state.values.announcementsCheckPolicy).toBe('manual');
    expect(state.values.confirmContentLinks).toBe(true);
    expect(state.conflictedFields).toEqual(['confirmContentLinks']);
    expect(state.saveError).toContain('重新应用');
    expect(writes).toBe(1);

    store.reapplyConflictedDraft();
    await vi.waitFor(() => {
      expect(writes).toBe(2);
    });

    // delta 合到磁盘基底：外部改动不被回滚，只补刚才未落盘的字段。
    expect(lastWrite?.expectedRevision).toBe(REV_C);
    const doc = JSON.parse(lastWrite?.content ?? '{}') as {
      announcements?: { checkPolicy?: string };
      externalLinks?: { confirmContentLinks?: boolean };
    };
    expect(doc.announcements?.checkPolicy).toBe('manual');
    expect(doc.externalLinks?.confirmContentLinks).toBe(false);
    await vi.waitFor(() => {
      expect(store.getSnapshot().saving).toBe(false);
    });
    expect(store.getSnapshot().conflictedFields).toBeNull();
    expect(store.getSnapshot().saveError).toBeNull();
  });

  it('discarding the conflict draft keeps disk truth and issues no further write', async () => {
    let reads = 0;
    let writes = 0;
    const invoke = makeInvoke(async (command) => {
      if (command === 'desktop_config_read') {
        reads += 1;
        return readResult(
          reads === 1
            ? okFile('{"version":1}')
            : okFile('{"version":1,"externalLinks":{"confirmContentLinks":false}}', REV_C),
        );
      }
      if (command === 'desktop_config_write') {
        writes += 1;
        throw { code: 'config-conflict', message: '配置文件已被外部修改；请重新加载后重试' };
      }
      return undefined;
    });
    const store = new DesktopConfigStore({ invoke });
    await store.ready();

    store.setField('announcementsCheckPolicy', 'manual');
    await vi.waitFor(() => {
      expect(store.getSnapshot().conflictedFields).toEqual(['announcementsCheckPolicy']);
    });

    store.discardConflictedDraft();
    expect(store.getSnapshot().conflictedFields).toBeNull();
    // 放弃草稿不再发写——磁盘真相就是最终值。
    expect(writes).toBe(1);
    expect(store.getSnapshot().values.confirmContentLinks).toBe(false);
  });

  it('edits made while a write is in flight merge over the in-flight target instead of the stale base', async () => {
    let releaseFirst: (() => void) | null = null;
    let writes = 0;
    const contents: string[] = [];
    const invoke = makeInvoke((command, args) => {
      if (command === 'desktop_config_read') {
        return Promise.resolve(readResult(okFile('{"version":1}')));
      }
      if (command === 'desktop_config_write') {
        writes += 1;
        contents.push((args?.request as { content?: string })?.content ?? '');
        if (writes === 1) {
          // 卡住第一次 IPC，制造「在途写」窗口。
          return new Promise((resolve) => {
            releaseFirst = () => resolve({ revision: REV_B });
          });
        }
        return Promise.resolve({ revision: REV_C });
      }
      return Promise.resolve(undefined);
    });
    const store = new DesktopConfigStore({ invoke });
    await store.ready();

    store.setField('announcementsCheckPolicy', 'manual');
    await vi.waitFor(() => {
      expect(writes).toBe(1);
    });
    // 写 1 已取走 pending 但尚未落盘：此刻的第二个编辑必须从在途目标
    // 合并，否则写 1 的改动会被旧 base 静默吞掉。
    store.setField('confirmContentLinks', false);
    releaseFirst?.();

    await vi.waitFor(() => {
      expect(writes).toBe(2);
    });
    const second = JSON.parse(contents[1] ?? '{}') as {
      announcements?: { checkPolicy?: string };
      externalLinks?: { confirmContentLinks?: boolean };
    };
    expect(second.announcements?.checkPolicy).toBe('manual');
    expect(second.externalLinks?.confirmContentLinks).toBe(false);
    await vi.waitFor(() => {
      expect(store.getSnapshot().saving).toBe(false);
    });
    expect(store.getSnapshot().values.announcementsCheckPolicy).toBe('manual');
    expect(store.getSnapshot().values.confirmContentLinks).toBe(false);
  });

  it('a successful reload clears a stale saveError', async () => {
    const invoke = makeInvoke(async (command) => {
      if (command === 'desktop_config_read') return readResult(okFile('{"version":1}'));
      if (command === 'desktop_config_write') {
        throw { code: 'storage-unavailable', message: '磁盘只读' };
      }
      return undefined;
    });
    const store = new DesktopConfigStore({ invoke });
    await store.ready();

    store.setField('confirmContentLinks', false);
    await vi.waitFor(() => {
      expect(store.getSnapshot().saveError).not.toBeNull();
    });

    await store.reload();
    expect(store.getSnapshot().saveError).toBeNull();
  });

  it('setField is a no-op when the file cannot serve as an edit base', async () => {
    const invoke = makeInvoke(async (command) => {
      if (command === 'desktop_config_read') {
        return readResult(okFile('{broken'));
      }
      return undefined;
    });
    const store = new DesktopConfigStore({ invoke });
    await store.ready();

    store.setField('confirmContentLinks', false);

    expect(invoke.mock.calls.map((call) => call[0])).not.toContain('desktop_config_write');
  });

  it('explicit resetToDefaults writes defaults with the real revision on a fatal file', async () => {
    let captured: { expectedRevision?: string | null; content?: string } | null = null;
    const invoke = makeInvoke(async (command, args) => {
      if (command === 'desktop_config_read') {
        return readResult(okFile('{"version":2,"anything":true}'));
      }
      if (command === 'desktop_config_write') {
        captured = (args?.request ?? null) as typeof captured;
        return { revision: REV_B };
      }
      return undefined;
    });
    const store = new DesktopConfigStore({ invoke });
    await store.ready();
    expect(store.editable()).toBe(false);

    store.resetToDefaults();
    await vi.waitFor(() => {
      expect(store.getSnapshot().saving).toBe(false);
    });

    expect(captured?.expectedRevision).toBe(REV_A);
    const doc = JSON.parse(captured?.content ?? '{}') as { version?: number; anything?: unknown };
    expect(doc.version).toBe(1);
    // 恢复默认不保留未知键——显式动作，不是静默覆盖。
    expect(doc.anything).toBeUndefined();
    expect(store.getSnapshot().fileFatal).toBe(false);
  });

  it('explicit reload re-reads the file (hand-edited values arrive)', async () => {
    let content = '{"version":1,"announcements":{"checkPolicy":"on-launch"}}';
    const invoke = makeInvoke(async (command) => {
      if (command === 'desktop_config_read') return readResult(okFile(content));
      return undefined;
    });
    const store = new DesktopConfigStore({ invoke });
    await store.ready();
    expect(store.getSnapshot().values.announcementsCheckPolicy).toBe('on-launch');

    content = '{"version":1,"announcements":{"checkPolicy":"manual"}}';
    await store.reload();

    expect(store.getSnapshot().values.announcementsCheckPolicy).toBe('manual');
    expect(
      invoke.mock.calls.filter((call) => call[0] === 'desktop_config_read'),
    ).toHaveLength(2);
  });
});
