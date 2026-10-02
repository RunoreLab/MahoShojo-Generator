import { describe, expect, it, vi } from 'vitest';

import type { LocalCardRecordV1 } from '@mahoshojo/local-library/record';
import {
  collectLocalLibraryArchive,
  type LocalLibraryArchiveSource,
} from '@mahoshojo/local-library/archive-export';
import {
  MAX_LOCAL_LIBRARY_ARCHIVE_INPUT_BYTES,
  MAX_LOCAL_LIBRARY_ARCHIVE_OUTPUT_BYTES,
  packLocalLibraryArchive,
} from '@mahoshojo/local-library/archive-pack';
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
const DIGEST_B = `sha256:${'b'.repeat(64)}`;

const zipBytes = (seed: string): Uint8Array =>
  new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...encoder.encode(seed.repeat(64)).slice(0, 256)]);

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
const PACKAGE_ZIP = zipBytes('b');
const PACKAGE: LocalWebPackageRecordV1 = {
  id: deriveLocalWebPackageId(DIGEST_B),
  schemaVersion: 1,
  storageLocation: 'local',
  entityKind: 'web-package',
  title: '本地包',
  summary: 'local.library-test@1.0.0',
  ref: { id: 'local.library-test', version: '1.0.0', digest: DIGEST_B },
  manifest: {
    format: 'mahoshojo-web-package',
    formatVersion: 1,
    id: 'local.library-test',
    version: '1.0.0',
    name: '本地包',
    entry: 'index.html',
    generation: { target: 'index.html', mode: 'replace', mediaType: 'text/html' },
    capabilities: ['scripts'],
    // `entry` MUST 在 `files` 里存在且是 text/html——这条约束来自 Web 包契约，导入侧因此
    // 不能凭空造出一个"清单说有、文件里没有"的包。
    files: [{ path: 'index.html', mediaType: 'text/html', digest: DIGEST_B, size: 2 }],
  },
  contentDigest: DIGEST_B,
  archiveByteLength: PACKAGE_ZIP.byteLength,
  provenance: { kind: 'unsigned', execution: 'imported' },
  createdAt: '2026-08-23T12:00:00.000Z',
  updatedAt: '2026-08-23T12:00:00.000Z',
};

const source: LocalLibraryArchiveSource = {
  listCards: async () => ({ items: [CARD], nextCursor: null }),
  listWebPackages: async () => ({ items: [PACKAGE], nextCursor: null }),
  readWebPackageArchive: async () => PACKAGE_ZIP,
};

const buildArchive = async (): Promise<Uint8Array> => {
  const collected = await collectLocalLibraryArchive(source, { exportedAt: EXPORTED_AT });
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
    const bytes = await readFileBytes(new File([zipBytes('a')], 'local-library.zip'));
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
    expect(report.succeededWebPackageIds).toEqual([PACKAGE.id]);
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