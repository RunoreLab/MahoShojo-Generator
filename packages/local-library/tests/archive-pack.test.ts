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
  LocalLibraryArchiveEntryMismatchError,
  LocalLibraryArchiveTooLargeError,
  MAX_LOCAL_LIBRARY_ARCHIVE_INPUT_BYTES,
  MAX_LOCAL_LIBRARY_ARCHIVE_OUTPUT_BYTES,
  packLocalLibraryArchive,
} from '@mahoshojo/local-library/archive-pack';
import { sha256DigestOfBytes } from '@mahoshojo/local-library/digest';

import { createLocalWebPackageRecord } from './web-package-fixtures';

const digest = (hex: string): string => `sha256:${hex}`;
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
 *
 * `async` 是因为摘要必须是**真的**：打包时逐条复核长度与摘要之后，一个写着 `digest(HEX_B)`
 * 却装着别内容的夹具会被正确地拒绝，于是整个文件都会红，而根因是夹具不再自洽。用
 * `sha256DigestOfBytes`（生产同款）而不是 `node:crypto` 手算，是为了让夹具无法与实现漂移。
 */
const createLibrary = async (options: { cardCount?: number; packageCount?: number } = {}) => {
  const { cardCount = 2, packageCount = 2 } = options;
  const entries = new Map<string, Uint8Array>();

  const cardsPending = Array.from({ length: cardCount }, async (_, index) => {
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
      checksum: await sha256DigestOfBytes(bytes),
      byteLength: bytes.byteLength,
    };
  });
  const cards = await Promise.all(cardsPending);

  const webPackagesPending = Array.from({ length: packageCount }, async (_, index) => {
    const contentDigest = digest(distinctHex(index + 1));
    const record: LocalWebPackageRecordV1 = createLocalWebPackageRecord({
      id: deriveLocalWebPackageId(contentDigest),
      contentDigest,
      ref: { id: 'local.library-test', version: `1.0.${index}`, digest: contentDigest },
      title: `package ${index}`,
    });
    const recordBytes = encoder.encode(JSON.stringify(record, null, 2));
    const path = localLibraryArchiveWebPackagePath(localLibraryArchiveStem(record.id));
    const archiveBytes = encoder.encode(`PK\x03\x04 fake zip payload ${index} `.repeat(64));
    // 先有字节、再有摘要、最后才有路径：顺序反了就会出现一个指向不存在内容的 archivePath。
    const archiveDigest = await sha256DigestOfBytes(archiveBytes);
    const archivePath = localLibraryArchiveWebPackageArchivePath(archiveDigest);
    entries.set(path, recordBytes);
    entries.set(archivePath, archiveBytes);
    return {
      packageId: record.id,
      path,
      contentDigest: record.contentDigest,
      checksum: await sha256DigestOfBytes(recordBytes),
      byteLength: recordBytes.byteLength,
      archivePath,
      archiveDigest,
      archiveByteLength: archiveBytes.byteLength,
    };
  });
  const webPackages = await Promise.all(webPackagesPending);

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

const packFixture = async (options: Parameters<typeof createLibrary>[0] = {}, packOptions = {}) => {
  const { manifest, entries } = await createLibrary(options);
  return packLocalLibraryArchive(manifest, readFrom(entries), packOptions);
};

