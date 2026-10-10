import { describe, expect, it, vi } from 'vitest';
import { deriveLocalWebPackageId, type LocalWebPackageRecordV1, type WebPackageRepository } from '@mahoshojo/local-library/web-package-record';
import { BUILTIN_WEB_PACKAGE_PRESETS, digestWebPackageBytes, getStagedLocalWebPackage, packWebPackageZip, verifyWebPackage } from '@mahoshojo/web-package';
import { canPersistArenaWebPackageArchive, DesktopArenaWebPackages } from '../src/features/arena/web-packages';

const now = '2026-10-10T00:00:00.000Z';
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; };
const fixture = async () => {
  const bytes = new TextEncoder().encode('<!doctype html><html><body>Base<script>window.noHost = true;</script></body></html>');
  const base = await verifyWebPackage({ format: 'mahoshojo-web-package', formatVersion: 1, id: 'local.desktop-test', version: '1.0.0', name: '测试包', entry: 'index.html',
    generation: { target: 'index.html', mode: 'replace', mediaType: 'text/html' }, capabilities: [], files: [{ path: 'index.html', mediaType: 'text/html', digest: await digestWebPackageBytes(bytes), size: bytes.byteLength }] }, [{ path: 'index.html', bytes }]);
  const archive = await packWebPackageZip(base);
  return { base, archive, file: { arrayBuffer: async () => archive.slice().buffer } };
};
const repository = () => {
  const records = new Map<string, LocalWebPackageRecordV1>(), archives = new Map<string, Uint8Array>();
  const repo = {
    get: vi.fn(async (id: string) => records.get(id) ?? null),
    list: vi.fn(async () => ({ items: [...records.values()].filter((record) => !record.deletedAt) })),
    readArchive: vi.fn(async (digest: string) => archives.get(digest)?.slice() ?? null),
    put: vi.fn(async (record: LocalWebPackageRecordV1, archive: Uint8Array) => { records.set(record.id, structuredClone(record)); archives.set(record.ref.digest, archive.slice()); }),
    putIfAbsent: vi.fn(async (record: LocalWebPackageRecordV1, archive: Uint8Array) => {
      if (records.has(record.id)) return { alreadyPresent: true as const };
      records.set(record.id, structuredClone(record)); archives.set(record.ref.digest, archive.slice()); return { written: true as const };
    }),
    delete: vi.fn(async (id: string) => { const record = records.get(id); if (record) records.set(id, { ...record, deletedAt: now }); }),
    restore: vi.fn(async (id: string) => { const record = records.get(id); if (record) { const copy = { ...record }; delete copy.deletedAt; records.set(id, copy); } }),
    purge: vi.fn(async (id: string) => { records.delete(id); }),
  } satisfies WebPackageRepository;
  return { repo, records, archives };
};
const host = (repo: WebPackageRepository, confirmRestore: () => boolean | Promise<boolean> = () => true) => {
  const store = new DesktopArenaWebPackages({ repository: repo, confirmRestore, now: () => now }); store.setScope('one'); return store;
};

