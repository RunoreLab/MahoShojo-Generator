import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import {
  deriveLocalWebPackageId,
  type LocalWebPackageRecordV1,
} from '@mahoshojo/local-library/web-package-record';
import {
  LOCAL_LIBRARY_ARCHIVE_MANIFEST_PATH,
  localLibraryArchiveStem,
  localLibraryArchiveWebPackageArchivePath,
  localLibraryArchiveWebPackagePath,
  type LocalLibraryArchiveManifestV2,
} from '@mahoshojo/local-library/archive';
import {
  LOCAL_LIBRARY_ARCHIVE_TOO_LARGE_CODE,
  LocalLibraryArchiveTooLargeError,
  MAX_LOCAL_LIBRARY_ARCHIVE_BYTES,
  packLocalLibraryArchive,
} from '@mahoshojo/local-library/archive-pack';

import { createLocalWebPackageRecord } from './web-package-fixtures';

const digest = (hex: string): string => `sha256:${hex}`;
const HEX_A = 'a'.repeat(64);
const HEX_B = 'b'.repeat(64);
const HEX_C = 'c'.repeat(64);

const encoder = new TextEncoder();

/**
 * 由序号造一个**各处都不同**的 64 位十六进制。
 *
 * 不能只改末尾：Web 包 id 由摘要**前 32 位**派生，而卡片路径 stem 由 id 派生。序号若只落在
 * 尾部，摘要前 32 位全同 ⇒ 所有包 id 相同、所有卡片 stem 相同 ⇒ 合成库被清单的唯一性检查拒绝。
 * （这个坑在实测脚本里也踩过一次，说明它值得一个专门的辅助函数。）
 */
const distinctHex = (index: number): string => {
  const high = index.toString(16).padStart(32, '0');
  return `${high}${high}`.slice(0, 64);
};

/**
 * 造一份"内容地址自洽"的合成库。
 *
 * 刻意**不**手写摘要：`archivePath` 必须由 `archiveDigest` 推导（`DESK-059c`），手写摘要
 * 就要同时维护三个字段的一致性，而不一致的夹具会让真正的门禁看起来像坏了。
 */
