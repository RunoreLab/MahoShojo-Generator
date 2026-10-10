import { MAX_DESKTOP_LOCAL_PACKAGE_ARCHIVE_BYTES } from '@mahoshojo/contracts/desktop-ipc';
import { WebPackageRefSchema, type WebPackageRef } from '@mahoshojo/contracts/web-package';
import { nextLocalTimestamp } from '@mahoshojo/local-library/record';
import { deriveLocalWebPackageId, LocalWebPackageRecordV1Schema, type LocalWebPackageRecordV1, type WebPackageRepository } from '@mahoshojo/local-library/web-package-record';
import {
  BUILTIN_WEB_PACKAGE_PRESETS, builtinWebPackageSource, findBuiltinWebPackagePreset,
  importWebPackageArchive, packWebPackageZip, unpackWebPackageZip, WebPackageImportError,
  type ResolvedWebPackage,
} from '@mahoshojo/web-package';

const sameRef = (left: WebPackageRef, right: WebPackageRef) => left.id === right.id && left.version === right.version && left.digest === right.digest;
type ImportedPackage = { base: ResolvedWebPackage; archive: Uint8Array; persisted: boolean };
export interface ArenaWebPackageLibraryState {
  records: readonly LocalWebPackageRecordV1[];
  temporary: readonly { ref: WebPackageRef; title: string; byteLength: number }[];
  busy: boolean;
  loaded: boolean;
  error: string | null;
  diagnostics: readonly string[];
  revision: number;
}
export type ArenaWebPackageImportResult = { ref: WebPackageRef; saved: boolean } | { cancelled: true } | { failed: true };
export const canPersistArenaWebPackageArchive = (byteLength: number): boolean => Number.isSafeInteger(byteLength) && byteLength >= 0 && byteLength <= MAX_DESKTOP_LOCAL_PACKAGE_ARCHIVE_BYTES;
export type ArenaWebPackageRepository = Omit<WebPackageRepository, 'delete' | 'restore'> & {
  delete(id: string, isCurrent?: () => boolean): Promise<void>;
  restore(id: string, isCurrent?: () => boolean): Promise<void>;
};
export type ArenaPackageWriter = (record: LocalWebPackageRecordV1, archive: Uint8Array) => Promise<{ repaired?: boolean } | void>;

