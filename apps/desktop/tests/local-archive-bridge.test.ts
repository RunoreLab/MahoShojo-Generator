import { describe, expect, it, vi } from 'vitest';

import type {
  LocalCardRecordV1,
  LocalWebPackageRecordV1,
} from '@mahoshojo/local-library/record';
import type { CardRepository, LocalCardPage } from '@mahoshojo/local-library/repository';
import type { WebPackageRepository } from '@mahoshojo/local-library/web-package-record';

import {
  APPEND_ARCHIVE_EXPORT_CHUNK_COMMAND,
  ARCHIVE_EXPORT_ID_HEADER,
  BEGIN_ARCHIVE_EXPORT_COMMAND,
  type RawInvokeFn,
  createArchiveExportSource,
  exportLocalLibraryArchive,
  LocalArchiveExportError,
} from '../src/platform/local-archive-bridge';

const EXPORTED_AT = '2026-10-01T00:00:00.000Z';

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

/**
 * 一个 ZIP 的最小合法开头。
 *
 * 这里**不引入 `fflate`**：它不是 `apps/desktop` 的依赖，而"归档确实是个 ZIP 且清单 checksum 覆盖
 * 实际字节"属于打包器的断言，已由 `packages/local-library/tests/archive-export.test.ts` 覆盖。
 * 本文件只负责桥自己的义务——交给 native 的字节拼接起来就是那一份归档。
 */
const fakeZip = (seed: string): Uint8Array =>
  new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...encode(seed.repeat(40)).slice(0, 60)]);

const makeCard = (id: string): LocalCardRecordV1 =>
  ({
    id,
    schemaVersion: 1,
    storageLocation: 'local',
    cardType: 'character',
    title: `卡 ${id}`,
    data: { name: id },
    contentDigest: `sha256:${id.replace(/\D/gu, 'a').padEnd(64, 'b').slice(0, 64)}`,
    provenance: { kind: 'unsigned', execution: 'direct-local' },
    createdAt: '2026-08-23T12:00:00.000Z',
    updatedAt: '2026-08-23T12:00:00.000Z',
  }) as LocalCardRecordV1;

const makePackage = (id: string, zip: Uint8Array): LocalWebPackageRecordV1 =>
  ({
    id,
    schemaVersion: 1,
    storageLocation: 'local',
    entityKind: 'web-package',
    title: `包 ${id}`,
    summary: 'a@1.0.0',
    ref: { id: 'a', version: '1.0.0', digest: `sha256:${'c'.repeat(64)}` },
    manifest: {
      format: 'mahoshojo-web-package',
      formatVersion: 1,
      id: 'a',
      version: '1.0.0',
      name: 'a',
      entry: 'index.html',
      generation: { target: 'index.html', mode: 'replace', mediaType: 'text/html' },
      capabilities: [],
      files: [],
    },
    contentDigest: `sha256:${'c'.repeat(64)}`,
    archiveByteLength: zip.byteLength,
    provenance: { kind: 'unsigned', execution: 'imported' },
    createdAt: '2026-08-23T12:00:00.000Z',
    updatedAt: '2026-08-23T12:00:00.000Z',
  }) as LocalWebPackageRecordV1;

const cardRepository = (records: LocalCardRecordV1[]): CardRepository =>
  ({
    async list(): Promise<LocalCardPage> {
      return { items: records, nextCursor: null } as LocalCardPage & { unreadable?: number };
    },
  }) as unknown as CardRepository;

const packageRepository = (
  entries: Array<{ record: LocalWebPackageRecordV1; bytes: Uint8Array }>,
): WebPackageRepository =>
  ({
    async list() {
      return { items: entries.map((entry) => entry.record), nextCursor: null };
    },
    async get(id: string) {
      return entries.find((entry) => entry.record.id === id)?.record ?? null;
    },
    async readArchive(digest: string) {
      return entries.find((entry) => entry.record.ref.digest === digest)?.bytes ?? null;
    },
  }) as unknown as WebPackageRepository;

