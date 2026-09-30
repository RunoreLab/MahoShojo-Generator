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
  const [localLibraryError, setLocalLibraryError] = useState<string | null>(null);
  const [missingArchives, setMissingArchives] = useState<ReadonlySet<string>>(new Set());
  const { preferences, setPreference } = useLocalLibraryPreferences();
  const localLibrary = useLocalWebPackages(allowLocalImport);
  const { downloadingDigest, downloadError, downloadPreset } = useWebPackagePresetDownload();
  const { reload: reloadLocalLibraryList } = localLibrary;

  /**
   * 挂载期恢复：一次性把旧缓存搬进本地库，再从本地库水合会话暂存。
   *
   * 抽成 callback 而不是只写在挂载 effect 里，是因为失败后的恢复入口必须重跑
   * **同一段逻辑**：只重读列表的话，一次迁移失败就被当成"已经好了"抹掉，而那次
   * 迁移要等到下次整页加载才重试——用户看到的是"读出来了"，实际数据还缺着。
   */
  const runMountRecovery = useCallback(async (): Promise<void> => {
    // 读不到旧库时迁移返回 drained=false，此时不得标记完成——
    // 否则用户会同时失去旧数据和迁移机会。
    if (!(await hasCompletedLegacyWebPackageMigration())) {
      const outcome = await migrateLegacyWebPackageCache(
        readAllWebPackageArchiveCache,
        drainWebPackageArchiveCache,
      );
      if (outcome.drained) await markLegacyWebPackageMigrationCompleted();
    }
    await hydrateWebPackageSessionFromLibrary();
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        await runMountRecovery();
      } catch (error) {
        // 迁移与水合都在 IndexedDB 上跑：隐私模式或存储被拒时会 reject。不接住就是
        // unhandled rejection，用户看不到任何提示，只会觉得"本地库自己空了"。
        if (!active) return;
        setLocalLibraryError(error instanceof Error ? error.message : '本地库读取失败');
        return;
      }
      if (!active) return;
      setStagedTick((tick) => tick + 1);
      reloadLocalLibraryList();
    })();
    return () => { active = false; };
    // 恢复逻辑只应发生一次；reloadLocalLibraryList 是稳定的 useCallback，不进依赖。
  }, [runMountRecovery, reloadLocalLibraryList]);

  // 列表读取失败时 useLocalWebPackages 已经有 status/error，但区块此前从不读它：
  // 读不出来和"本来就没有"在界面上都是同一句"还没有本地 Web 包"，用户会以为包没了。
  // 挂载期与探测期的失败都是一次性的，恢复途径是刷新，因此不做自动清除：
  // 存储真的不可用时，那条提示本来就该一直挂着。
  const libraryError = localLibrary.status === 'error'
    ? localLibrary.error ?? '本地库读取失败，请重试。'
    : localLibraryError;

  const presets = useMemo(() => builtinOptions(), []);

  // 记录在但 ZIP 字节不在时必须点名：否则用户点下去才发现这个包用不了。
  useEffect(() => {
    if (!allowLocalImport) return;
    let active = true;
    void (async () => {
      let stored: Set<string>;
      try {
        stored = await getLocalWebPackageRepository().listArchiveDigests();
      } catch (error) {
        // 探测失败时不能把全部记录标成"文件已缺失"——那是误导；如实说探测没做成。
        if (!active) return;
        setLocalLibraryError(error instanceof Error ? error.message : '本地库完整性探测失败');
        return;
      }
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
    setImportFeedback(null);
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
    } catch (error) {
      // 预设下载走 useWebPackagePresetDownload 的兜底；本地库下载原来没有任何
      // catch，字节缺失之外的打包/存储失败会变成未处理 rejection，界面上毫无反应。
      setImportFeedback({
        message: error instanceof Error ? error.message : 'Web 包下载失败，请稍后重试。',
        hint: '本地库可能不可读（例如浏览器拒绝了存储访问）。',
        diagnostics: [],
      });
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

  // 挂载期的迁移/水合失败此前没有任何原地恢复入口，只能让用户刷新页面。
  // 必须重跑同一段恢复逻辑，而不是清掉错误就宣称读出来了：一次迁移失败被抹掉后，
  // 那次迁移要等到下次整页加载才重试，期间用户看到的是"库里是空的"。
  const reloadLibrary = useCallback(() => {
    void (async () => {
      try {
        await runMountRecovery();
      } catch (error) {
        setLocalLibraryError(error instanceof Error ? error.message : '本地库读取失败');
        return;
      }
      setLocalLibraryError(null);
      setMissingArchives(new Set());
      setStagedTick((tick) => tick + 1);
      reloadLocalLibraryList();
    })();
  }, [runMountRecovery, reloadLocalLibraryList]);

  return {
    disabled: disabled || isGenerating,
    active: reportFormat === 'web',
    selected,
    presets,
    library,
    importFeedback,
    downloadError,
    // 列表读失败与导出失败走不同通道：前者必须能改写"还没有本地 Web 包"这句提示，
    // 后者不能——库里确实有包，只是这一次没导出来。
    libraryError,
    importing,
    downloadingDigest,
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
      reloadLibrary,
    },
  };
};
