import { describe, expect, it } from 'vitest';

import { LocalCardRecordV1Schema, type LocalCardRecordV1 } from '@mahoshojo/local-library/record';
import { DesktopListLocalCardsResponseSchema } from '@mahoshojo/contracts/desktop-ipc';

import {
  DesktopLocalCardError,
  IpcLocalCardRepository,
  buildLocalCardListRequest,
  toLocalCardIndex,
  DELETE_LOCAL_CARD_COMMAND,
  GET_LOCAL_CARD_COMMAND,
  LIST_LOCAL_CARDS_COMMAND,
  PURGE_LOCAL_CARD_COMMAND,
  SAVE_LOCAL_CARD_COMMAND,
} from '../src/platform/local-card-bridge';

const DIGEST = `sha256:${'a'.repeat(64)}`;

const record = (overrides: Partial<LocalCardRecordV1> = {}): LocalCardRecordV1 =>
  LocalCardRecordV1Schema.parse({
    id: 'lc_0123456789abcdef0123456789abcdef',
    schemaVersion: 1,
    storageLocation: 'local',
    cardType: 'character',
    title: '焰',
    data: { name: '焰' },
    contentDigest: DIGEST,
    provenance: { kind: 'unsigned', execution: 'imported' },
    createdAt: '2026-09-30T12:00:00.000Z',
    updatedAt: '2026-09-30T12:00:00.000Z',
    ...overrides,
  });

const documentText = (value: LocalCardRecordV1): string => JSON.stringify(value);

/** 读取 document 文本里的顶层字符串字段，用于断言交出的 document 真的带该字段。 */
const documentField = (document: string, field: string): string | undefined => {
  const raw = JSON.parse(document) as Record<string, unknown>;
  const value = raw[field];
  return typeof value === 'string' ? value : undefined;
};

describe('toLocalCardIndex', () => {
  it('只投影 native 做选择器必需的字段，不泄漏业务语义', () => {
    expect(toLocalCardIndex(record())).toEqual({
      id: 'lc_0123456789abcdef0123456789abcdef',
      cardType: 'character',
      updatedAt: '2026-09-30T12:00:00.000Z',
      contentDigest: DIGEST,
    });
    // title / data / provenance 留在 document 里，native 不解释它们。
    expect(Object.keys(toLocalCardIndex(record())).sort()).toEqual(
      ['cardType', 'contentDigest', 'id', 'updatedAt'].sort(),
    );
  });

  it('带 tombstone 时才带 deletedAt，不产出 undefined 字段', () => {
    const index = toLocalCardIndex(record({ deletedAt: '2026-09-30T13:00:00.000Z' }));
    expect(index.deletedAt).toBe('2026-09-30T13:00:00.000Z');
    expect('deletedAt' in toLocalCardIndex(record())).toBe(false);
  });

  it('拒绝不满足契约的记录，而不是把它投影成半合法的选择器', () => {
    expect(() => toLocalCardIndex({ ...record(), contentDigest: 'not-a-digest' } as never)).toThrow();
  });
});

describe('buildLocalCardListRequest', () => {
  it('缺省即"排除 tombstone 且不筛选类型"', () => {
    expect(buildLocalCardListRequest({ limit: 10 })).toEqual({
      includeDeleted: false,
      cardTypes: [],
      limit: 10,
    });
  });

  it('透传卡类型筛选与 includeDeleted', () => {
    expect(
      buildLocalCardListRequest({ limit: 5, includeDeleted: true, cardTypes: ['scenario', 'history'] }),
    ).toEqual({ includeDeleted: true, cardTypes: ['scenario', 'history'], limit: 5 });
  });

  it('对越界页大小 fail closed，而不是静默截断成上限', () => {
    expect(() => buildLocalCardListRequest({ limit: 101 })).toThrow();
    expect(() => buildLocalCardListRequest({ limit: 0 })).toThrow();
  });

  it('无法识别的游标以可诊断错误失败，而不是当作"第一页"', () => {
    // 静默回落成第一页会造成重复读取同一批数据，比报错更难排查。
    expect(() => buildLocalCardListRequest({ limit: 10, cursor: 'not-json' })).toThrow();
    expect(() => buildLocalCardListRequest({ limit: 10, cursor: '{"nope":1}' })).toThrow(
      DesktopLocalCardError,
    );
  });
});