/** Main-UI local I/O only. No renderer, global package staging, provider or new persistence store. */
export class DesktopArenaWebPackages {
  private state: ArenaWebPackageLibraryState = { records: [], temporary: [], busy: false, loaded: false, error: null, diagnostics: [], revision: 0 };
  private readonly imported = new Map<string, ImportedPackage>();
  private readonly listeners = new Set<() => void>();
  private epoch = 0;
  private scope = '';
  private disposed = false;
  private locked = false;
  private reloadPending = false;
  constructor(private readonly dependencies: {
    repository: ArenaWebPackageRepository;
    write?: ArenaPackageWriter;
    now?: () => string;
    confirmRestore: (title: string) => boolean | Promise<boolean>;
  }) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  isBusy = () => this.locked;
  /** Capture at the host effect boundary; an awaited result cannot select or download in a newer scope. */
  captureScope = () => { const epoch = this.epoch; return () => this.current(epoch); };
  setScope(scope: string) {
    if (scope === this.scope) return;
    this.scope = scope; this.epoch += 1;
    this.publish({ error: null, diagnostics: [] });
  }
  dispose() { this.disposed = true; this.epoch += 1; this.listeners.clear(); this.imported.clear(); }
  private current(epoch: number) { return !this.disposed && epoch === this.epoch; }
  private publish(patch: Partial<ArenaWebPackageLibraryState>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  private changed(patch: Partial<ArenaWebPackageLibraryState> = {}) {
    this.publish({ ...patch, revision: this.state.revision + 1,
      temporary: [...this.imported.values()].filter((item) => !item.persisted).map(({ base, archive }) => ({ ref: base.ref, title: base.manifest.name, byteLength: archive.byteLength })) });
  }
  private async records() {
    const records: LocalWebPackageRecordV1[] = [], cursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await this.dependencies.repository.list({ limit: 100, ...(cursor ? { cursor } : {}) });
      records.push(...page.items.filter((record) => record.deletedAt === undefined));
      cursor = page.nextCursor;
      if (cursor && cursors.has(cursor)) throw new Error('本地 Web 包列表游标重复，已停止读取。');
      if (cursor) cursors.add(cursor);
    } while (cursor);
    return records;
  }
  private async operation<T>(action: (epoch: number) => Promise<T>): Promise<T | null> {
    if (this.disposed || this.locked) return null;
    this.locked = true;
    const epoch = this.epoch;
    this.publish({ busy: true, error: null, diagnostics: [] });
    try { return await action(epoch); }
    catch (error) {
      if (this.current(epoch)) this.publish({ error: error instanceof WebPackageImportError ? `${error.message} ${error.hint}` : error instanceof Error ? error.message : '本地 Web 包操作失败。' });
      return null;
    } finally {
      this.locked = false;
      // This only unlocks the host operation; it never reports an old-scope write as successful.
      this.publish({ busy: false });
      if (this.reloadPending && !this.disposed) { this.reloadPending = false; void this.reload(); }
    }
  }
  async reload(): Promise<void> {
    if (this.locked) { this.reloadPending = true; return; }
    await this.operation(async (epoch) => {
      const records = await this.records();
      if (this.current(epoch)) this.changed({ records, loaded: true });
    });
  }
  async importFile(file: Pick<File, 'arrayBuffer'>, saveToLibrary: boolean): Promise<ArenaWebPackageImportResult> {
    const result = await this.operation(async (epoch): Promise<ArenaWebPackageImportResult> => {
      const archive = new Uint8Array(await file.arrayBuffer());
      if (!this.current(epoch)) return { cancelled: true };
      const { pkg: base, diagnostics } = await importWebPackageArchive(archive);
      if (!this.current(epoch)) return { cancelled: true };
      const item: ImportedPackage = { base, archive, persisted: false };
      this.imported.set(base.ref.digest, item);
      this.changed({ diagnostics });
      if (!saveToLibrary) return { ref: base.ref, saved: false };
      try {
        const saved = await this.saveImported(item, epoch);
        if (!this.current(epoch)) return { cancelled: true };
        if (!saved) return { ref: base.ref, saved: false };
        item.persisted = true;
        this.changed({ records: [...this.state.records.filter((record) => record.id !== saved.id), saved], diagnostics: [...this.state.diagnostics, '已保存到本地 Web 包库。'] });
        try {
          const records = await this.records();
          if (!this.current(epoch)) return { cancelled: true };
          this.changed({ records, loaded: true });
        } catch {
          if (!this.current(epoch)) return { cancelled: true };
          this.publish({ error: 'Web 包已保存，但列表刷新失败；请重读本地库，无需重复保存。' });
        }
        return { ref: base.ref, saved: true };
      } catch (error) {
        if (!this.current(epoch)) return { cancelled: true };
        this.changed({ error: `Web 包已导入，但保存失败：${error instanceof Error ? error.message : '未知错误'}。原包保留在当前页面，可导出。` });
        return { ref: base.ref, saved: false };
      }
    });
    return result ?? (this.state.error ? { failed: true } : { cancelled: true });
  }
  private async saveImported(item: ImportedPackage, epoch: number): Promise<LocalWebPackageRecordV1 | null> {
    if (!canPersistArenaWebPackageArchive(item.archive.byteLength)) throw new Error('原 ZIP 超过本地包库 64 MiB 上限');
    const { base, archive } = item, id = deriveLocalWebPackageId(base.ref.digest);
    const existing = await this.dependencies.repository.get(id);
    if (!this.current(epoch)) return null;
    if (existing?.deletedAt !== undefined) {
      const allowed = await this.dependencies.confirmRestore(existing.title);
      if (!this.current(epoch) || !allowed) return null;
      await this.dependencies.repository.restore(id, () => this.current(epoch));
      if (!this.current(epoch)) return null;
    }
    const now = this.dependencies.now?.() ?? new Date().toISOString();
    const timestamp = existing ? nextLocalTimestamp(existing.deletedAt ?? existing.updatedAt, () => Date.parse(now)) : now;
    const record = LocalWebPackageRecordV1Schema.parse({ id, schemaVersion: 1, storageLocation: 'local', entityKind: 'web-package',
      title: base.manifest.name, summary: `${base.ref.id}@${base.ref.version}`, ref: base.ref, manifest: base.manifest,
      contentDigest: base.ref.digest, archiveByteLength: archive.byteLength, provenance: { kind: 'unsigned', execution: 'imported' },
      createdAt: existing?.createdAt ?? timestamp, updatedAt: timestamp });
    if (!this.current(epoch)) return null;
    const outcome = await (this.dependencies.write ? this.dependencies.write(record, archive) : this.dependencies.repository.put(record, archive));
    if (!this.current(epoch)) return null;
    if (outcome?.repaired) this.publish({ diagnostics: [...this.state.diagnostics, '已修复本地包归档字节；建议在设置中检查本地库完整性。'] });
    return record;
  }
  async remove(ref: WebPackageRef): Promise<boolean> {
    return (await this.operation(async (epoch) => {
      // The controlled picker owns the explicit deletion confirmation.
      await this.dependencies.repository.delete(deriveLocalWebPackageId(WebPackageRefSchema.parse(ref).digest), () => this.current(epoch));
      if (!this.current(epoch)) return false;
      this.imported.delete(ref.digest);
      this.changed({ records: this.state.records.filter((record) => record.ref.digest !== ref.digest) });
      try {
        const records = await this.records();
        if (!this.current(epoch)) return false;
        this.changed({ records, loaded: true });
      } catch {
        if (!this.current(epoch)) return false;
        this.publish({ error: 'Web 包已删除，但列表刷新失败；请重读本地库，无需重复删除。' });
      }
      return true;
    })) ?? false;
  }
  /** Always re-check persistent records; a previous resolution must not mask a tombstone. */
  resolveExact = async (input: WebPackageRef): Promise<ResolvedWebPackage> => {
    const ref = WebPackageRefSchema.parse(input), temporary = this.imported.get(ref.digest);
    if (temporary && !temporary.persisted && sameRef(temporary.base.ref, ref)) return temporary.base;
    // Bundled bytes do not depend on SQLite availability. A local archive with the same exact identity
    // cannot grant more authority or alter the verified runtime bytes.
    if (findBuiltinWebPackagePreset(ref)) return builtinWebPackageSource.resolve(ref);
    const record = await this.dependencies.repository.get(deriveLocalWebPackageId(ref.digest));
    if (record && record.deletedAt === undefined && sameRef(record.ref, ref)) {
      const archive = await this.dependencies.repository.readArchive(ref.digest);
      if (!archive) throw new Error('本地 Web 包记录存在，但原 ZIP 缺失。');
      const base = await unpackWebPackageZip(archive);
      if (!sameRef(base.ref, ref)) throw new Error('本地 Web 包字节与记录的精确版本不一致。');
      return base;
    }
    throw new Error('此 Web 包的精确版本不可用，请重新导入原 ZIP。');
  };
  findCandidatesById = async (id: string): Promise<ResolvedWebPackage[]> => {
    const refs = [...BUILTIN_WEB_PACKAGE_PRESETS.map((item) => item.packageRef), ...(await this.records()).map((item) => item.ref),
      ...[...this.imported.values()].filter((item) => !item.persisted).map((item) => item.base.ref)];
    const seen = new Set<string>(), candidates: ResolvedWebPackage[] = [];
    for (const ref of refs) {
      if (ref.id !== id || seen.has(ref.digest)) continue;
      seen.add(ref.digest);
      try { candidates.push(await this.resolveExact(ref)); } catch { /* A corrupt candidate is not a compatible revision. */ }
    }
    return candidates;
  };
  async exportBase(ref: WebPackageRef, original: boolean): Promise<Uint8Array | null> {
    return this.operation(async (epoch) => {
      const base = await this.resolveExact(ref);
      if (!this.current(epoch)) return null;
      let bytes: Uint8Array | null;
      if (original) bytes = this.imported.get(ref.digest)?.archive ?? await this.dependencies.repository.readArchive(ref.digest);
      else bytes = await packWebPackageZip(base);
      if (!this.current(epoch)) return null;
      if (!bytes) throw new Error('没有可导出的原 ZIP；可导出规范 Base 包。');
      return bytes.slice();
    });
  }
}
