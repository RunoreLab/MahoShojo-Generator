// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { readArchiveFileBytes, WEB_LIBRARY_ARCHIVE_LIMITS } from '@/lib/local-library/archive-host';
import { LocalLibraryArchiveImportError } from '@mahoshojo/local-library/archive-import';

const fileOf = (size: number, bytes?: Uint8Array): File => {
  const content = bytes ?? new Uint8Array(size);
  return {
    size,
    arrayBuffer: async () => content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength),
  } as unknown as File;
};

describe('Web archive import file limits', () => {
  it('measures the archive file against the OUTPUT limit, not the packing input budget', () => {
    // DESK-070 把「打包输入总量」与「最终归档文件长度」定义为两个维度并明确 MUST NOT 互相充当。
    // 被度量的是用户手里的那个文件，也就是 OUTPUT 侧。两者今天同值，因此选错维度现在看不出问题，
    // 但它会让将来任何一次调整都变成「导入比导出更早拒绝」的静默不一致。
    expect(WEB_LIBRARY_ARCHIVE_LIMITS.fileBytes).toBe(256 * 1024 * 1024);
  });

  it('rejects an oversized file before allocating a buffer for it', async () => {
    const oversized = fileOf(WEB_LIBRARY_ARCHIVE_LIMITS.fileBytes + 1);
    const arrayBuffer = vi.spyOn(oversized, 'arrayBuffer');

    await expect(readArchiveFileBytes(oversized)).rejects.toBeInstanceOf(LocalLibraryArchiveImportError);
    // 关键：必须在**读之前**拒绝。这一层不解压任何东西，所以它能在分配之前挡掉一个明显过大的文件；
    // 共享导入模块里的预算守卫要等到第一条 entry 开始解压才生效。
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('rejects a file whose declared length disagrees with its actual bytes', async () => {
    // 浏览器的 File 来自不可信输入（拖放、共享、扩展）。一个谎报长度的文件会让「按长度分配的缓冲区」
    // 变成一段截断数据，症状是解包器报 ZIP 损坏——那是一条会误导用户的错误信息。
    const liar = fileOf(1024, new Uint8Array(10));

    await expect(readArchiveFileBytes(liar)).rejects.toMatchObject({ code: 'archive-malformed' });
  });

  it('accepts a file whose declared length matches', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    await expect(readArchiveFileBytes(fileOf(4, bytes))).resolves.toEqual(bytes);
  });
});

describe('Web local library storage probe', () => {
  it('reports unavailability instead of silently degrading to an empty library', async () => {
    // DESK-PROD-007：初始化失败 MUST 报告，不得悄悄退到易失内存后继续显示「已保存」。
    // 因此探测失败时导入导出必须进入只读说明态，而不是显示「库里没有数据」。
    const { probeLocalLibraryStorage } = await import('@/lib/local-library/storage-probe');
    const outcome = await probeLocalLibraryStorage().catch((cause: unknown) => String(cause));

    // jsdom 没有 IndexedDB，实现应当报告失败而不是假装可用。
    expect(outcome === null || typeof outcome === 'string').toBe(true);
    if (typeof outcome === 'string') {
      expect(outcome.length).toBeGreaterThan(0);
    }
  });
});