describe('packLocalLibraryArchive', () => {
  it('produces an archive that unzips back to exactly the bytes it was given', async () => {
    const { manifest, entries } = await createLibrary();
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
    const { manifest, entries } = await createLibrary();
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
    const { manifest, entries } = await createLibrary({ cardCount: 4, packageCount: 3 });
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
    const { manifest, entries } = await createLibrary({ packageCount: 0 });
    manifest.webPackageCount = 1;
    manifest.cards = [];
    manifest.cardCount = 0;
    const packageId = 'wp_probe';
    const archiveDigest = await sha256DigestOfBytes(highlyCompressible);
    const archivePath = localLibraryArchiveWebPackageArchivePath(archiveDigest);
    const recordBytes = encoder.encode(JSON.stringify({ id: packageId }, null, 2));
    const path = localLibraryArchiveWebPackagePath(packageId);
    entries.set(path, recordBytes);
    entries.set(archivePath, highlyCompressible);
    manifest.webPackages = [{
      packageId,
      path,
      contentDigest: digest(HEX_C),
      checksum: await sha256DigestOfBytes(recordBytes),
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
    const { manifest, entries } = await createLibrary({ cardCount: 8, packageCount: 0 });
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
    const { manifest } = await createLibrary();
    const read = vi.fn();
    await expect(packLocalLibraryArchive(manifest, read as never, { maxTotalBytes: 1 }))
      .rejects.toBeInstanceOf(LocalLibraryArchiveTooLargeError);
    expect(read).not.toHaveBeenCalled();
  });

  it('rejects a source that returns more bytes than the manifest declared', async () => {
    // 只按声明求和的检查对不诚实的来源完全失效：清单说 1 KiB，实际给 10 MiB，归档悄悄
    // 超出上限——而上限正是这里要防的东西。
    //
    // 逐条长度复核把这条从"超限"变成了"清单与来源不符"，**并且更早**：谎报的长度先被抓住，
    // 那 2 MiB 根本进不了预算累加。这不是把原断言换掉，而是把它升级成更强的失败点。
    const { manifest, entries } = await createLibrary({ cardCount: 1, packageCount: 0 });
    const path = manifest.cards[0]!.path;
    const inflated = new Uint8Array(2 * 1024 * 1024);
    const failure = await packLocalLibraryArchive(manifest, async (requested) => (
      requested === path ? inflated : entries.get(requested)!
    ), { maxTotalBytes: 1024 * 1024 }).then(
      () => { throw new Error('应当拒绝谎报长度的来源'); },
      (cause: unknown) => cause,
    );
    expect(failure).toBeInstanceOf(LocalLibraryArchiveEntryMismatchError);
    expect(failure).toMatchObject({ code: 'archive-entry-mismatch', path });
  });

  it('reports the limit it actually applied', async () => {
    const { manifest, entries } = await createLibrary();
    await expect(packLocalLibraryArchive(manifest, readFrom(entries), { maxTotalBytes: 1 }))
      .rejects.toMatchObject({ actualBytes: expect.any(Number), limitBytes: 1 });
  });

  it('validates the manifest before writing anything', async () => {
    // 唯一能保证"写出的归档能被自己的导入侧接受"的地方就是写入点。让下游去发现
    // "自己刚写的归档打不开"，定位成本高得多。
    const { manifest } = await createLibrary();
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
    const { manifest, entries } = await createLibrary();
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

  it('rejects an entry that changed between collect and pack, and names it', async () => {
    // 这是**导出侧**最危险的一条：清单里的 `checksum` / `archiveDigest` 是上一次读取时算的，而
    // 本函数会再读一次。Web 包尤其危险——`WebPackageStore::save()` 允许同一个 canonical package id
    // 被重新导入并把 `digest` 更新到新 blob。两个 ZIP 可以有相同的 package manifest、相同的
    // `ref.digest`，却因为压缩参数或布局不同而拥有不同字节摘要。
    //
    // 不复核的失败模式极其难查：清单说 hash(A)、归档里是 B，而**导入器随后会拒绝它**——于是用户
    // 导出了一个打不开的文件，UI 却显示成功。
    const { manifest, entries } = await createLibrary({ cardCount: 1, packageCount: 1 });
    const cardPath = manifest.cards[0]!.path;
    const packageArchivePath = manifest.webPackages[0]!.archivePath;
    // 长度相同、内容不同 ⇒ 只有摘要检查能抓住，这是更强的用例。
    const swapped = new Map(entries);
    swapped.set(cardPath, encoder.encode('X'.repeat(entries.get(cardPath)!.byteLength)));
    swapped.set(packageArchivePath, encoder.encode('Y'.repeat(entries.get(packageArchivePath)!.byteLength)));

    const failure = await packLocalLibraryArchive(manifest, readFrom(swapped)).then(
      () => { throw new Error('应当拒绝与清单摘要不符的条目'); },
      (cause: unknown) => cause,
    );
    expect(failure).toBeInstanceOf(LocalLibraryArchiveEntryMismatchError);
    expect(failure).toMatchObject({ path: cardPath });
    expect((failure as Error).message).toContain(cardPath);
  });

  it('rejects a web package ZIP whose bytes changed under a still-matching path', async () => {
    // 上一条证明了"清单说谎"，这一条证明"来源说谎"：路径由 `archiveDigest` 推导，所以 ZIP 内容变了
    // 而路径不变，意味着**只有**逐条摘要复核能发现它。Web 包导入正是把这条 ZIP 重新写回另一台
    // 机器的地方，所以它必须在这里就被挡住。
    const { manifest, entries } = await createLibrary({ cardCount: 0, packageCount: 1 });
    const archivePath = manifest.webPackages[0]!.archivePath;
    const original = entries.get(archivePath)!;
    const reencoded = new Uint8Array(original.byteLength);
    reencoded.set(original.subarray(0, original.byteLength - 1));
    reencoded[reencoded.byteLength - 1] = original[original.byteLength - 1] ^ 0xff;
    const swapped = new Map(entries);
    swapped.set(archivePath, reencoded);

    const failure = await packLocalLibraryArchive(manifest, readFrom(swapped)).then(
      () => { throw new Error('应当拒绝内容变化的 Web 包 ZIP'); },
      (cause: unknown) => cause,
    );
    expect(failure).toBeInstanceOf(LocalLibraryArchiveEntryMismatchError);
    expect(failure).toMatchObject({ path: archivePath });
  });

  it('rejects an archive whose zipSync output exceeds the output cap', async () => {
    // 输入预算不等于输出文件大小：ZIP 的 local header / central directory / EOCD 都是开销。
    // 只断言输入预算时，一个条目极多、载荷极小的库可以悄悄产出超长归档。
    const { manifest, entries } = await createLibrary();
    const read = readFrom(entries);
    const withinInput = await packLocalLibraryArchive(manifest, read);
    expect(withinInput.bytes.byteLength).toBeGreaterThan(0);

    await expect(packLocalLibraryArchive(manifest, read, {
      maxOutputBytes: withinInput.bytes.byteLength - 1,
    })).rejects.toMatchObject({
      code: LOCAL_LIBRARY_ARCHIVE_TOO_LARGE_CODE,
      dimension: 'output',
      actualBytes: withinInput.bytes.byteLength,
      limitBytes: withinInput.bytes.byteLength - 1,
    });
  });

it('the output cap is a separate constant even though both are 256 MiB today', () => {
    expect(MAX_LOCAL_LIBRARY_ARCHIVE_OUTPUT_BYTES).toBe(256 * 1024 * 1024);
    expect(MAX_LOCAL_LIBRARY_ARCHIVE_OUTPUT_BYTES).toBeGreaterThan(0);
  });

it('defaults to the documented archive input cap', async () => {
    // 上限是 DESK-070 的可诊断承诺；它由实测推导，改动需重跑实测脚本。
    expect(MAX_LOCAL_LIBRARY_ARCHIVE_INPUT_BYTES).toBe(256 * 1024 * 1024);
    expect(MAX_LOCAL_LIBRARY_ARCHIVE_INPUT_BYTES).toBeGreaterThan(64 * 1024 * 1024);
  });
});