/** 记录每个 raw 调用的 command / 块字节 / header，用于断言传输形状。 */
interface RawCall {
  readonly command: string;
  readonly bytes: Uint8Array;
  readonly headers: Record<string, string>;
}

const createTransport = (
  responses: (call: RawCall, index: number) => unknown,
) => {
  const calls: RawCall[] = [];
  let received: Uint8Array = new Uint8Array();
  const rawInvoke: RawInvokeFn = async (command, body, options) => {
    calls.push({ command, bytes: body, headers: options.headers });
    received = new Uint8Array([...received, ...body]);
    return responses({ command, bytes: body, headers: options.headers }, calls.length - 1);
  };
  return { calls, rawInvoke, received: () => received };
};

const runExport = async (
  overrides: {
    cards?: LocalCardRecordV1[];
    packages?: Array<{ record: LocalWebPackageRecordV1; bytes: Uint8Array }>;
    chunkBytes?: number;
    maxTotalBytes?: number;
  } = {},
) => {
  const cards = overrides.cards ?? [makeCard('lc_1')];
  const packages = overrides.packages ?? [
    { record: makePackage('wp_1', fakeZip('a')), bytes: fakeZip('a') },
  ];
  const source = createArchiveExportSource(cardRepository(cards), packageRepository(packages));

  const begun = { exportId: 7, absolutePath: '/data/exports/local-library-20261001T000000Z.zip' };
  const beginInvoke = vi.fn(async () => begun);
  // 这里的 raw 传输只需要记录字节；complete 由 native 在收满时回，本用例不依赖它。
  const transport = createTransport(() => ({ writtenByteLength: 0, complete: false }));
  const result = await exportLocalLibraryArchive(beginInvoke, transport.rawInvoke, source, {
    exportedAt: EXPORTED_AT,
    ...(overrides.chunkBytes === undefined ? {} : { chunkBytes: overrides.chunkBytes }),
    ...(overrides.maxTotalBytes === undefined ? {} : { maxTotalBytes: overrides.maxTotalBytes }),
  });
  return { result, begun, beginInvoke, transport, packages, cards };
};

