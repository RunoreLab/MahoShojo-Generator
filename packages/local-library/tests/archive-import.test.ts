import { unzipSync, zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  LOCAL_LIBRARY_ARCHIVE_MANIFEST_PATH,
  type LocalLibraryArchiveManifestV2,
} from '@mahoshojo/local-library/archive';
import {
  applyLocalLibraryArchiveImport,
  inspectLocalLibraryArchive,
  LocalLibraryArchiveImportError,
  MAX_LOCAL_LIBRARY_ARCHIVE_MANIFEST_BYTES,
  type LocalLibraryArchiveImportTarget,
} from '@mahoshojo/local-library/archive-import';
import {
  collectLocalLibraryArchive,
  type LocalLibraryArchiveSource,
} from '@mahoshojo/local-library/archive-export';
import {
  MAX_LOCAL_LIBRARY_ARCHIVE_INPUT_BYTES,
  packLocalLibraryArchive,
} from '@mahoshojo/local-library/archive-pack';
import { sha256DigestOfBytes } from '@mahoshojo/local-library/digest';
import type { CardRepository, LocalCardQuery } from '@mahoshojo/local-library/repository';
import type { LocalCardRecordV1 } from '@mahoshojo/local-library/record';
import type {
  LocalWebPackageRecordV1,
  WebPackageRepository,
} from '@mahoshojo/local-library/web-package-record';
import { deriveLocalWebPackageId } from '@mahoshojo/local-library/web-package-record';

import { createLocalCardRecord } from './fixtures';
import { createLocalWebPackageRecord } from './web-package-fixtures';

const encoder = new TextEncoder();
const EXPORTED_AT = '2026-10-02T00:00:00.000Z';

/** 序号必须在摘要**前 32 位**里出现：卡片 id 与 Web 包 id 都由它派生。 */
const distinctHex = (index: number): string => {
  const high = index.toString(16).padStart(32, '0');
  return `${high}${high}`.slice(0, 64);
};

const makeCard = (index: number) =>
  createLocalCardRecord({
    id: `lc_${distinctHex(index).slice(0, 32)}`,
    title: `card ${index}`,
    contentDigest: `sha256:${distinctHex(index)}`,
  });

const makePackage = (index: number, archive: Uint8Array) =>
  createLocalWebPackageRecord({
    id: deriveLocalWebPackageId(`sha256:${distinctHex(index)}`),
    title: `package ${index}`,
    contentDigest: `sha256:${distinctHex(index)}`,
    archiveByteLength: archive.byteLength,
    ref: {
      id: 'local.library-test',
      version: `1.0.${index}`,
      digest: `sha256:${distinctHex(index)}`,
    },
  });

const fakeZip = (seed: string): Uint8Array =>
  new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...encoder.encode(seed.repeat(64)).slice(0, 256)]);

interface Fixture {
  readonly source: LocalLibraryArchiveSource;
  readonly cards: ReturnType<typeof makeCard>[];
  readonly packages: Array<{ record: LocalWebPackageRecordV1; bytes: Uint8Array }>;
}

/**
 * 走**真实导出路径**造归档，而不是手写 manifest。
 *
 * 手写的清单必须自己填 `checksum`，而一个填错的夹具会让"导入正确地拒绝了它"看起来像"导入坏了"。
 * 走 `collectLocalLibraryArchive` + `packLocalLibraryArchive` 之后，归档与它自己的清单**必然自洽**，
 * 于是每一条负向断言失败时都能确定问题在被篡改的那一处，而不是在夹具本身。
 */
const buildFixture = (options: { cardCount?: number; packageCount?: number } = {}): Fixture => {
  const cards = Array.from({ length: options.cardCount ?? 2 }, (_, index) => makeCard(index + 1));
  const packages = Array.from({ length: options.packageCount ?? 2 }, (_, index) => {
    const bytes = fakeZip(String.fromCharCode(97 + index));
    return { record: makePackage(index + 1, bytes), bytes };
  });
  const byId = new Map(packages.map((entry) => [entry.record.id, entry.bytes]));
  return {
    cards,
    packages,
    source: {
      listCards: async () => ({ items: cards, nextCursor: null }),
      listWebPackages: async () => ({ items: packages.map((entry) => entry.record), nextCursor: null }),
      readWebPackageArchive: async (id) => {
        const bytes = byId.get(id);
        if (bytes === undefined) throw new Error(`no fixture package ${id}`);
        return bytes;
      },
    },
  };
};

