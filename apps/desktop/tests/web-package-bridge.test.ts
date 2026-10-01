import { describe, expect, it } from 'vitest';

import { LocalWebPackageRecordV1Schema, type LocalWebPackageRecordV1 } from '@mahoshojo/local-library/web-package-record';
import { DesktopSaveWebPackageResponseSchema } from '@mahoshojo/contracts/desktop-ipc';

import { DesktopLocalCardError } from '../src/platform/local-card-bridge';
import {
  DELETE_WEB_PACKAGE_COMMAND,
  GET_WEB_PACKAGE_COMMAND,
  LIST_WEB_PACKAGES_COMMAND,
  PURGE_WEB_PACKAGE_COMMAND,
  READ_WEB_PACKAGE_ARCHIVE_COMMAND,
  RESTORE_WEB_PACKAGE_COMMAND,
  SAVE_WEB_PACKAGE_COMMAND,
  IpcWebPackageRepository,
  fromBase64Bytes,
  toBase64Bytes,
  toWebPackageIndex,
} from '../src/platform/web-package-bridge';

const DIGEST = `sha256:${'a'.repeat(64)}`;
const PKG_ID = 'wp_0123456789abcdef0123456789abcdef';
const ARCHIVE = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x7a]);

const record = (overrides: Partial<LocalWebPackageRecordV1> = {}): LocalWebPackageRecordV1 =>
  LocalWebPackageRecordV1Schema.parse({
    id: PKG_ID,
    schemaVersion: 1,
    storageLocation: 'local',
    entityKind: 'web-package',
    title: '包',
    summary: 'local.x@1.0.0',
    ref: { digest: DIGEST, id: 'local.x', version: '1.0.0' },
    manifest: {
      format: 'mahoshojo-web-package',
      formatVersion: 1,
      id: 'local.x',
      version: '1.0.0',
      name: '包',
entry: 'index.html',
    generation: { target: 'index.html', mode: 'replace', mediaType: 'text/html' },
    capabilities: [],
      files: [{ path: 'index.html', mediaType: 'text/html', digest: DIGEST, size: 2 }],
    },
    contentDigest: DIGEST,
    archiveByteLength: ARCHIVE.byteLength,
    provenance: { kind: 'unsigned', execution: 'imported' },
    createdAt: '2026-09-30T12:00:00.000Z',
    updatedAt: '2026-09-30T12:00:00.000Z',
    ...overrides,
  });

const documentField = (document: string, field: string): string | undefined => {
  const value = (JSON.parse(document) as Record<string, unknown>)[field];
  return typeof value === 'string' ? value : undefined;
};

describe('base64 载荷编解码', () => {
  it('与标准 base64 一致，且覆盖 0/1/2/3 字节的补位情形', () => {
    // 期望值取自 Node 的 Buffer.toString('base64')：漂移的表现是"存进去读不出来"。
    for (const [bytes, expected] of [
      [new Uint8Array([]), ''],
      [new Uint8Array([0x50]), 'UA=='],
      [new Uint8Array([0x50, 0x4b]), 'UEs='],
      [new Uint8Array([0x50, 0x4b, 0x03]), 'UEsD'],
      [new Uint8Array([0x50, 0x4b, 0x03, 0x04]), 'UEsDBA=='],
    ] as const) {
      const payload = toBase64Bytes(bytes);
      expect(payload.b64, `len=${bytes.byteLength}`).toBe(expected);
      expect(payload.len).toBe(bytes.byteLength);
      expect([...fromBase64Bytes(payload)]).toEqual([...bytes]);
    }
  });

  it('往返覆盖全部 256 个字节值', () => {
    const all = new Uint8Array(256);
    for (let index = 0; index < 256; index += 1) all[index] = index;
    expect([...fromBase64Bytes(toBase64Bytes(all))]).toEqual([...all]);
  });

  it('长度与声明不符时拒绝，而不是产出一个看起来完整的短包', () => {
    // 静默接受截断载荷会把失败点推到解包器里，离真正原因很远。
    expect(() => fromBase64Bytes({ b64: 'UEsDBA==', len: 99 })).toThrow(DesktopLocalCardError);
  });

  it('超大载荷不会因一次性展开而炸掉调用栈', () => {
    const large = new Uint8Array(0x20000).fill(7);
    expect([...fromBase64Bytes(toBase64Bytes(large)).subarray(0, 4)]).toEqual([7, 7, 7, 7]);
    expect(fromBase64Bytes(toBase64Bytes(large)).byteLength).toBe(large.byteLength);
  });
});