const createLibrary = (options: { cardCount?: number; packageCount?: number } = {}) => {
  const { cardCount = 2, packageCount = 2 } = options;
  const entries = new Map<string, Uint8Array>();

  const cards = Array.from({ length: cardCount }, (_, index) => {
    const id = `lc_${distinctHex(index + 1).slice(0, 32)}`;
    const record = {
      id,
      schemaVersion: 1,
      storageLocation: 'local',
      cardType: 'character',
      title: `card ${index}`,
      data: { index },
      contentDigest: digest(distinctHex(index + 1)),
      provenance: { kind: 'unsigned' },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const bytes = encoder.encode(JSON.stringify(record, null, 2));
    const path = `cards/${localLibraryArchiveStem(id)}.json`;
    entries.set(path, bytes);
    return {
      cardId: id,
      path,
      contentDigest: record.contentDigest,
      checksum: digest(HEX_B),
      byteLength: bytes.byteLength,
    };
  });

  const webPackages = Array.from({ length: packageCount }, (_, index) => {
    const contentDigest = digest(distinctHex(index + 1));
    const archiveDigest = digest(distinctHex(index + 101));
    const record: LocalWebPackageRecordV1 = createLocalWebPackageRecord({
      id: deriveLocalWebPackageId(contentDigest),
      contentDigest,
      ref: { id: 'local.library-test', version: `1.0.${index}`, digest: contentDigest },
      title: `package ${index}`,
    });
    const recordBytes = encoder.encode(JSON.stringify(record, null, 2));
    const path = localLibraryArchiveWebPackagePath(localLibraryArchiveStem(record.id));
    const archiveBytes = encoder.encode(`PK\x03\x04 fake zip payload ${index} `.repeat(64));
    entries.set(path, recordBytes);
    entries.set(localLibraryArchiveWebPackageArchivePath(archiveDigest), archiveBytes);
    return {
      packageId: record.id,
      path,
      contentDigest: record.contentDigest,
      checksum: digest(HEX_B),
      byteLength: recordBytes.byteLength,
      archivePath: localLibraryArchiveWebPackageArchivePath(archiveDigest),
      archiveDigest,
      archiveByteLength: archiveBytes.byteLength,
    };
  });

  const manifest = {
    format: 'mahoshojo-local-library',
    formatVersion: 2,
    cardSchemaVersion: 1,
    webPackageSchemaVersion: 1,
    exportedAt: '2026-01-01T00:00:00.000Z',
    cardCount: cards.length,
    webPackageCount: webPackages.length,
    cards,
    webPackages,
  } as unknown as LocalLibraryArchiveManifestV2;

  return { manifest, entries };
};

const readFrom = (entries: Map<string, Uint8Array>) => async (path: string): Promise<Uint8Array> => {
  const bytes = entries.get(path);
  if (!bytes) throw new Error(`unexpected read of ${path}`);
  return bytes;
};

const packFixture = (options: Parameters<typeof createLibrary>[0] = {}, packOptions = {}) => {
  const { manifest, entries } = createLibrary(options);
  return packLocalLibraryArchive(manifest, readFrom(entries), packOptions);
};

describe('packLocalLibraryArchive', () => {
  it('produces an archive that unzips back to exactly the bytes it was given', async () => {
    const { manifest, entries } = createLibrary();
    const packed = await packLocalLibraryArchive(manifest, readFrom(entries));
    const extracted = unzipSync(packed.bytes);

    for (const [path, bytes] of entries) {
      expect([...extracted[path]!], `${path} must round-trip byte for byte`).toEqual([...bytes]);
    }
    // 清单也必须能被自己的 schema 读回来——这是"我们写出的东西我们自己能读"的最弱保证。
    const manifestBytes = extracted[LOCAL_LIBRARY_ARCHIVE_MANIFEST_PATH]!;
    expect(JSON.parse(new TextDecoder().decode(manifestBytes))).toEqual(manifest);
  });

  it('is byte-for-byte deterministic across runs', async () => {
    // 确定性归档让"打包逻辑是否变了"有一个可验证的答案。它依赖固定条目时间 **和** 固定条目
    // 顺序，两者缺一都会让归档在两次导出之间变化，而症状（摘要漂移）与根因（打包顺序）完全
    // 无关。
    //
    // 注意前提：夹具把 `exportedAt` 钉死成同一个值，因此这条断言的是"给定同一份清单 ⇒ 同一份
    // 字节"。`exportedAt` 参与字节这件事由下面那条用例单独断言。
    const first = await packFixture();
    const second = await packFixture();
    expect([...first.bytes]).toEqual([...second.bytes]);
  });

  it('changes its bytes when only exportedAt changes', async () => {
    // `manifest.json` 就是清单的 JSON.stringify，而 `exportedAt` 是它的必填字段，因此它必然
    // 进入字节。此前文档写成"exportedAt 刻意不参与字节布局"，与实现相反——而上面那条
    // deterministic 用例因为把 `exportedAt` 钉死，从未检验过这一点。
    //
    // 这条断言的作用是**把边界钉死**：调用方要判断"这份库的内容变了没有"，必须比较各记录的
    // contentDigest / archiveDigest，不能比较整个归档的字节摘要；反过来"打包逻辑变了没有"
    // 才是在固定 exportedAt 的前提下比字节。两种用途一旦混淆，症状是"同一份库两次导出摘要
    // 不同"，而根因是调用方问错了问题。
    const { manifest, entries } = createLibrary();
    const base = await packLocalLibraryArchive(manifest, readFrom(entries));
    const later = await packLocalLibraryArchive(
      { ...manifest, exportedAt: '2026-06-30T12:34:56.000Z' } as LocalLibraryArchiveManifestV2,
      readFrom(entries),
    );
    expect([...later.bytes]).not.toEqual([...base.bytes]);
    // 变的是清单本身，不是别的：条目载荷必须逐字节不变，否则这条断言会因为无关原因通过。
    const before = unzipSync(base.bytes);
    const after = unzipSync(later.bytes);
    for (const [entryPath, bytes] of entries) {
      expect([...after[entryPath]!], `${entryPath} must not depend on exportedAt`).toEqual([
        ...bytes,
      ]);
    }
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
  });

  it('is independent of the order entries appear in the manifest', async () => {
    // 清单数组的顺序来自数据库查询/游标的实现细节。让它影响输出字节，等于让"两份相同的库"
    // 产出不同的归档摘要——而症状（摘要漂移）与根因（打包顺序）完全无关。
    const { manifest, entries } = createLibrary({ cardCount: 4, packageCount: 3 });
    const forward = await packLocalLibraryArchive(manifest, readFrom(entries));
    const shuffled = await packLocalLibraryArchive({
      ...manifest,
      cards: [...manifest.cards].reverse(),
      webPackages: [...manifest.webPackages].reverse(),
    } as LocalLibraryArchiveManifestV2, readFrom(entries));
    expect([...forward.bytes]).toEqual([...shuffled.bytes]);
  });

  it('stores web package ZIPs without recompressing them', async () => {
    // 双压缩既不省体积又烧 CPU。判据是"归档体积 ≈ 输入体积"：记录 JSON 会被压掉不少，
    // 所以只要 ZIP 真的被压了，归档就会明显小于输入。
    const highlyCompressible = encoder.encode('A'.repeat(4 * 1024 * 1024));
    const { manifest, entries } = createLibrary({ packageCount: 0 });
    manifest.webPackageCount = 1;
    manifest.cards = [];
    manifest.cardCount = 0;
    const packageId = 'wp_probe';
    const archiveDigest = digest(HEX_B);
    const archivePath = localLibraryArchiveWebPackageArchivePath(archiveDigest);
    const recordBytes = encoder.encode(JSON.stringify({ id: packageId }, null, 2));
    const path = localLibraryArchiveWebPackagePath(packageId);
    entries.set(path, recordBytes);
    entries.set(archivePath, highlyCompressible);
    manifest.webPackages = [{
      packageId,
      path,
      contentDigest: digest(HEX_C),
      checksum: digest(HEX_A),
      byteLength: recordBytes.byteLength,
      archivePath,
      archiveDigest,
      archiveByteLength: highlyCompressible.byteLength,
    }];

    const packed = await packLocalLibraryArchive(manifest, readFrom(entries));
    // 4 MiB 的 'AAAA...' 若被压缩，归 archiv会缩到几 KiB。
    expect(packed.bytes.byteLength).toBeGreaterThan(3 * 1024 * 1024);
    expect(packed.totalByteLength).toBeGreaterThan(4 * 1024 * 1024);
  });

  it('compresses record JSON', async () => {
    // store 只针对 Web 包 ZIP；记录 JSON 仍应被压掉，否则白扛一份体积。
    const { manifest, entries } = createLibrary({ cardCount: 8, packageCount: 0 });
    const packed = await packLocalLibraryArchive(manifest, readFrom(entries));
    const extracted = unzipSync(packed.bytes);
    const jsonBytes = Object.entries(extracted)
      .filter(([path]) => path.endsWith('.json'))
      .reduce((sum, [, bytes]) => sum + bytes.length, 0);
    // 归档必须比未压缩的 JSON 总量小；否则 `level` 没生效。
    expect(packed.bytes.byteLength).toBeLessThan(jsonBytes);
  });

  it('rejects an oversized library before reading anything', async () => {
    // 上限若只在读完才检查，超限分配已经发生——"上限"就退化成事后观测。
    const { manifest } = createLibrary();
    const read = vi.fn();
    await expect(packLocalLibraryArchive(manifest, read as never, { maxTotalBytes: 1 }))
      .rejects.toBeInstanceOf(LocalLibraryArchiveTooLargeError);
    expect(read).not.toHaveBeenCalled();
  });

  it('rejects a source that returns more bytes than the manifest declared', async () => {
    // 只按声明求和的检查对不诚实的来源完全失效：清单说 1 KiB，实际给 10 MiB，归档悄悄
    // 超出上限——而上限正是这里要防的东西。
    const { manifest, entries } = createLibrary({ cardCount: 1, packageCount: 0 });
    const path = manifest.cards[0]!.path;
    const inflated = new Uint8Array(2 * 1024 * 1024);
    await expect(packLocalLibraryArchive(manifest, async (requested) => (
      requested === path ? inflated : entries.get(requested)!
    ), { maxTotalBytes: 1024 * 1024 })).rejects.toMatchObject({
      code: LOCAL_LIBRARY_ARCHIVE_TOO_LARGE_CODE,
    });
  });

  it('reports the limit it actually applied', async () => {
    const { manifest, entries } = createLibrary();
    await expect(packLocalLibraryArchive(manifest, readFrom(entries), { maxTotalBytes: 1 }))
      .rejects.toMatchObject({ actualBytes: expect.any(Number), limitBytes: 1 });
  });

  it('validates the manifest before writing anything', async () => {
    // 唯一能保证"写出的归档能被自己的导入侧接受"的地方就是写入点。让下游去发现
    // "自己刚写的归档打不开"，定位成本高得多。
    const { manifest } = createLibrary();
    const read = vi.fn();
    await expect(packLocalLibraryArchive(
      { ...manifest, webPackageCount: 99 } as LocalLibraryArchiveManifestV2,
      read as never,
    )).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
  });

  it('rejects a manifest whose archivePath disagrees with its archiveDigest', async () => {
    // schema 管形状，这条管"两个概念是否指向同一件事"。让路径规则改了而某个构造点忘了更新，
    // 应该是一次立即失败，而不是一次内容地址错位、症状与根因无关的导入失败。
    const { manifest, entries } = createLibrary();
    const tampered = {
      ...manifest,
      webPackages: manifest.webPackages.map((entry) => ({
        ...entry,
        archivePath: localLibraryArchiveWebPackageArchivePath(digest(HEX_C)),
      })),
    } as LocalLibraryArchiveManifestV2;
    // schema 本身就会拒绝，因此这里断言的是"整条路径被守住"，不是哪一层守住。
    await expect(packLocalLibraryArchive(tampered, readFrom(entries))).rejects.toThrow();
  });

  it('defaults to the documented archive cap', async () => {
    // 上限是 DESK-070 的可诊断承诺；它由实测推导，改动需重跑实测脚本。
    expect(MAX_LOCAL_LIBRARY_ARCHIVE_BYTES).toBe(256 * 1024 * 1024);
    expect(MAX_LOCAL_LIBRARY_ARCHIVE_BYTES).toBeGreaterThan(64 * 1024 * 1024);
  });
});