const packFixture = async (
  options: { cardCount?: number; packageCount?: number } = {},
): Promise<Uint8Array> => {
  const fixture = buildFixture(options);
  const collected = await collectLocalLibraryArchive(fixture.source, { exportedAt: EXPORTED_AT });
  const packed = await packLocalLibraryArchive(collected.manifest, collected.read);
  return packed.bytes;
};

/** 目标端口的内存实现，记录每一次写。 */
interface Recorder {
  readonly target: LocalLibraryArchiveImportTarget;
  readonly cardPuts: string[];
  readonly packagePuts: string[];
  readonly packageArchiveBytes: Map<string, Uint8Array>;
}

const createTarget = (existing: {
  cards?: readonly string[];
  packages?: readonly string[];
} = {}): Recorder => {
  type CardRecord = NonNullable<Awaited<ReturnType<CardRepository['get']>>>;
  type PackageRecord = NonNullable<Awaited<ReturnType<WebPackageRepository['get']>>>;
  const cardPuts: string[] = [];
  const packagePuts: string[] = [];
  const packageArchiveBytes = new Map<string, Uint8Array>();
  const existingCards = new Set(existing.cards ?? []);
  const existingPackages = new Set(existing.packages ?? []);
  const cardRecords = new Map<string, CardRecord>();
  const packageRecords = new Map<string, PackageRecord>();

  const cards = {
    async get(id: string) {
      return cardRecords.get(id) ?? null;
    },
    // existing-wins 的探测走一次分页列举而不是逐条 get，因此 `list` 必须像真实 adapter 那样
    // 返回库里已有的记录——否则"本地已存在"永远是空的，那条断言就成了摆设。
    async list() {
      return { items: [...cardRecords.values()] };
    },
    async put(record: CardRecord) {
      cardPuts.push(record.id);
      cardRecords.set(record.id, record);
    },
    async delete() {},
    async restore() {},
  } as unknown as CardRepository;

  const packages = {
    async get(id: string) {
      return packageRecords.get(id) ?? null;
    },
    async list() {
      return { items: [...packageRecords.values()] };
    },
    async put(record: PackageRecord, archive: Uint8Array) {
      packagePuts.push(record.id);
      packageArchiveBytes.set(record.id, archive);
      packageRecords.set(record.id, record);
    },
    async delete() {},
    async restore() {},
    async purge() {},
    async readArchive() {
      return null;
    },
  } as unknown as WebPackageRepository;

  // existing-wins 的前提是"本地已经有一条同 id 的记录"。用一份**完整合法**的记录而不是
  // `{ id }` 占位：apply 之所以跳过它，靠的是 `get` 返回非 null，与记录内容无关。
  for (const id of existingCards) {
    cardRecords.set(id, createLocalCardRecord({ id }) as CardRecord);
  }
  for (const id of existingPackages) {
    packageRecords.set(id, createLocalWebPackageRecord({ id }) as PackageRecord);
  }

  return {
    target: { cards, packages },
    cardPuts,
    packagePuts,
    packageArchiveBytes,
  };
};

/** 解开一段归档的全部条目，供断言与"重建一份坏归档"使用。 */
const unzipAll = (archive: Uint8Array): Map<string, Uint8Array> =>
  new Map(Object.entries(unzipSync(archive)));

/**
 * 逐条重打一个归档，并允许替换 / 增删 / 重排条目。
 *
 * 重打是必须的：改条目内容就必然改 `zipSync` 的输出，因此"手工改字节"那条路会同时动到 CRC、
 * local header 与 central directory——那是与本文件要测的东西无关的一大块。
 */
const repack = (
  entries: Map<string, Uint8Array>,
  order?: readonly string[],
): Uint8Array => {
  const zippable: Record<string, Uint8Array> = {};
  const paths = order ?? [...entries.keys()];
  for (const path of paths) {
    const bytes = entries.get(path);
    if (bytes === undefined) throw new Error(`missing entry ${path}`);
    zippable[path] = bytes;
  }
  return zipSync(zippable, { level: 6, mtime: new Date(1980, 0, 1) });
};

