'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import type { WebPackageRef } from '@mahoshojo/contracts/web-package';
import {
  BUILTIN_WEB_PACKAGE_PRESETS,
  isBuiltinWebPackageRef,
  listStagedLocalWebPackages,
  packWebPackageZip,
  WebPackageImportError,
} from '@mahoshojo/web-package';

import { useBattleStore } from '../../../stores/useBattleStore';
import type { BattleStoreState } from '../../../types';
import {
  drainWebPackageArchiveCache,
  importLocalWebPackageArchive,
  readAllWebPackageArchiveCache,
} from '@/lib/web-package/cache';
import { downloadBlob } from '@/lib/client/blobUrl';
import { buildSafeFileName } from '@/lib/client/fileName';
import { useLocalLibraryPreferences } from '@/lib/local-library/preferences';
import { getLocalWebPackageRepository } from '@/lib/local-library/web-package-repository';
import {
  hasCompletedLegacyWebPackageMigration,
  hydrateWebPackageSessionFromLibrary,
  markLegacyWebPackageMigrationCompleted,
  migrateLegacyWebPackageCache,
  readWebPackageFromLibrary,
  saveWebPackageToLibrary,
} from '@/lib/local-library/web-package-library';
import { removeLocalWebPackage } from '@/lib/local-library/remove-local-web-package';
import { useLocalWebPackages } from '@/lib/local-library/use-local-web-packages';
import { useWebPackagePresetDownload } from './useWebPackagePresetDownload';

import type {
  ArenaWebPackageImportFeedback,
  ArenaWebPackageOptionView,
  ArenaWebPackageSectionModel,
} from './web-package-contract';

const builtinOptions = (): readonly ArenaWebPackageOptionView[] =>
  BUILTIN_WEB_PACKAGE_PRESETS.map((preset) => ({
    digest: preset.packageRef.digest,
    title: preset.title,
    kind: 'builtin' as const,
    ref: preset.packageRef,
    summary: preset.description,
  }));

const resolveSelected = (
  ref: WebPackageRef | null | undefined,
  options: readonly ArenaWebPackageOptionView[],
): ArenaWebPackageOptionView | null => {
  if (!ref) return null;
  const match = options.find((option) => option.digest === ref.digest);
  if (match) return match;
  return {
    digest: ref.digest,
    title: `${ref.id}@${ref.version}`,
    kind: isBuiltinWebPackageRef(ref) ? 'builtin' : 'unknown',
    ref,
    summary: '不可用的 Web 包（请重新选择）',
  };
};

/**
 * 单人 Web 包区块 adapter：battle store + 本地库。
 *
 * 本地 ZIP 的持久化从"旧缓存"迁到本地库（ADR-local-library-data-ownership §4）：
 * 用户勾选「导入时保存到本地库」才落盘，不再无条件 best-effort 写一份用户删不掉的缓存。
 */
