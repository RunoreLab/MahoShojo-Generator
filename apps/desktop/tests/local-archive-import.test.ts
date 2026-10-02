import { describe, expect, it, vi } from 'vitest';

import type { LocalCardRecordV1 } from '@mahoshojo/local-library/record';
import {
  collectLocalLibraryArchive,
} from '@mahoshojo/local-library/archive-export';
import {
  MAX_LOCAL_LIBRARY_ARCHIVE_INPUT_BYTES,
  MAX_LOCAL_LIBRARY_ARCHIVE_OUTPUT_BYTES,
  packLocalLibraryArchive,
} from '@mahoshojo/local-library/archive-pack';
import { digestWebPackageBytes, packWebPackageZip, verifyWebPackage } from '@mahoshojo/web-package';
import {
  deriveLocalWebPackageId,
  type LocalWebPackageRecordV1,
} from '@mahoshojo/local-library/web-package-record';
import type { CardRepository } from '@mahoshojo/local-library/repository';
import type { WebPackageRepository } from '@mahoshojo/local-library/web-package-record';

import {
  applyDesktopLibraryArchiveImport,
  DESKTOP_LIBRARY_IMPORT_LIMITS,
  inspectDesktopLibraryArchive,
  readFileBytes,
} from '../src/platform/local-archive-import';

const encoder = new TextEncoder();
const EXPORTED_AT = '2026-10-02T00:00:00.000Z';

const DIGEST_A = `sha256:${'a'.repeat(64)}`;

/**
 * 记录夹具在本文件内自建，而不是从 `@mahoshojo/local-library` 的测试目录里 import。
 *
 * 那是另一个 package 的内部路径：`packages/*` 的对外接口是显式 `exports`，把它的 `tests/`
 * 当成可复用夹具库会让那条边界在第一次"就借一下"时失效。
 */
const CARD: LocalCardRecordV1 = {
  id: 'lc_11111111111111111111111111111111',
  schemaVersion: 1,
  storageLocation: 'local',
  cardType: 'character',
  title: '本地卡',
  data: { name: 'A' },
  contentDigest: DIGEST_A,
  provenance: { kind: 'unsigned', execution: 'direct-local' },
  createdAt: '2026-08-23T12:00:00.000Z',
  updatedAt: '2026-08-23T12:00:00.000Z',
};
/**
 * 真实的 Web 包 ZIP，以及与之**逐字段一致**的记录。
 *
 * 这里此前是 `PK\x03\x04` + 重复字节的假 ZIP，配一份 `digest` / `size` 都随手写的清单。导入器现在会
 * 调用共享的 Web 包校验来证明内层 ZIP 确实是记录所声明的那个包，于是这份夹具两处都不成立：它不是
 * ZIP，而它的身份与它的内容无关——`ref.digest` 指向的包和 `archives/` 里那个 blob 没有关系。
 *
 * 记录由 `verifyWebPackage` 的输出**派生**而不是另写一份清单：`manifest` 字段必须是那份 ZIP 自己的
 * 清单，否则一个正确实现了校验的导入器会正确地拒绝它，而症状与根因之间隔着一个夹具。
 */
const buildPackageFixture = async (): Promise<{
  readonly bytes: Uint8Array;
  readonly record: LocalWebPackageRecordV1;
}> => {
  // `entry` MUST 在 `files` 里存在且是 text/html——这条约束来自 Web 包契约，导入侧因此不能凭空造出
  // 一个"清单说有、文件里没有"的包。
  const files = [{ path: 'index.html', bytes: encoder.encode('<h1>本地包</h1>') }];
  const manifest = {
    format: 'mahoshojo-web-package',
    formatVersion: 1,
    id: 'local.library-test',
    version: '1.0.0',
    name: '本地包',
    entry: 'index.html',
    generation: { target: 'index.html', mode: 'replace', mediaType: 'text/html' },
    capabilities: ['scripts'],
    files: await Promise.all(files.map(async (file) => ({
      path: file.path,
      mediaType: 'text/html',
      digest: await digestWebPackageBytes(file.bytes),
      size: file.bytes.length,
    }))),
  };
  const pkg = await verifyWebPackage(manifest, files);
  const bytes = await packWebPackageZip(pkg);
  return {
    bytes,
    record: {
      id: deriveLocalWebPackageId(pkg.ref.digest),
      schemaVersion: 1,
      storageLocation: 'local',
      entityKind: 'web-package',
      title: '本地包',
      summary: `${pkg.ref.id}@${pkg.ref.version}`,
      ref: pkg.ref,
      manifest: pkg.manifest,
      contentDigest: pkg.ref.digest,
      archiveByteLength: bytes.byteLength,
      provenance: { kind: 'unsigned', execution: 'imported' },
      createdAt: '2026-08-23T12:00:00.000Z',
      updatedAt: '2026-08-23T12:00:00.000Z',
    },
  };
};

/** 同一个夹具被多条用例共享，而构造它是异步的；缓存 promise 而不是每次重建。 */
let packageFixture: Promise<Awaited<ReturnType<typeof buildPackageFixture>>> | undefined;
const packageFixtureOnce = (): Promise<Awaited<ReturnType<typeof buildPackageFixture>>> => {
  packageFixture ??= buildPackageFixture();
  return packageFixture;
};