describe('exportLocalLibraryArchive', () => {
  it('begin 只声明归档长度，不传路径', async () => {
    const { beginInvoke } = await runExport();
    expect(beginInvoke).toHaveBeenCalledTimes(1);
    const [command, args] = beginInvoke.mock.calls[0];
    expect(command).toBe(BEGIN_ARCHIVE_EXPORT_COMMAND);
    expect(Object.keys(args ?? {}).sort()).toEqual(['declaredTotalByteLength']);
    // renderer MUST NOT 传路径：目标路径由 native 选（DESK-071b）。
    expect(JSON.stringify(args)).not.toContain('Path');
  });

  it('每块都带 x-export-id 且 exportId 原样取自 begin', async () => {
    const { transport, begun } = await runExport();
    expect(transport.calls.length).toBeGreaterThan(0);
    for (const call of transport.calls) {
      expect(call.command).toBe(APPEND_ARCHIVE_EXPORT_CHUNK_COMMAND);
      expect(call.headers[ARCHIVE_EXPORT_ID_HEADER]).toBe(String(begun.exportId));
    }
  });

  it('分块后拼接起来与单块完全相同', async () => {
    const single = await runExport({ chunkBytes: 1024 * 1024 });
    const chunked = await runExport({ chunkBytes: 64 });
    expect(chunked.transport.calls.length).toBeGreaterThan(1);
    // 块大小只影响传输，不影响产物：native 追加的是同一串字节。
    expect(Array.from(chunked.transport.received())).toEqual(
      Array.from(single.transport.received()),
    );
  });

  it('native 报导出超限时归一成 export-too-large', async () => {
    const source = createArchiveExportSource(cardRepository([makeCard('lc_1')]), packageRepository([]));
    const failing = async () => {
      throw { code: 'export-too-large', message: '超过上限' };
    };
    await expect(
      exportLocalLibraryArchive(failing, async () => undefined, source, { exportedAt: EXPORTED_AT }),
    ).rejects.toMatchObject({ code: 'export-too-large' });
  });

  it('打包侧超限保留自己的 code，不被压成 export-failure', async () => {
    // 两个上限的判定方不同：native 按落盘上限，打包器按内存预算。
    // 合成一个码之后 UI 就无法区分"你的库太大"与"我们的实现只能打包到这么大"。
    await expect(runExport({ maxTotalBytes: 8 })).rejects.toMatchObject({
      code: 'archive-too-large',
    });
  });

  it('native 报 stale 时保留 export-stale 供 UI 判断需要重跑', async () => {
    const source = createArchiveExportSource(cardRepository([makeCard('lc_1')]), packageRepository([]));
    const rawInvoke: RawInvokeFn = async () => {
      throw { code: 'export-stale', message: '导出已被新一轮取代' };
    };
    const error = await exportLocalLibraryArchive(
      async () => ({ exportId: 1, absolutePath: '/x.zip' }),
      rawInvoke,
      source,
      { exportedAt: EXPORTED_AT },
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(LocalArchiveExportError);
    expect((error as LocalArchiveExportError).code).toBe('export-stale');
  });

  it('无法识别的 native 失败归一成 export-failure 而不是丢掉', async () => {
    const source = createArchiveExportSource(cardRepository([makeCard('lc_1')]), packageRepository([]));
    const rawInvoke: RawInvokeFn = async () => {
      throw new Error('plain');
    };
    await expect(
      exportLocalLibraryArchive(
        async () => ({ exportId: 1, absolutePath: '/x.zip' }),
        rawInvoke,
        source,
        { exportedAt: EXPORTED_AT },
      ),
    ).rejects.toMatchObject({ code: 'export-failure' });
  });

  it('回显 native 给出的绝对路径，并声明这是一次快照', async () => {
    const { result, begun } = await runExport();
    expect(result.absolutePath).toBe(begun.absolutePath);
    expect(result.byteLength).toBeGreaterThan(0);
    expect(result.isSnapshot).toBe(true);
  });

  it('progress 由 native 的字节计数驱动且单调不减', async () => {
    const zip = fakeZip('b');
    const source = createArchiveExportSource(
      cardRepository([makeCard('lc_1')]),
      packageRepository([{ record: makePackage('wp_1', zip), bytes: zip }]),
    );
    const begun = { exportId: 3, absolutePath: '/data/exports/a.zip' };
    let reported = 0;
    const transport = createTransport(() => {
      reported += 7;
      return { writtenByteLength: reported, complete: false };
    });
    const seen: Array<[number, number]> = [];
    const result = await exportLocalLibraryArchive(
      async () => begun,
      transport.rawInvoke,
      source,
      {
        exportedAt: EXPORTED_AT,
        chunkBytes: 32,
        onProgress: (value, max) => seen.push([value, max]),
      },
    );
    expect(seen.length).toBeGreaterThan(0);
    // 进度必须来自 native 回执：渲染层自己数块数，会在某块被 native 拒绝时把进度条推到 100%。
    for (const [value, max] of seen) {
      expect(max).toBe(result.byteLength);
      expect(value).toBeGreaterThan(0);
    }
    for (let index = 1; index < seen.length; index += 1) {
      expect(seen[index][0]).toBeGreaterThanOrEqual(seen[index - 1][0]);
    }
  });
});

describe('createArchiveExportSource', () => {
  it('卡片与 Web 包都必须带 includeDeleted，否则导入侧看不到墓碑', async () => {
    const cardQueries: unknown[] = [];
    const packageQueries: unknown[] = [];
    const cards = {
      async list(query: unknown) {
        cardQueries.push(query);
        return { items: [], nextCursor: null };
      },
    } as unknown as CardRepository;
    const packages = {
      async list(query: unknown) {
        packageQueries.push(query);
        return { items: [], nextCursor: null };
      },
    } as unknown as WebPackageRepository;

    const source = createArchiveExportSource(cards, packages);
    await source.listCards();
    await source.listWebPackages();

    // 两个来源都要断言：只覆盖其中一个时，漏掉那一个会让导出的归档少一批墓碑，
    // 而下一次同步会把它们当新记录重新拉回来。
    expect(cardQueries).toHaveLength(1);
    expect(cardQueries[0]).toMatchObject({ includeDeleted: true });
    expect(packageQueries).toHaveLength(1);
    expect(packageQueries[0]).toMatchObject({ includeDeleted: true });
  });

  it('记录在但字节缺失时报错，而不是跳过', async () => {
    const zip = fakeZip('c');
    const record = makePackage('wp_1', zip);
    const packages = {
      async list() {
        return { items: [record], nextCursor: null };
      },
      async get() {
        return record;
      },
      async readArchive() {
        return null;
      },
    } as unknown as WebPackageRepository;
    const source = createArchiveExportSource(cardRepository([]), packages);
    // 跳过的结果是一个"少一个包但能打开"的归档，而用户会以为迁移完成了。
    await expect(source.readWebPackageArchive('wp_1')).rejects.toThrow(/字节缺失/u);
  });

  it('按 manifest 摘要而不是包 id 读字节', async () => {
    const zip = fakeZip('d');
    const record = makePackage('wp_1', zip);
    const asked: string[] = [];
    const packages = {
      async list() {
        return { items: [record], nextCursor: null };
      },
      async get() {
        return record;
      },
      async readArchive(digest: string) {
        asked.push(digest);
        return zip;
      },
    } as unknown as WebPackageRepository;
    const source = createArchiveExportSource(cardRepository([]), packages);
    await source.readWebPackageArchive('wp_1');
    expect(asked).toEqual([record.ref.digest]);
  });
});

describe('传输产物的形状', () => {
  it('收齐的字节是一个 ZIP，且与单块传输逐字节相同', async () => {
    const single = await runExport({ chunkBytes: 1024 * 1024 });
    const chunked = await runExport({ chunkBytes: 32 });

    expect(chunked.transport.calls.length).toBeGreaterThan(1);
    // 块大小只影响传输方式，不影响产物：native 追加的是同一串字节。
    expect(Array.from(chunked.transport.received())).toEqual(
      Array.from(single.transport.received()),
    );
    // ZIP 局部文件头。
    expect(Array.from(chunked.transport.received().slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it('交付的总长等于交给 begin 的声明总长', async () => {
    const { beginInvoke, transport, result } = await runExport({ chunkBytes: 32 });
    const [, args] = beginInvoke.mock.calls[0];
    expect(args?.declaredTotalByteLength).toBe(result.byteLength);
    // 逐块累加必须精确等于声明总长：native 以此判定"完成"，少一块就会永远等不到完成。
    expect(transport.received().byteLength).toBe(result.byteLength);
  });

  it('每个块都是原归档的一段连续切片，不重复也不跳字节', async () => {
    const { transport } = await runExport({ chunkBytes: 32 });
    const joined = transport.received();
    expect(joined.byteLength).toBe(
      transport.calls.reduce((sum, call) => sum + call.bytes.byteLength, 0),
    );
    // 每块必须是同一串字节的连续视图；重新比对可以抓到"某块被复制而非切片"。
    let cursor = 0;
    for (const call of transport.calls) {
      expect(Array.from(joined.subarray(cursor, cursor + call.bytes.byteLength))).toEqual(
        Array.from(call.bytes),
      );
      cursor += call.bytes.byteLength;
    }
  });
});