'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import type { WebPackageRef } from '@mahoshojo/contracts/web-package';
import {
  BUILTIN_WEB_PACKAGE_PRESETS,
  isBuiltinWebPackageRef,
  listStagedLocalWebPackages,
  packWebPackageZip,
  resolveWebPackage,
  unstageLocalWebPackage,
} from '@mahoshojo/web-package';

import { useBattleStore } from '../../../stores/useBattleStore';
import type { BattleStoreState } from '../../../types';
import {
  deleteWebPackageArchiveCache,
  hydrateWebPackageSessionFromCache,
  importLocalWebPackageArchive,
} from '@/lib/web-package/cache';
import { downloadBlob } from '@/lib/client/blobUrl';
import { buildSafeFileName } from '@/lib/client/fileName';

import type {
  ArenaWebPackageOptionView,
  ArenaWebPackageSectionModel,
} from './web-package-contract';

const localOptions = (): readonly ArenaWebPackageOptionView[] =>
  listStagedLocalWebPackages().map((pkg) => ({
    digest: pkg.ref.digest,
    title: pkg.manifest.name,
    kind: 'local' as const,
    ref: pkg.ref,
    summary: `${pkg.ref.id}@${pkg.ref.version}`,
  }));

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
 * 单人 Web 包区块 adapter：battle store + 本地 staging/cache。
 * 非 builtin 不进入多人 shared config；此处仍允许单人选择与导入。
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

  const [hydrated, setHydrated] = useState(false);
  const [localTick, setLocalTick] = useState(0);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void hydrateWebPackageSessionFromCache().then(() => {
      if (!active) return;
      setHydrated(true);
      setLocalTick((tick) => tick + 1);
    });
    return () => { active = false; };
  }, []);

  const options = useMemo(() => {
    void localTick;
    void hydrated;
    const builtins = builtinOptions();
    return allowLocalImport ? [...builtins, ...localOptions()] : builtins;
  }, [allowLocalImport, hydrated, localTick]);

  const selected = allowLocalImport
    ? resolveSelected(webPackageRef, options)
    : webPackageRef && isBuiltinWebPackageRef(webPackageRef)
      ? resolveSelected(webPackageRef, options)
      : null;
  const localSummary = selected?.kind === 'local'
    ? `已加载本地 Web 包（${selected.title} · ${selected.summary ?? ''}）。缓存可能因清理站点数据或存储配额而消失，可重新导入。`
    : null;

  const refreshLocal = () => setLocalTick((tick) => tick + 1);

  const select = useCallback((digest: string | null) => {
    setImportError(null);
    setDownloadError(null);
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
      setImportError('多人模式仅支持内置 Web 包预设');
      return;
    }
    const local = listStagedLocalWebPackages().find((item) => item.ref.digest === digest);
    if (local) setWebPackageRef(local.ref);
  }, [allowLocalImport, setWebPackageRef]);

  const remove = useCallback(() => {
    const ref = useBattleStore.getState().webPackageRef;
    if (ref && !isBuiltinWebPackageRef(ref)) {
      unstageLocalWebPackage(ref);
      void deleteWebPackageArchiveCache(ref.digest);
      refreshLocal();
    }
    setWebPackageRef(null);
  }, [setWebPackageRef]);

  const downloadPreset = useCallback(async (digest: string) => {
    if (downloading) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      const preset = BUILTIN_WEB_PACKAGE_PRESETS.find((item) => item.packageRef.digest === digest);
      if (!preset) throw new Error('未找到预设');
      const base = await resolveWebPackage(preset.packageRef);
      const archive = await packWebPackageZip(base);
      downloadBlob(
        new Blob([archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength) as ArrayBuffer], { type: 'application/zip' }),
        buildSafeFileName(`${base.manifest.id}@${base.manifest.version}`, 'zip', 'mahoshojo-web-package'),
      );
    } catch {
      setDownloadError('Web 包下载失败，请稍后重试。');
    } finally {
      setDownloading(false);
    }
  }, [downloading]);

  const importFile = useCallback(async (file: File | null | undefined) => {
    if (!file || importing) return;
    setImporting(true);
    setImportError(null);
    try {
      const archive = new Uint8Array(await file.arrayBuffer());
      const pkg = await importLocalWebPackageArchive(archive);
      refreshLocal();
      setWebPackageRef(pkg.ref);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Web 包导入失败');
    } finally {
      setImporting(false);
    }
  }, [importing, setWebPackageRef]);

  return {
    disabled: disabled || isGenerating,
    active: reportFormat === 'web',
    selected,
    options,
    localSummary,
    importError,
    downloadError,
    importing,
    downloading,
    capabilities: {
      importLocal: allowLocalImport,
      downloadPreset: true,
      remove: true,
      replace: true,
    },
    actions: {
      select,
      remove,
      downloadPreset,
      importFile,
    },
  };
};