const buildArchive = async (): Promise<Uint8Array> => {
  const { bytes, record } = await packageFixtureOnce();
  const collected = await collectLocalLibraryArchive({
    listCards: async () => ({ items: [CARD], nextCursor: null }),
    listWebPackages: async () => ({ items: [record], nextCursor: null }),
    readWebPackageArchive: async () => bytes,
  }, { exportedAt: EXPORTED_AT });
  return (await packLocalLibraryArchive(collected.manifest, collected.read)).bytes;
};

const createTarget = () => {
  const cardPuts: string[] = [];
  const packagePuts: string[] = [];
  const cards = {
    async get() {
      return null;
    },
    async list() {
      return { items: [] };
    },
    async put(record: LocalCardRecordV1) {
      cardPuts.push(record.id);
    },
    // 已写入的 id 集合：`putIfAbsent` 必须在已存在时报 `alreadyPresent`，否则 apply 会误报
    // "写入成功"。双方定义的跳过判定是这个原语的结果，而不是写入前的 `get`。
    async putIfAbsent(record: LocalCardRecordV1) {
      if (cardPuts.includes(record.id)) return { alreadyPresent: true as const };
      cardPuts.push(record.id);
      return { written: true as const };
    },
    async delete() {},
    async restore() {},
  } as unknown as CardRepository;
  const packages = {
    async get() {
      return null;
    },
    async list() {
      return { items: [] };
    },
    async put(record: LocalWebPackageRecordV1) {
      packagePuts.push(record.id);
    },
    async putIfAbsent(record: LocalWebPackageRecordV1) {
      if (packagePuts.includes(record.id)) return { alreadyPresent: true as const };
      packagePuts.push(record.id);
      return { written: true as const };
    },
    async delete() {},
    async restore() {},
    async purge() {},
    async readArchive() {
      return null;
    },
  } as unknown as WebPackageRepository;
  return { target: { cards, packages }, cardPuts, packagePuts };
};

describe('readFileBytes', () => {
  it('把选中的文件读成字节', async () => {
    // 这条只关心"把文件读成字节"，不需要一个真 ZIP；用字面量而不是旧的假 ZIP 夹具，免得有人
    // 为了读文件去构造一个 Web 包。
    const bytes = await readFileBytes(new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3])], 'local-library.zip'));
    expect(bytes.byteLength).toBeGreaterThan(0);
    expect(Array.from(bytes.subarray(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it('超限文件在读取之前就被拒绝', async () => {
    // 这一层不解压任何东西，因此它能在**分配之前**拒绝；而共享导入模块里的预算守卫要等到第一条
    // entry 开始解压才生效。
    const oversized = {
      size: DESKTOP_LIBRARY_IMPORT_LIMITS.fileBytes + 1,
      arrayBuffer: vi.fn(),
    } as unknown as File;
    await expect(readFileBytes(oversized)).rejects.toMatchObject({
      code: 'archive-budget-exceeded',
    });
    expect(oversized.arrayBuffer).not.toHaveBeenCalled();
  });

  it('实际长度与声明不符时报错而不是返回截断数据', async () => {
    const lying = {
      size: 4,
      arrayBuffer: async () => new ArrayBuffer(8),
    } as unknown as File;
    // 断言 code 而不是"是个错误"：只断言类型的话，别的拒绝理由也会让它变绿。
    await expect(readFileBytes(lying)).rejects.toMatchObject({ code: 'archive-malformed' });
  });
});

describe('Desktop 导入的两步', () => {
  it('inspect 不写任何东西，apply 才写，且写入内容正确', async () => {
    const recorder = createTarget();
    const archive = await buildArchive();

    const plan = await inspectDesktopLibraryArchive(recorder.target, archive);
    expect(plan.summary).toMatchObject({ cardCount: 1, webPackageCount: 1 });
    // 预检阶段一次写都没有，否则"先展示摘要再让用户确认"就不成立。
    expect(recorder.cardPuts).toEqual([]);
    expect(recorder.packagePuts).toEqual([]);

    const report = await applyDesktopLibraryArchiveImport(recorder.target, archive, plan);
    expect(report.succeededCardIds).toEqual([CARD.id]);
    expect(report.succeededWebPackageIds).toEqual([(await packageFixtureOnce()).record.id]);
    expect(report.failed).toEqual([]);
  });

  it('走 <input type="file"> 读入的真实字节同样能导入', async () => {
    const recorder = createTarget();
    const bytes = await readFileBytes(new File([await buildArchive()], 'x.zip'));
    const plan = await inspectDesktopLibraryArchive(recorder.target, bytes);
    const report = await applyDesktopLibraryArchiveImport(recorder.target, bytes, plan);
    expect(report.succeededCardIds).toEqual([CARD.id]);
  });

  it('UI 拿到的上限就是导入侧真正会执行的那个常量', () => {
    // 被度量的是归档**文件长度**，因此必须引用 OUTPUT 上限。此前这条断言比的是字面量
    // `256 * 1024 * 1024`，于是"误用 INPUT 上限"这件事它永远抓不到——而 `DESK-070` 明确
    // `MUST NOT` 让这两个维度互相充当。
    expect(DESKTOP_LIBRARY_IMPORT_LIMITS.fileBytes).toBe(MAX_LOCAL_LIBRARY_ARCHIVE_OUTPUT_BYTES);
    // 两者今天同值，因此"不相等"不是可断言的事实；真正可断言的是**引用了哪一个**——上面那行
    // 才是这条门禁的实质。
    expect(MAX_LOCAL_LIBRARY_ARCHIVE_INPUT_BYTES).toBe(MAX_LOCAL_LIBRARY_ARCHIVE_OUTPUT_BYTES);
  });
});