describe('Arena main-UI Web package library', () => {
  it('lets consumer effects recheck their original scope after an awaited controller result', () => {
    const { repo } = repository(), store = host(repo), original = store.captureScope(); expect(original()).toBe(true);
    store.setScope('other'); expect(original()).toBe(false); const replacement = store.captureScope(); expect(replacement()).toBe(true);
    store.dispose(); expect(replacement()).toBe(false);
  });
  it('keeps canonical import repair guidance visible on an invalid ZIP', async () => {
    const { repo } = repository(), store = host(repo);
    expect(await store.importFile({ arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }, false)).toEqual({ failed: true });
    expect(store.getSnapshot().error).toContain('请确认选择的是 Web 包 ZIP'); expect(repo.put).not.toHaveBeenCalled();
  });
  it('imports into this host only by default, preserves raw ZIP and never runs or globally stages scripts', async () => {
    const { repo } = repository(), store = host(repo), { file, archive, base } = await fixture();
    expect(await store.importFile(file, false)).toEqual({ ref: base.ref, saved: false });
    expect(repo.put).not.toHaveBeenCalled(); expect(store.getSnapshot().temporary).toHaveLength(1);
    expect(getStagedLocalWebPackage(base.ref)).toBeUndefined();
    expect(await store.exportBase(base.ref, true)).toEqual(archive);
    expect((await store.resolveExact(base.ref)).readFile('index.html')).toEqual(base.readFile('index.html'));
    expect(await store.findCandidatesById(base.ref.id)).toHaveLength(1);
  });
  it('resolves bundled presets without depending on local-library availability', async () => {
    const { repo } = repository(), store = host(repo), ref = BUILTIN_WEB_PACKAGE_PRESETS[0]!.packageRef;
    repo.get.mockRejectedValue(new Error('数据库不可用'));
    expect((await store.resolveExact(ref)).ref).toEqual(ref); expect(repo.get).not.toHaveBeenCalled();
  });
  it('saves explicit imports, reopens exact bytes and keeps single-package reimport distinct from insert-if-absent', async () => {
    const { repo, records } = repository(), store = host(repo), { file, base } = await fixture();
    expect(await store.importFile(file, true)).toEqual({ ref: base.ref, saved: true });
    expect(repo.put).toHaveBeenCalledTimes(1); expect(repo.putIfAbsent).not.toHaveBeenCalled();
    expect(store.getSnapshot().temporary).toEqual([]);
    const reopened = host(repo); expect((await reopened.resolveExact(base.ref)).ref).toEqual(base.ref);
    await store.importFile(file, true); expect(records.size).toBe(1); expect(repo.put).toHaveBeenCalledTimes(2);
    await reopened.reload(); expect(reopened.getSnapshot().records).toHaveLength(1);
    expect(await reopened.remove(base.ref)).toBe(true);
    await expect(reopened.resolveExact(base.ref)).rejects.toThrow('精确版本不可用');
    await expect(store.resolveExact(base.ref)).rejects.toThrow('精确版本不可用');
    expect(repo.purge).not.toHaveBeenCalled();
  });
  it('requires explicit restoration and cannot restore after the scope changed during confirmation', async () => {
    const { repo } = repository(), { file, base } = await fixture(), initial = host(repo);
    await initial.importFile(file, true); await initial.remove(base.ref);
    const confirm = deferred<boolean>(), store = host(repo, () => confirm.promise);
    const imported = store.importFile(file, true);
    await vi.waitFor(() => expect(store.getSnapshot().temporary).toHaveLength(1));
    store.setScope('two'); confirm.resolve(true);
    expect(await imported).toEqual({ cancelled: true }); expect(repo.restore).not.toHaveBeenCalled(); expect(repo.put).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().error).toBeNull();
    const approved = host(repo); expect(await approved.importFile(file, true)).toEqual({ ref: base.ref, saved: true }); expect(repo.restore).toHaveBeenCalledOnce();
  });
  it('retains a freshly imported package when library save fails and makes failure distinct from import success', async () => {
    const { repo } = repository(), store = host(repo), { file, archive, base } = await fixture();
    repo.put.mockRejectedValueOnce(new Error('磁盘已满'));
    expect(await store.importFile(file, true)).toEqual({ ref: base.ref, saved: false });
    expect(store.getSnapshot().error).toContain('保存失败'); expect(store.getSnapshot().error).toContain('磁盘已满');
    expect(await store.exportBase(base.ref, true)).toEqual(archive);
    expect((await store.resolveExact(base.ref)).ref).toEqual(base.ref);
  });
  it('rejects a mismatched stored archive, instead of accepting a matching library row alone', async () => {
    const { repo, archives } = repository(), store = host(repo), { file, base } = await fixture();
    await store.importFile(file, true); archives.set(base.ref.digest, new Uint8Array([1, 2, 3]));
    await expect(store.resolveExact(base.ref)).rejects.toThrow();
    expect(await store.findCandidatesById(base.ref.id)).toEqual([]);
  });
  it('holds the synchronous lock through file reads and drops late import before parsing or writing', async () => {
    const { repo } = repository(), store = host(repo), { archive } = await fixture(), read = deferred<ArrayBuffer>();
    const pending = store.importFile({ arrayBuffer: () => read.promise }, true);
    expect(store.isBusy()).toBe(true);
    const second = { arrayBuffer: vi.fn(async () => archive.slice().buffer) };
    expect(await store.importFile(second, true)).toEqual({ cancelled: true }); expect(second.arrayBuffer).not.toHaveBeenCalled();
    store.setScope('two'); read.resolve(archive.slice().buffer);
    expect(await pending).toEqual({ cancelled: true }); expect(repo.put).not.toHaveBeenCalled(); expect(store.getSnapshot().temporary).toHaveLength(0); expect(store.isBusy()).toBe(false);
  });
  it('checks the owner after an existing-record read and does not dispatch an old write', async () => {
    const { repo } = repository(), store = host(repo), { file } = await fixture(), read = deferred<LocalWebPackageRecordV1 | null>();
    repo.get.mockImplementationOnce(() => read.promise);
    const pending = store.importFile(file, true); await vi.waitFor(() => expect(repo.get).toHaveBeenCalled());
    store.setScope('two'); read.resolve(null);
    expect(await pending).toEqual({ cancelled: true }); expect(repo.put).not.toHaveBeenCalled(); expect(store.getSnapshot().error).toBeNull();
  });
  it('does not publish an old-scope write receipt as a new-scope successful save', async () => {
    const { repo } = repository(), store = host(repo), { file } = await fixture(), write = deferred<void>();
    repo.put.mockImplementationOnce(() => write.promise);
    const pending = store.importFile(file, true); await vi.waitFor(() => expect(repo.put).toHaveBeenCalled());
    store.setScope('two'); write.resolve(); expect(await pending).toEqual({ cancelled: true });
    expect(store.getSnapshot().diagnostics).toEqual([]); expect(store.getSnapshot().error).toBeNull(); expect(store.getSnapshot().busy).toBe(false);
  });
  it('uses the distinct 64 MiB archive envelope, without lowering the import/output budgets', () => {
    expect(canPersistArenaWebPackageArchive(64 * 1024 * 1024)).toBe(true);
    expect(canPersistArenaWebPackageArchive(64 * 1024 * 1024 + 1)).toBe(false);
    expect(canPersistArenaWebPackageArchive(-1)).toBe(false);
  });
  it('keeps successful save/delete distinct from a later list refresh failure', async () => {
    const { repo } = repository(), store = host(repo), { file, base } = await fixture();
    repo.list.mockRejectedValueOnce(new Error('刷新失败'));
    expect(await store.importFile(file, true)).toEqual({ ref: base.ref, saved: true });
    expect(store.getSnapshot().error).toContain('已保存，但列表刷新失败');
    expect(store.getSnapshot().records).toHaveLength(1); expect(store.getSnapshot().temporary).toHaveLength(0);
    repo.list.mockRejectedValueOnce(new Error('刷新失败'));
    expect(await store.remove(base.ref)).toBe(true);
    expect(store.getSnapshot().error).toContain('已删除，但列表刷新失败');
    expect(store.getSnapshot().records).toHaveLength(0); expect(repo.put).toHaveBeenCalledOnce(); expect(repo.delete).toHaveBeenCalledOnce();
  });
  it('replays only a pending read after scope change, without losing a refresh while another operation owns the lock', async () => {
    const { repo } = repository(), store = host(repo), { archive } = await fixture(), read = deferred<ArrayBuffer>();
    const pending = store.importFile({ arrayBuffer: () => read.promise }, false);
    store.setScope('two'); await store.reload(); read.resolve(archive.slice().buffer); await pending;
    await vi.waitFor(() => expect(store.getSnapshot().loaded).toBe(true));
    expect(repo.put).not.toHaveBeenCalled(); expect(store.getSnapshot().temporary).toHaveLength(0);
  });
  it('surfaces blob repair diagnostics instead of reporting only successful persistence', async () => {
    const { repo } = repository(), { file } = await fixture();
    const store = new DesktopArenaWebPackages({ repository: repo, confirmRestore: () => true, now: () => now,
      write: async (record, bytes) => { await repo.put(record, bytes); return { repaired: true }; } });
    store.setScope('one'); await store.importFile(file, true);
    expect(store.getSnapshot().diagnostics.join(' ')).toContain('完整性');
    expect(store.getSnapshot().records[0]?.id).toBe(deriveLocalWebPackageId(store.getSnapshot().records[0]!.ref.digest));
  });
});