/**
 * 在字节层面把一个条目改名，使同一路径在归档里出现两次。
 *
 * `zipSync` 以路径为键，重复项会被折叠成一份；而手写一份含重复路径的 ZIP 意味着自己实现
 * local header 与 central directory。改**等长**名字的两处出现（local header + central
 * directory）既短又安全：文件名不进 CRC，因此不需要重算校验和。
 */
const renameEntryInPlace = (
  archive: Uint8Array,
  from: string,
  to: string,
): Uint8Array => {
  if (from.length !== to.length) {
    throw new Error('改名必须等长，否则偏移量全部失效');
  }
  const fromBytes = encoder.encode(from);
  const toBytes = encoder.encode(to);
  let renamed = 0;
  for (let index = 0; index + fromBytes.byteLength <= archive.byteLength; index += 1) {
    let matches = true;
    for (let offset = 0; offset < fromBytes.byteLength; offset += 1) {
      if (archive[index + offset] !== fromBytes[offset]) {
        matches = false;
        break;
      }
    }
    if (!matches) continue;
    archive.set(toBytes, index);
    renamed += 1;
  }
  // 一份归档里文件名至少出现两次（local header 与 central directory）；少于两次说明没找到。
  if (renamed < 2) throw new Error(`没有找到足够的条目名出现：${from}`);
  return archive;
};

/** 一份走真实导出路径、再按 `mutate` 改坏的归档。 */
interface Mutation {
  readonly entries: Map<string, Uint8Array>;
  readonly order?: readonly string[];
}

const packMutated = async (
  mutate: (_entries: Map<string, Uint8Array>) => Mutation | Promise<Mutation>,
): Promise<Uint8Array> => {
  const original = await packFixture();
  const result = await mutate(unzipAll(original));
  return repack(result.entries, result.order);
};

/** 读出归档里的清单对象（就地修改它，随后由 `packMutated` 重新序列化）。 */
const readManifest = (entries: Map<string, Uint8Array>): LocalLibraryArchiveManifestV2 => {
  const bytes = entries.get(LOCAL_LIBRARY_ARCHIVE_MANIFEST_PATH);
  if (bytes === undefined) throw new Error('fixture archive has no manifest');
  return JSON.parse(new TextDecoder().decode(bytes)) as LocalLibraryArchiveManifestV2;
};

const writeManifest = (
  entries: Map<string, Uint8Array>,
  manifest: LocalLibraryArchiveManifestV2,
): void => {
  entries.set(LOCAL_LIBRARY_ARCHIVE_MANIFEST_PATH, encoder.encode(JSON.stringify(manifest)));
};

/** 清单声明的解压总字节——导出侧打包预算度量的就是它。 */
const manifestBytesOf = (manifest: LocalLibraryArchiveManifestV2): number =>
  manifest.cards.reduce((sum, entry) => sum + entry.byteLength, 0)
  + manifest.webPackages.reduce(
    (sum, entry) => sum + entry.byteLength + entry.archiveByteLength,
    0,
  );