describe('toWebPackageIndex', () => {
  it('只投影 native 做选择器与外键校验必需的字段', () => {
    const index = toWebPackageIndex(record());
    expect(index).toEqual({
      id: PKG_ID,
      updatedAt: '2026-09-30T12:00:00.000Z',
      contentDigest: DIGEST,
    });
    expect(Object.keys(index).sort()).toEqual(['contentDigest', 'id', 'updatedAt']);
  });

  it('带 tombstone 时才带 deletedAt', () => {
    const index = toWebPackageIndex(record({ deletedAt: '2026-09-30T13:00:00.000Z' }));
    expect(index.deletedAt).toBe('2026-09-30T13:00:00.000Z');
    expect('deletedAt' in toWebPackageIndex(record())).toBe(false);
  });

  it('拒绝不满足契约的记录', () => {
    expect(() => toWebPackageIndex({ ...record(), contentDigest: 'nope' } as never)).toThrow();
  });
});

describe('IpcWebPackageRepository', () => {
  it('put 交出完整 document、索引列与 archive 载荷，且不带 digest 声明', () => {
    const calls: { command: string; args?: Record<string, unknown> }[] = [];
    const repository = new IpcWebPackageRepository(async (command, args) => {
      calls.push({ command, args });
      return DesktopSaveWebPackageResponseSchema.parse({ id: PKG_ID, blobOutcome: 'stored' });
    });

    void repository.putWithOutcome(record(), ARCHIVE);

    const save = calls[0];
    expect(save?.command).toBe(SAVE_WEB_PACKAGE_COMMAND);
    const request = save?.args?.request as { document: string; index: unknown; archive: { b64: string; len: number } };
    expect(request.document).toBe(JSON.stringify(record()));
    expect(request.index).toEqual(toWebPackageIndex(record()));
    expect([...fromBase64Bytes(request.archive)]).toEqual([...ARCHIVE]);
    // archive 的地址由 native 自己算，渲染层无处声明——因此不存在"声明与内容不符"的输入。
    expect(Object.keys(request)).not.toContain('archiveDigest');
  });

  it('putWithOutcome 把 repaired 透传给调用方', () => {
    // 存储损坏被静默吞掉的话，用户永远不会知道自己的库已经不健康。
    const repository = new IpcWebPackageRepository(async () =>
      DesktopSaveWebPackageResponseSchema.parse({ id: PKG_ID, blobOutcome: 'repaired' }),
    );
    return expect(repository.putWithOutcome(record(), ARCHIVE)).resolves.toEqual({
      blobOutcome: 'repaired',
    });
  });

  it('get 区分缺失与解析失败', async () => {
    const missing = new IpcWebPackageRepository(async () => null);
    expect(await missing.get(PKG_ID)).toBeNull();

    const broken = new IpcWebPackageRepository(async () => 'not json at all');
    await expect(broken.get(PKG_ID)).rejects.toMatchObject({ code: 'invalid-card' });
  });

  it('list 在坏行上报错，而不是静默丢掉', async () => {
    // `LocalWebPackagePage` 没有 `unreadable` 字段（卡片那份是端口外的扩展），所以只有
    // 报错与静默丢弃两个选择。静默丢弃会让用户以为自己的包变少了。
    const good = record();
    const repository = new IpcWebPackageRepository(async () => ({
      documents: [JSON.stringify(good), '{"id":"wp_broken"}'],
    }));

    await expect(repository.list({ limit: 10 })).rejects.toMatchObject({ code: 'invalid-card' });
  });

  it('list 原样透传不透明游标', async () => {
    const good = record();
    const cursor = { updatedAtSort: 1788072000000, updatedAt: '2026-09-30T12:00:00.000Z', id: PKG_ID };
    const seen: unknown[] = [];
    const repository = new IpcWebPackageRepository(async (_command, args) => {
      seen.push((args as { request: { cursor?: unknown } }).request.cursor);
      return { documents: [JSON.stringify(good)], nextCursor: cursor };
    });

    const first = await repository.list({ limit: 10 });
    expect(first.nextCursor).toBe(JSON.stringify(cursor));
    await repository.list({ limit: 10, cursor: first.nextCursor });
    expect(seen[1]).toEqual(cursor);
  });

  it('readArchive 交出字节；字节缺失是一个状态而不是抛错', async () => {
    const present = new IpcWebPackageRepository(async () => toBase64Bytes(ARCHIVE));
    expect([...(await present.readArchive(PKG_ID))!]).toEqual([...ARCHIVE]);

    const missing = new IpcWebPackageRepository(async () => {
      throw { code: 'blob-not-found', message: 'blob does not exist' };
    });
    expect(await missing.readArchive(PKG_ID)).toBeNull();
  });

  it('blob 损坏以 blob-corrupt 透出，而不是压成 bridge-failure', async () => {
    // UI 需要据此提示用户做完整性检查（D2.2 的能力），不能当成一次普通失败静默重试。
    const corrupt = new IpcWebPackageRepository(async () => {
      throw { code: 'blob-corrupt', message: 'stored blob does not match its digest' };
    });
    await expect(corrupt.readArchive(PKG_ID)).rejects.toMatchObject({ code: 'blob-corrupt' });
  });

  it('delete 交出带 deletedAt 的完整记录，而不是 (id, deletedAt)', async () => {
    const calls: { command: string; args?: Record<string, unknown> }[] = [];
    let stored: string | null = JSON.stringify(record());
    const repository = new IpcWebPackageRepository(async (command, args) => {
      calls.push({ command, args });
      if (command === GET_WEB_PACKAGE_COMMAND) return stored;
      stored = (args as { request: { document: string } }).request.document;
      return null;
    });

    await repository.delete(PKG_ID);

    expect(calls.map((call) => call.command)).toEqual([GET_WEB_PACKAGE_COMMAND, DELETE_WEB_PACKAGE_COMMAND]);
    const request = calls[1]?.args?.request as { document: string; index: { deletedAt?: string } };
    // document 本身必须带 tombstone：get 返回的正是 document。
    expect(documentField(request.document, 'deletedAt')).toEqual(expect.any(String));
    expect(request.index.deletedAt).toEqual(expect.any(String));
  });

  it('delete 对缺失或已删除的记录是 no-op', async () => {
    const commands: string[] = [];
    const build = (getResult: string | null) => {
      commands.length = 0;
      return new IpcWebPackageRepository(async (command) => {
        commands.push(command);
        return command === GET_WEB_PACKAGE_COMMAND ? getResult : null;
      });
    };

    await build(null).delete(PKG_ID);
    expect(commands).toEqual([GET_WEB_PACKAGE_COMMAND]);

    await build(JSON.stringify(record({ deletedAt: '2026-09-30T13:00:00.000Z' }))).delete(PKG_ID);
    expect(commands).toEqual([GET_WEB_PACKAGE_COMMAND]);
  });

  it('restore 交出移除 deletedAt 的完整记录；purge 走独立命令', async () => {
    const calls: string[] = [];
    const repository = new IpcWebPackageRepository(async (command) => {
      calls.push(command);
      return command === GET_WEB_PACKAGE_COMMAND
        ? JSON.stringify(record({ deletedAt: '2026-09-30T13:00:00.000Z' }))
        : null;
    });

    await repository.restore(PKG_ID);
    await repository.purge(PKG_ID);
    expect(calls).toEqual([GET_WEB_PACKAGE_COMMAND, RESTORE_WEB_PACKAGE_COMMAND, PURGE_WEB_PACKAGE_COMMAND]);
  });

  it('每个能力只用自己那一条命令', async () => {
    const commands: string[] = [];
    const repository = new IpcWebPackageRepository(async (command) => {
      commands.push(command);
      if (command === GET_WEB_PACKAGE_COMMAND) return null;
      if (command === LIST_WEB_PACKAGES_COMMAND) return { documents: [] };
      if (command === READ_WEB_PACKAGE_ARCHIVE_COMMAND) return toBase64Bytes(ARCHIVE);
      if (command === SAVE_WEB_PACKAGE_COMMAND) {
        return DesktopSaveWebPackageResponseSchema.parse({ id: PKG_ID, blobOutcome: 'stored' });
      }
      return null;
    });

    await repository.get(PKG_ID);
    await repository.list({ limit: 10 });
    await repository.readArchive(PKG_ID);
    await repository.put(record(), ARCHIVE);
    await repository.purge(PKG_ID);
    expect(commands).toEqual([
      GET_WEB_PACKAGE_COMMAND,
      LIST_WEB_PACKAGES_COMMAND,
      READ_WEB_PACKAGE_ARCHIVE_COMMAND,
      SAVE_WEB_PACKAGE_COMMAND,
      PURGE_WEB_PACKAGE_COMMAND,
    ]);
  });
});