describe('IpcLocalCardRepository', () => {
  it('put 发送已校验的 document 与配套索引列', async () => {
    const calls: { command: string; args?: Record<string, unknown> }[] = [];
    const repository = new IpcLocalCardRepository(async (command, args) => {
      calls.push({ command, args });
      return { id: 'lc_0123456789abcdef0123456789abcdef' };
    });

    const value = record();
    await repository.put(value);

    const save = calls.find((call) => call.command === SAVE_LOCAL_CARD_COMMAND);
    expect(save).toBeDefined();
    const request = save?.args?.request as { document: string; index: unknown };
    expect(request.document).toBe(documentText(value));
    expect(request.index).toEqual(toLocalCardIndex(value));
  });

  it('put 拒绝契约违规的记录，且不会发出任何调用', async () => {
    const calls: string[] = [];
    const repository = new IpcLocalCardRepository(async (command) => {
      calls.push(command);
      return null;
    });

    await expect(repository.put({ ...record(), updatedAt: 'not-a-date' } as never)).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  it('get 区分缺失与解析失败', async () => {
    const missing = new IpcLocalCardRepository(async () => null);
    expect(await missing.get('lc_missing')).toBeNull();

    const broken = new IpcLocalCardRepository(async () => '{"id":"x"}');
    await expect(broken.get('lc_x')).rejects.toThrow(DesktopLocalCardError);
  });

  it('list 逐行解析，坏行进 unreadable 而不是让整页变空', async () => {
    const good = record();
    const repository = new IpcLocalCardRepository(async (command) => {
      expect(command).toBe(LIST_LOCAL_CARDS_COMMAND);
      return DesktopListLocalCardsResponseSchema.parse({
        documents: [documentText(good), '{"id":"lc_broken"}', 'not json at all'],
      });
    });

    const page = await repository.list({ limit: 10 });
    expect(page.items.map((item) => item.id)).toEqual([good.id]);
    expect(page.unreadable).toEqual(['lc_broken', '(未知)']);
  });

  it('list 原样透传 native 的不透明游标，可用于继续翻页', async () => {
    const good = record();
    const cursor = { updatedAtSort: 1788072000000, updatedAt: '2026-09-30T12:00:00.000Z', id: good.id };
    const seen: unknown[] = [];
    const repository = new IpcLocalCardRepository(async (_command, args) => {
      seen.push((args as { request: { cursor?: unknown } }).request.cursor);
      return { documents: [documentText(good)], nextCursor: cursor };
    });

    const first = await repository.list({ limit: 10 });
    expect(first.nextCursor).toBe(JSON.stringify(cursor));

    // 把收到的游标原样回传，第二次调用必须带上它。
    await repository.list({ limit: 10, cursor: first.nextCursor });
    expect(seen[0]).toBeUndefined();
    expect(seen[1]).toEqual(cursor);
  });

  it('delete 交出带 deletedAt 的完整记录，而不是 (id, deletedAt)', async () => {
    const calls: { command: string; args?: Record<string, unknown> }[] = [];
    let stored: string | null = null;
    const repository = new IpcLocalCardRepository(async (command, args) => {
      calls.push({ command, args });
      if (command === GET_LOCAL_CARD_COMMAND) return stored;
      const request = (args as { request: { document: string } }).request;
      stored = request.document;
      return { id: 'lc_0123456789abcdef0123456789abcdef' };
    });

    stored = documentText(record());
    await repository.delete('lc_0123456789abcdef0123456789abcdef');

    expect(calls.map((call) => call.command)).toEqual([GET_LOCAL_CARD_COMMAND, DELETE_LOCAL_CARD_COMMAND]);
    const request = calls[1]?.args?.request as { document: string; index: { deletedAt?: string } };
    // document 本身必须带 tombstone：get 返回的正是 document，只改索引列会让调用方
    // 拿到一条"看起来仍未删除"的记录。
    expect(documentField(request.document, 'deletedAt')).toEqual(expect.any(String));
    expect(request.index.deletedAt).toEqual(expect.any(String));
    // createdAt 不得被软删改写。
    expect(documentField(request.document, 'createdAt')).toBe('2026-09-30T12:00:00.000Z');
  });

  it('delete 对缺失或已删除的记录是 no-op，不发出写调用', async () => {
    const commands: string[] = [];
    const build = (getResult: string | null) => {
      commands.length = 0;
      return new IpcLocalCardRepository(async (command) => {
        commands.push(command);
        return command === GET_LOCAL_CARD_COMMAND ? getResult : null;
      });
    };

    await build(null).delete('lc_missing');
    expect(commands).toEqual([GET_LOCAL_CARD_COMMAND]);

    await build(documentText(record({ deletedAt: '2026-09-30T13:00:00.000Z' }))).delete('lc_deleted');
    expect(commands).toEqual([GET_LOCAL_CARD_COMMAND]);
  });

  it('restore 交出移除 deletedAt 且推进 updatedAt 的完整记录', async () => {
    const calls: { command: string; args?: Record<string, unknown> }[] = [];
    let stored: string | null = documentText(
      record({ updatedAt: '2026-09-30T12:00:00.000Z', deletedAt: '2026-09-30T13:00:00.000Z' }),
    );
    const repository = new IpcLocalCardRepository(async (command, args) => {
      calls.push({ command, args });
      if (command === GET_LOCAL_CARD_COMMAND) return stored;
      stored = (args as { request: { document: string } }).request.document;
      return null;
    });

    await repository.restore('lc_0123456789abcdef0123456789abcdef');

    const request = calls[1]?.args?.request as { document: string; index: { deletedAt?: string } };
    expect(documentField(request.document, 'deletedAt')).toBeUndefined();
    expect('deletedAt' in request.index).toBe(false);
    expect(documentField(request.document, 'updatedAt')).toEqual(expect.any(String));
  });

  it('restore 对缺失或活动记录是 no-op', async () => {
    const commands: string[] = [];
    const build = (getResult: string | null) => {
      commands.length = 0;
      return new IpcLocalCardRepository(async (command) => {
        commands.push(command);
        return command === GET_LOCAL_CARD_COMMAND ? getResult : null;
      });
    };

    await build(null).restore('lc_missing');
    expect(commands).toEqual([GET_LOCAL_CARD_COMMAND]);

    await build(documentText(record())).restore('lc_active');
    expect(commands).toEqual([GET_LOCAL_CARD_COMMAND]);
  });

  it('purge 直接交出 id：native 侧幂等，无需先读', async () => {
    const commands: string[] = [];
    const repository = new IpcLocalCardRepository(async (command) => {
      commands.push(command);
      return null;
    });

    await repository.purge('lc_1');
    expect(commands).toEqual([PURGE_LOCAL_CARD_COMMAND]);
  });

  it('get 与 list 共用同一个解析入口：document 不是 JSON 时都归一为 invalid-card', async () => {
    const broken = new IpcLocalCardRepository(async (command) =>
      command === GET_LOCAL_CARD_COMMAND ? 'not json at all' : { documents: ['not json at all'] },
    );

    // get：抛既定错误类别，而不是原始 SyntaxError
    await expect(broken.get('lc_x')).rejects.toThrow(DesktopLocalCardError);
    await expect(broken.get('lc_x')).rejects.toMatchObject({ code: 'invalid-card' });

    // list：同一条坏行进 unreadable，而不是掀翻整页
    const page = await broken.list({ limit: 10 });
    expect(page.items).toEqual([]);
    expect(page.unreadable).toEqual(['(未知)']);
  });

  it('无法识别的游标以 invalid-card 失败，而不是原始 SyntaxError 或静默回落第一页', () => {
    expect(() => buildLocalCardListRequest({ limit: 10, cursor: 'not-json' })).toThrow(
      DesktopLocalCardError,
    );
    expect(() => buildLocalCardListRequest({ limit: 10, cursor: 'not-json' })).toThrow(
      /本地库返回了无法解析的数据/,
    );
    expect(() => buildLocalCardListRequest({ limit: 10, cursor: '{"nope":1}' })).toThrow(
      DesktopLocalCardError,
    );
  });

  it('cursor 的排序键被透传，不被渲染层重算', async () => {
    const good = record();
    const cursor = { updatedAtSort: 1788072000000, updatedAt: '2026-09-30T12:00:00.000Z', id: good.id };
    const seen: unknown[] = [];
    const repository = new IpcLocalCardRepository(async (_command, args) => {
      seen.push((args as { request: { cursor?: unknown } }).request.cursor);
      return { documents: [documentText(good)], nextCursor: cursor };
    });

    const first = await repository.list({ limit: 10 });
    await repository.list({ limit: 10, cursor: first.nextCursor });
    expect(seen[1]).toEqual(cursor);
  });

  it('native 报出的已知 code 被保留，未知 code 归一为 bridge-failure', async () => {
    const known = new IpcLocalCardRepository(async () => {
      throw { code: 'index-mismatch', message: 'local store index columns disagree with the document' };
    });
    await expect(known.get('lc_1')).rejects.toMatchObject({ code: 'index-mismatch' });

    const unknown = new IpcLocalCardRepository(async () => {
      throw { code: 'sqlite-internal-whatever', message: 'near "SELCT": syntax error' };
    });
    // 未知形状不采信：既不透传可能含 SQL 片段的 message，也不新增一个错误类别。
    await expect(unknown.get('lc_1')).rejects.toMatchObject({
      code: 'bridge-failure',
      message: '本地库调用失败',
    });
  });

  it('get 与 list 都只使用自己那一条命令', async () => {
    const commands: string[] = [];
    const repository = new IpcLocalCardRepository(async (command) => {
      commands.push(command);
      return command === GET_LOCAL_CARD_COMMAND ? null : { documents: [] };
    });

    await repository.get('lc_1');
    await repository.list({ limit: 10 });
    expect(commands).toEqual([GET_LOCAL_CARD_COMMAND, LIST_LOCAL_CARDS_COMMAND]);
  });
});