describe('inspectLocalLibraryArchive', () => {
  it('接受一份自洽归档并给出摘要，且一次本地库写入都没有', async () => {
    const recorder = createTarget();
    const plan = await inspectLocalLibraryArchive(recorder.target, await packFixture());

    expect(plan.summary).toMatchObject({
      format: 'mahoshojo-local-library',
      formatVersion: 2,
      cardCount: 2,
      webPackageCount: 2,
      exportedAt: EXPORTED_AT,
    });
    expect(plan.existingCardIds).toEqual([]);
    expect(plan.existingWebPackageIds).toEqual([]);
    // 预检阶段绝不写：任何一次写都会让"先展示摘要、再由用户确认"这个顺序失效。
    expect(recorder.cardPuts).toEqual([]);
    expect(recorder.packagePuts).toEqual([]);
  });

  it('报告本地已存在的条目，供 UI 在写入前展示冲突策略', async () => {
    const fixture = buildFixture();
    const recorder = createTarget({
      cards: [fixture.cards[0]!.id],
      packages: [fixture.packages[0]!.record.id],
    });
    const plan = await inspectLocalLibraryArchive(recorder.target, await packFixture());

    expect(plan.existingCardIds).toEqual([fixture.cards[0]!.id]);
    expect(plan.existingWebPackageIds).toEqual([fixture.packages[0]!.record.id]);
  });

  it('全程零网络请求', async () => {
    // `DESK-052` / `DESK-074`：导入 MUST 零网络，且 MUST 由可执行断言证明。只靠"代码里没看到
    // fetch"是不成立的——间接依赖、未来的重构、polyfill 都会让它失效。
    const originalFetch = globalThis.fetch;
    const originalXhr = typeof globalThis.XMLHttpRequest;
    const network = vi.fn(() => Promise.reject(new Error('导入路径发起了网络请求')));
    Object.assign(globalThis, { fetch: network });

    try {
      const recorder = createTarget();
      const archive = await packFixture();
      const plan = await inspectLocalLibraryArchive(recorder.target, archive);
      await applyLocalLibraryArchiveImport(recorder.target, archive, plan);
      expect(network).not.toHaveBeenCalled();
      expect(recorder.cardPuts).toHaveLength(2);
    } finally {
      Object.assign(globalThis, { fetch: originalFetch });
      if (originalXhr === undefined) delete (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest;
      else Object.assign(globalThis, { XMLHttpRequest: originalXhr });
    }
  });
});

describe('applyLocalLibraryArchiveImport', () => {
  it('写入清单里的每一条并给出精确报告', async () => {
    const fixture = buildFixture();
    const recorder = createTarget();
    const archive = await packFixture();
    const plan = await inspectLocalLibraryArchive(recorder.target, archive);
    const report = await applyLocalLibraryArchiveImport(recorder.target, archive, plan);

    expect(report.succeededCardIds).toEqual(fixture.cards.map((card) => card.id).sort());
    expect(report.succeededWebPackageIds).toEqual(
      fixture.packages.map((entry) => entry.record.id).sort(),
    );
    expect(report.skipped).toEqual([]);
    expect(report.failed).toEqual([]);
  });

  it('写入的 ZIP 字节与归档里那一份逐字节相同', async () => {
    const fixture = buildFixture();
    const recorder = createTarget();
    const archive = await packFixture();
    const plan = await inspectLocalLibraryArchive(recorder.target, archive);
    await applyLocalLibraryArchiveImport(recorder.target, archive, plan);

    for (const entry of fixture.packages) {
      expect(Array.from(recorder.packageArchiveBytes.get(entry.record.id)!)).toEqual(
        Array.from(entry.bytes),
      );
    }
  });

  it('existing wins：本地已有的记录被跳过且一个字节都不覆盖', async () => {
    const fixture = buildFixture();
    const recorder = createTarget({
      cards: [fixture.cards[0]!.id],
      packages: [fixture.packages[0]!.record.id],
    });
    const archive = await packFixture();
    const plan = await inspectLocalLibraryArchive(recorder.target, archive);
    const report = await applyLocalLibraryArchiveImport(recorder.target, archive, plan);

    expect(report.skipped).toEqual([
      { kind: 'card', id: fixture.cards[0]!.id, reason: 'already-present' },
      { kind: 'web-package', id: fixture.packages[0]!.record.id, reason: 'already-present' },
    ]);
    expect(report.succeededCardIds).toEqual([fixture.cards[1]!.id]);
    expect(report.succeededWebPackageIds).toEqual([fixture.packages[1]!.record.id]);
    // 覆盖的后果是静默丢失用户刚做的删除，而"强制覆盖"在 tombstone 语义下没有唯一定义。
    expect(recorder.cardPuts).not.toContain(fixture.cards[0]!.id);
    expect(recorder.packagePuts).not.toContain(fixture.packages[0]!.record.id);
  });

  it('两次导入同一份归档得到逐条相同的报告', async () => {
    const archive = await packFixture();
    const run = async (): Promise<unknown> => {
      const recorder = createTarget();
      const plan = await inspectLocalLibraryArchive(recorder.target, archive);
      return applyLocalLibraryArchiveImport(recorder.target, archive, plan);
    };
    // 确定的顺序是这条断言的前提；按到达顺序排列的报告无法逐条比对。
    // 两次必须落在两个**空库**上：落到同一个库时第二次全被 existing-wins 跳过，报告当然不同。
    expect(await run()).toEqual(await run());
  });

  it('单条写入失败只记进报告，其余条目照常写入', async () => {
    const fixture = buildFixture({ cardCount: 2 });
    const recorder = createTarget();
    const archive = await packFixture({ cardCount: 2 });
    const plan = await inspectLocalLibraryArchive(recorder.target, archive);
    const doomed = fixture.cards[0]!.id;
    const originalPut = recorder.target.cards.put.bind(recorder.target.cards);
    recorder.target.cards.put = (async (record) => {
      if (record.id === doomed) throw new Error('磁盘满了');
      return originalPut(record);
    }) as typeof recorder.target.cards.put;

    const report = await applyLocalLibraryArchiveImport(recorder.target, archive, plan);

    expect(report.failed).toEqual([{ kind: 'card', id: doomed, reason: '磁盘满了' }]);
    expect(report.succeededCardIds).toEqual([fixture.cards[1]!.id]);
  });

  it('existing-wins 保护墓碑，而不只是"存在的记录"', async () => {
    // 墓碑也是"本地已存在"。若探测漏掉 `deletedAt` 的行，导入就会**复活**一条用户删掉的记录，
    // 而症状是"我明明删过它，怎么又出现了"。
    const fixture = buildFixture();
    const tombstone = { ...fixture.cards[0]!, deletedAt: '2026-10-01T00:00:00.000Z' };
    const recorder = createTarget();
    await recorder.target.cards.put(tombstone as LocalCardRecordV1);
    recorder.cardPuts.length = 0;

    const archive = await packFixture();
    const plan = await inspectLocalLibraryArchive(recorder.target, archive);
    expect(plan.existingCardIds).toContain(tombstone.id);
    const report = await applyLocalLibraryArchiveImport(recorder.target, archive, plan);
    expect(report.skipped.map((item) => item.id)).toContain(tombstone.id);
    expect(recorder.cardPuts).not.toContain(tombstone.id);
  });

  it('写入前按存储的当前状态复核，而不是只信任 inspect 给出的 plan', async () => {
    // `plan` 是一个普通导出接口，因此"用 A 库的 plan 去写 B 库"在类型层面完全合法。若 apply
    // 只看 plan，它会**静默覆盖** B 库里的同名记录——正是 DESK-074 禁止的强制覆盖。
    // 这里模拟"inspect 之后、apply 之前本地多了一条记录"。
    const fixture = buildFixture();
    const recorder = createTarget();
    const archive = await packFixture();
    const plan = await inspectLocalLibraryArchive(recorder.target, archive);
    expect(plan.existingCardIds).toEqual([]);

    await recorder.target.cards.put(createLocalCardRecord({ id: fixture.cards[0]!.id }));
    recorder.cardPuts.length = 0;

    const report = await applyLocalLibraryArchiveImport(recorder.target, archive, plan);
    expect(report.skipped).toEqual([
      { kind: 'card', id: fixture.cards[0]!.id, reason: 'already-present' },
    ]);
    expect(recorder.cardPuts).not.toContain(fixture.cards[0]!.id);
  });

  it('探测已有记录走一次分页列举，而不是逐条 get', async () => {
    // 逐条 `get` 是 O(n) 次串行 IPC 往返（上限 10 万条时是 10 万次）。
    const fixture = buildFixture({ cardCount: 5, packageCount: 0 });
    const recorder = createTarget({ cards: fixture.cards.map((card) => card.id) });
    const listCalls: unknown[] = [];
    const originalList = recorder.target.cards.list.bind(recorder.target.cards);
    recorder.target.cards.list = (async (query: LocalCardQuery) => {
      listCalls.push(query);
      return originalList(query);
    }) as typeof recorder.target.cards.list;

    const plan = await inspectLocalLibraryArchive(recorder.target, await packFixture({ cardCount: 5, packageCount: 0 }));
    expect(plan.existingCardIds).toHaveLength(5);
    expect(listCalls).toHaveLength(1);
    // includeDeleted 是必需的：墓碑也是"已存在"，漏掉它会让导入复活用户删掉的记录。
    expect(listCalls[0]).toMatchObject({ includeDeleted: true });
  });

  it('清单与归档不是同一段字节时拒绝写入', async () => {
    const recorder = createTarget();
    const archive = await packFixture();
    const plan = await inspectLocalLibraryArchive(recorder.target, archive);
    const other = await packFixture({ cardCount: 3 });

    await expect(
      applyLocalLibraryArchiveImport(recorder.target, other, plan),
    ).rejects.toMatchObject({ code: 'archive-manifest-invalid' });
    expect(recorder.cardPuts).toEqual([]);
  });
});

describe('不可信归档的解压边界（DESK-074）', () => {
  const rejects = async (
    archive: Uint8Array,
    code: string,
    budgets: Parameters<typeof inspectLocalLibraryArchive>[2] = {},
  ): Promise<LocalLibraryArchiveImportError> => {
    const recorder = createTarget();
    const error = await inspectLocalLibraryArchive(recorder.target, archive, budgets).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(LocalLibraryArchiveImportError);
    expect((error as LocalLibraryArchiveImportError).code).toBe(code);
    // 任何一种拒绝都必须发生在**任何一次写**之前，否则"preflight 先行"只是一句注释。
    expect(recorder.cardPuts).toEqual([]);
    expect(recorder.packagePuts).toEqual([]);
    return error as LocalLibraryArchiveImportError;
  };

  it('manifest 不是第一个 entry 时整体拒绝', async () => {
    const original = await packFixture();
    const entries = unzipAll(original);
    const manifestBytes = entries.get(LOCAL_LIBRARY_ARCHIVE_MANIFEST_PATH)!;
    const order = [
      ...[...entries.keys()].filter((path) => path !== LOCAL_LIBRARY_ARCHIVE_MANIFEST_PATH),
      LOCAL_LIBRARY_ARCHIVE_MANIFEST_PATH,
    ];
    // manifest 优先是**格式属性**：把它挪到最后，解包器就必须先解压其余条目才能拒绝，
    // 而那正是 OWASP ASVS V5.2.3 禁止的形状。
    await rejects(repack(entries, order), 'archive-manifest-invalid');
    expect(manifestBytes.byteLength).toBeGreaterThan(0);
  });

  it('manifest 缺失时整体拒绝', async () => {
    const entries = unzipAll(await packFixture());
    entries.delete(LOCAL_LIBRARY_ARCHIVE_MANIFEST_PATH);
    await rejects(repack(entries), 'archive-manifest-invalid');
  });

  it('manifest 超过独立上限时整体拒绝', async () => {
    await rejects(await packFixture(), 'archive-manifest-invalid', { maxManifestBytes: 16 });
  });

  it('路径不在 allowlist 内时整体拒绝', async () => {
    const archive = await packMutated((entries) => {
      entries.set('notes/readme.txt', encoder.encode('hello'));
      return { entries };
    });
    await rejects(archive, 'archive-entry-invalid');
  });

  it('同一路径出现两次时整体拒绝', async () => {
    // 中央目录里只看得到最后一份，因此重复路径会让"哪一份被导入"变成一个看不见的变量。
    const entries = unzipAll(await packFixture());
    const cardPaths = [...entries.keys()].filter((entry) => entry.startsWith('cards/'));
    const [first, second] = cardPaths as [string, string];
    // 夹具里两条卡片路径来自同长度的 id，因此等长改名在偏移量上是安全的。
    expect(second.length).toBe(first.length);
    // `zipSync` 以路径为键，直接重打会把重复项折叠成一份，所以先造一个等长的影子路径，
    // 再在字节层面把它改回 `second`——于是归档里同一路径出现了两次。
    const shadow = `${second.slice(0, -1)}q`;
    expect(shadow).not.toBe(second);
    entries.set(shadow, entries.get(second)!);
    await rejects(renameEntryInPlace(repack(entries), shadow, second), 'archive-entry-invalid');
  });

  it('归档含有清单未声明的条目时整体拒绝', async () => {
    const archive = await packMutated((entries) => {
      entries.set('cards/undeclared.json', encoder.encode('{}'));
      return { entries };
    });
    await rejects(archive, 'archive-entry-invalid');
  });

  it('清单声明了而归档里没有的条目时整体拒绝', async () => {
    const entries = unzipAll(await packFixture());
    const dropped = [...entries.keys()].find((path) => path.startsWith('archives/'))!;
    entries.delete(dropped);
    await rejects(repack(entries), 'archive-entry-invalid');
  });

  it('实际长度超过清单声明时立即拒绝，而不是先收完再判', async () => {
    const entries = unzipAll(await packFixture());
    const manifest = readManifest(entries);
    const cardPath = manifest.cards[0]!.path;
    // 声明长度造假：一个几百字节的记录条目，实际塞进 4 MiB。
    entries.set(cardPath, new Uint8Array(4 * 1024 * 1024).fill(0x61));
    writeManifest(entries, manifest);
    const error = await rejects(repack(entries), 'archive-entry-corrupt');
    // 报的是"声明长度"这一条而不是"预算"：预算是归档级的守卫，它按清单声明的长度先收口。
    expect(error.message).toContain('实际长度超过清单声明');
  });

  it('一条目实际解压字节先把归档级预算撑破时报预算而不是条目', async () => {
    const entries = unzipAll(await packFixture());
    const manifest = readManifest(entries);
    const cardPath = manifest.cards[0]!.path;
    entries.set(cardPath, new Uint8Array(4 * 1024 * 1024).fill(0x61));
    writeManifest(entries, manifest);
    // 预算是"声明总量 + 1 MiB"：声明总量本身仍在预算内（因此 OWASP 要求的那次预检不会拒绝），
    // 但这条目的实际输出会把预算撑破。
    const declared = manifestBytesOf(readManifest(entries));
    const error = await rejects(repack(entries), 'archive-budget-exceeded', {
      maxTotalBytes: declared + 1024 * 1024,
    });
    expect(error.message).toContain('实际解压字节超过预算');
  });

  it('累计字节超过归档总预算时整体拒绝', async () => {
    await rejects(await packFixture(), 'archive-budget-exceeded', { maxTotalBytes: 32 });
  });

  it('条目数超过上限时整体拒绝', async () => {
    await rejects(await packFixture(), 'archive-too-many-entries', { maxEntries: 1 });
  });

  it('实际字节摘要与清单声明不符时整体拒绝', async () => {
    const archive = await packMutated((entries) => {
      const cardPath = readManifest(entries).cards[0]!.path;
      const original = entries.get(cardPath)!;
      // 同长度、不同内容：长度核对通过，摘要核对必须抓住它。
      const tampered = new Uint8Array(original);
      tampered[tampered.byteLength - 1] ^= 0xff;
      entries.set(cardPath, tampered);
      return { entries };
    });
    await rejects(archive, 'archive-entry-corrupt');
  });

  it('不是合法 ZIP 时整体拒绝', async () => {
    await rejects(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), 'archive-malformed');
  });

  it('记录 JSON 与清单声明的 id 不符时整体拒绝', async () => {
    const archive = await packMutated(async (entries) => {
      const manifest = readManifest(entries);
      const entry = manifest.cards[0]!;
      const record = JSON.parse(new TextDecoder().decode(entries.get(entry.path))) as {
        id: string;
      };
      record.id = 'lc_somebody_else_entirely_000000';
      const bytes = encoder.encode(JSON.stringify(record));
      entries.set(entry.path, bytes);
      manifest.cards[0] = {
        ...entry,
        checksum: await sha256DigestOfBytes(bytes),
        byteLength: bytes.byteLength,
      };
      writeManifest(entries, manifest);
      return { entries };
    });
    await rejects(archive, 'archive-entry-invalid');
  });

  it('manifest 上限是独立常量，且远小于归档总预算', () => {
    expect(MAX_LOCAL_LIBRARY_ARCHIVE_MANIFEST_BYTES).toBe(16 * 1024 * 1024);
    // 两者合成一个会让"清单巨大"与"载荷巨大"变成同一种失败。
    expect(MAX_LOCAL_LIBRARY_ARCHIVE_MANIFEST_BYTES).toBeLessThan(256 * 1024 * 1024);
  });
});

