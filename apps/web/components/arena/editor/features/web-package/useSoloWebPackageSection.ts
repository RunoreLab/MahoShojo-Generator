'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import type { WebPackageRef } from '@mahoshojo/contracts/web-package';
import {
  BUILTIN_WEB_PACKAGE_PRESETS,
  isBuiltinWebPackageRef,
  listStagedLocalWebPackages,
  WebPackageImportError,
} from '@mahoshojo/web-package';

import { useBattleStore } from '../../../stores/useBattleStore';
import type { BattleStoreState } from '../../../types';
import {
  hydrateWebPackageSessionFromCache,
  importLocalWebPackageArchive,
} from '@/lib/web-package/cache';
import { useWebPackagePresetDownload } from './useWebPackagePresetDownload';

import type {
  ArenaWebPackageImportFeedback,
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
  const [importFeedback, setImportFeedback] = useState<ArenaWebPackageImportFeedback | null>(null);
  const { downloading, downloadError, downloadPreset } = useWebPackagePresetDownload();

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
    const locals = allowLocalImport ? localOptions() : [];
    // Same canonical identity may appear as both a preset and a re-imported local ZIP.
    const seen = new Set(builtins.map((option) => option.digest));
    return [...builtins, ...locals.filter((option) => !seen.has(option.digest))];
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
    const local = listStagedLocalWebPackages().find((item) => item.ref.digest === digest);
    if (local) setWebPackageRef(local.ref);
  }, [allowLocalImport, setWebPackageRef]);

  const remove = useCallback(() => {
    setWebPackageRef(null);
  }, [setWebPackageRef]);

  const importFile = useCallback(async (file: File | null | undefined) => {
    if (!file || importing) return;
    setImporting(true);
    setImportFeedback(null);
    try {
      const { pkg, diagnostics } = await importLocalWebPackageArchive(new Uint8Array(await file.arrayBuffer()));
      refreshLocal();
      setWebPackageRef(pkg.ref);
      setImportFeedback({ message: '', hint: '', diagnostics });
    } catch (error) {
      setImportFeedback({
        message: error instanceof Error ? error.message : 'Web 包导入失败',
        hint: error instanceof WebPackageImportError ? error.hint : '请确认选择的是有效的 Web 包 ZIP 后重试。',
        diagnostics: [],
      });
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
    importFeedback,
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