export const useSoloWebPackageSectionModel = (input: {
  reportFormat: 'markdown' | 'web';
  disabled?: boolean;
  allowLocalImport?: boolean;
}): ArenaWebPackageSectionModel => {
  const { reportFormat, disabled = false, allowLocalImport = true } = input;
  const webPackageRef = useBattleStore((state: BattleStoreState) => state.webPackageRef);
  const setWebPackageRef = useBattleStore((state: BattleStoreState) => state.setWebPackageRef);
  const isGenerating = useBattleStore((state: BattleStoreState) => state.isGenerating);

  const [importing, setImporting] = useState(false);
  /** staging 是进程内状态，只能靠显式 bump 让 UI 重新读取。 */
  const [stagedTick, setStagedTick] = useState(0);
  const [importFeedback, setImportFeedback] = useState<ArenaWebPackageImportFeedback | null>(null);
  const [busyDigest, setBusyDigest] = useState<string | null>(null);
  const [missingArchives, setMissingArchives] = useState<ReadonlySet<string>>(new Set());
  const { preferences, setPreference } = useLocalLibraryPreferences();
  const localLibrary = useLocalWebPackages(allowLocalImport);
  const { downloading, downloadError, downloadPreset } = useWebPackagePresetDownload();

  useEffect(() => {
    let active = true;
    void (async () => {
      // 一次性把旧缓存搬进本地库。读不到旧库时迁移返回 drained=false，
      // 此时不得标记完成——下次挂载还要再试，否则用户会同时失去旧数据和迁移机会。
      if (!(await hasCompletedLegacyWebPackageMigration())) {
        const outcome = await migrateLegacyWebPackageCache(
          readAllWebPackageArchiveCache,
          drainWebPackageArchiveCache,
        );
        if (outcome.drained) await markLegacyWebPackageMigrationCompleted();
      }
      await hydrateWebPackageSessionFromLibrary();
      if (!active) return;
      setStagedTick((tick) => tick + 1);
      localLibrary.reload();
    })();
    return () => { active = false; };
    // 迁移与水合各只应发生一次；localLibrary 引用会每次渲染变化，不能进依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const presets = useMemo(() => builtinOptions(), []);

  // 记录在但 ZIP 字节不在时必须点名：否则用户点下去才发现这个包用不了。
  useEffect(() => {
    if (!allowLocalImport) return;
    let active = true;
    void (async () => {
      const repository = getLocalWebPackageRepository();
      const stored = await repository.listArchiveDigests();
      if (!active) return;
      setMissingArchives(new Set(localLibrary.records
        .filter((record) => !stored.has(record.ref.digest))
        .map((record) => record.ref.digest)));
    })();
    return () => { active = false; };
  }, [allowLocalImport, localLibrary.records]);

  const library = useMemo<ArenaWebPackageOptionView[]>(() => {
    void stagedTick;
    const options: ArenaWebPackageOptionView[] = localLibrary.records.map((record) => ({
      digest: record.ref.digest,
      title: record.title,
      kind: 'local' as const,
      ref: record.ref,
      summary: record.summary,
      byteLength: record.archiveByteLength,
      broken: missingArchives.has(record.ref.digest),
    }));
    const known = new Set(options.map((option) => option.digest));
    // 导入默认不落盘。还没写进本地库的 staged 包同样要能选中，否则用户刚导入完
    // 就会看到「不可用的 Web 包（请重新选择）」。
    for (const staged of listStagedLocalWebPackages()) {
      if (known.has(staged.ref.digest)) continue;
      known.add(staged.ref.digest);
      options.push({
        digest: staged.ref.digest,
        title: staged.manifest.name,
        kind: 'local',
        ref: staged.ref,
        summary: `${staged.ref.id}@${staged.ref.version}`,
        sessionOnly: true,
      });
    }
    return options;
  }, [localLibrary.records, missingArchives, stagedTick]);

  const allOptions = useMemo(() => [...presets, ...library], [presets, library]);

  const selected = allowLocalImport
    ? resolveSelected(webPackageRef, allOptions)
    : webPackageRef && isBuiltinWebPackageRef(webPackageRef)
      ? resolveSelected(webPackageRef, allOptions)
      : null;

  const refByDigest = useCallback(
    (digest: string): WebPackageRef | null => allOptions.find((option) => option.digest === digest)?.ref ?? null,
    [allOptions],
  );

  const select = useCallback((digest: string | null) => {
    setImportFeedback(null);
    if (!digest) {
      setWebPackageRef(null);
      return;
    }
    const builtin = BUILTIN_WEB_PACKAGE_PRESETS.find((item) => item.packageRef.digest === digest);
    if (builtin) {
      setWebPackageRef(builtin.packageRef);
      return;
    }
    if (!allowLocalImport) {
      setImportFeedback({ message: '多人模式仅支持内置 Web 包预设', hint: '', diagnostics: [] });
      return;
    }
    // 只用 digest 拼出来的 ref 无法被任何解析路径接受；必须回填库记录里的真实身份。
    const ref = refByDigest(digest);
    if (ref) setWebPackageRef(ref);
  }, [allowLocalImport, setWebPackageRef, refByDigest]);

  const remove = useCallback(() => {
    setWebPackageRef(null);
  }, [setWebPackageRef]);

  const importFile = useCallback(async (file: File | null | undefined) => {
    if (!file || importing) return;
    setImporting(true);
    setImportFeedback(null);
    try {
      const archive = new Uint8Array(await file.arrayBuffer());
      const { pkg, diagnostics } = await importLocalWebPackageArchive(archive);
      const notes = [...diagnostics];
      if (preferences.saveImportedWebPackages) {
        const { updated } = await saveWebPackageToLibrary({ pkg, archive });
        notes.push(updated ? '本地库中已有同一份 Web 包，已更新原记录。' : '已保存到本地库。');
        localLibrary.reload();
      }
      setWebPackageRef(pkg.ref);
      setStagedTick((tick) => tick + 1);
      setImportFeedback({ message: '', hint: '', diagnostics: notes });
    } catch (error) {
      setImportFeedback({
        message: error instanceof Error ? error.message : 'Web 包导入失败',
        hint: error instanceof WebPackageImportError ? error.hint : '请确认选择的是有效的 Web 包 ZIP 后重试。',
        diagnostics: [],
      });
    } finally {
      setImporting(false);
    }
  }, [importing, preferences.saveImportedWebPackages, setWebPackageRef, localLibrary]);

  const downloadFromLibrary = useCallback(async (digest: string) => {
    const record = localLibrary.records.find((item) => item.ref.digest === digest);
    if (!record) return;
    setBusyDigest(digest);
    try {
      const pkg = await readWebPackageFromLibrary(record);
      if (!pkg) {
        setImportFeedback({
          message: '本地库中的这个 Web 包已找不到 ZIP 字节。',
          hint: '请删除后重新导入。',
          diagnostics: [],
        });
        return;
      }
      const archive = await packWebPackageZip(pkg);
      downloadBlob(
        new Blob([archive.slice().buffer as ArrayBuffer], { type: 'application/zip' }),
        buildSafeFileName(`${record.ref.id}@${record.ref.version}`, 'zip', 'mahoshojo-web-package'),
      );
    } finally {
      setBusyDigest(null);
    }
  }, [localLibrary.records]);

  const removeFromLibrary = useCallback(async (digest: string): Promise<void> => {
    const record = localLibrary.records.find((item) => item.ref.digest === digest);
    if (!record) return;
    setBusyDigest(digest);
    setImportFeedback(null);
    try {
      const outcome = await removeLocalWebPackage(record, {
        activeRefDigest: webPackageRef?.digest ?? null,
        clearSelection: () => setWebPackageRef(null),
      });
      if (!outcome.clearedTrustGrant) {
        // 库记录已删，但浏览器拒绝了 localStorage 删除：同源授权可能仍在。
        // 不说清楚的话，用户重新导入同一份字节会莫名跳过风险确认。
        setImportFeedback({
          message: '已从本地库删除，但浏览器未能清除该包的同源授权记录。',
          hint: '请在本站的站点数据中手动清除后重新导入。',
          diagnostics: [],
        });
      }
      localLibrary.reload();
    } catch (error) {
      // 对话框靠"promise 是否 resolve"判断是否关闭；这里必须吞掉异常并把原因
      // 写进 importFeedback，否则调用点会变成未处理 rejection，用户看不到任何反馈。
      setImportFeedback({
        message: error instanceof Error ? error.message : '删除失败，请重试。',
        hint: '本地库可能不可写（例如浏览器拒绝了存储访问）。',
        diagnostics: [],
      });
    } finally {
      setBusyDigest(null);
    }
  }, [localLibrary, webPackageRef, setWebPackageRef]);

  return {
    disabled: disabled || isGenerating,
    active: reportFormat === 'web',
    selected,
    presets,
    library,
    importFeedback,
    downloadError,
    importing,
    downloading,
    busyDigest,
    saveImportedToLibrary: preferences.saveImportedWebPackages,
    capabilities: {
      importLocal: allowLocalImport,
      downloadPreset: true,
      remove: true,
      replace: true,
      manageLibrary: allowLocalImport,
    },
    actions: {
      select,
      remove,
      downloadPreset,
      downloadFromLibrary,
      importFile,
      removeFromLibrary,
      setSaveImportedToLibrary: (next: boolean) => setPreference('saveImportedWebPackages', next),
    },
  };
};