describe('规模：条目数本身就是一个攻击面', () => {
  it('数千个条目的真实归档仍可导入', async () => {
    // 这条门禁钉住的是 `STREAM_CHUNK_BYTES`：fflate 的 `Unzip.push` 在一次调用内按条目数递归，
    // 因此**一次 push 里的条目数就是调用栈深度**，而条目密度由攻击者决定。块曾经是 4 MiB，
    // 于是约 2300 个条目就 `RangeError`——而 `packLocalLibraryArchive` 本身没有条目数上限，
    // 也就是说本仓库自己的导出器能产出一个本模块读不回来的归档。
    const cards = Array.from({ length: 3000 }, (_, index) => makeCard(index + 1));
    const source: LocalLibraryArchiveSource = {
      listCards: async () => ({ items: cards, nextCursor: null }),
      listWebPackages: async () => ({ items: [], nextCursor: null }),
      readWebPackageArchive: async () => new Uint8Array(),
    };
    const collected = await collectLocalLibraryArchive(source, { exportedAt: EXPORTED_AT });
    const packed = await packLocalLibraryArchive(collected.manifest, collected.read);

    const plan = await inspectLocalLibraryArchive(createTarget().target, packed.bytes);
    expect(plan.summary.cardCount).toBe(3000);
  }, 60_000);

  it('声明总量与实际总量各算一次，不重复计费', async () => {
    // 合成一个"声明总量刚好落在预算内、但收两遍费就超预算"的归档。若两个计数器合成一个，
    // 导入器会拒绝导出器自己的产物——实测 200 MiB 的库导出成功、导入被拒，而错误信息里的那个
    // 数字有一半是重复计费。
    const each = 20 * 1024 * 1024;
    const cards = Array.from({ length: 10 }, (_, index) => ({
      ...makeCard(index + 1),
      data: { blob: 'x'.repeat(each) },
    }));
    const source: LocalLibraryArchiveSource = {
      listCards: async () => ({ items: cards, nextCursor: null }),
      listWebPackages: async () => ({ items: [], nextCursor: null }),
      readWebPackageArchive: async () => new Uint8Array(),
    };
    const collected = await collectLocalLibraryArchive(source, { exportedAt: EXPORTED_AT });
    const packed = await packLocalLibraryArchive(collected.manifest, collected.read);
    // 打包侧先确认这份归档**合法地**落在预算内，否则这条用例测的是"两个上限都不够大"。
    expect(packed.totalByteLength).toBeLessThanOrEqual(MAX_LOCAL_LIBRARY_ARCHIVE_INPUT_BYTES);

    // 把预算钉死在打包侧的输入总量上：一份自洽归档的实际总量恰好等于它，因此必须被接受。
    await expect(
      inspectLocalLibraryArchive(createTarget().target, packed.bytes, {
        maxTotalBytes: packed.totalByteLength,
      }),
    ).resolves.toMatchObject({ summary: { cardCount: 10 } });
  }, 60_000);
});

describe('零网络断言的可信度', () => {
  const originalFetch = globalThis.fetch;
  const originalXhr = typeof globalThis.XMLHttpRequest;

  /** fetch 返回被拒绝的 promise，XHR 一经构造就抛——两条路都要封。 */
  const denyNetwork = (): void => {
    class DeniedXhr {
      constructor() {
        throw new Error('导入路径发起了 XHR');
      }
    }
    Object.assign(globalThis, {
      fetch: () => Promise.reject(new Error('导入路径发起了网络请求')),
      XMLHttpRequest: DeniedXhr,
    });
  };

  beforeEach(denyNetwork);

  afterEach(() => {
    Object.assign(globalThis, { fetch: originalFetch });
    if (originalXhr === undefined) delete (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest;
    else Object.assign(globalThis, { XMLHttpRequest: originalXhr });
  });

  it('守卫本身是有效的：真的发请求就会被挡住', async () => {
    // 没有这条，"零网络"那条断言可能在守卫早已失效的情况下一直是绿的。
    await expect(fetch('https://example.invalid')).rejects.toThrow(/网络请求/u);
    expect(() => new XMLHttpRequest()).toThrow(/XHR/u);
  });
});