'use client';

import { useCallback, useMemo } from 'react';

import {
  BUILTIN_WEB_PACKAGE_PRESETS,
  findBuiltinWebPackagePreset,
  isBuiltinWebPackageRef,
} from '@mahoshojo/web-package';

import { useWebPackagePresetDownload } from './useWebPackagePresetDownload';

import {
  useArenaEditorActions,
  useArenaEditorSelector,
  useArenaEditorSession,
} from '../../context';
import type { ArenaWebPackageOptionView, ArenaWebPackageSectionModel } from './web-package-contract';

const builtinOptions = (): readonly ArenaWebPackageOptionView[] =>
  BUILTIN_WEB_PACKAGE_PRESETS.map((preset) => ({
    digest: preset.packageRef.digest,
    title: preset.title,
    kind: 'builtin' as const,
    ref: preset.packageRef,
    summary: preset.description,
  }));

/**
 * Proposal Web 包区块 adapter：仅暴露 builtin 预设；
 * 本地 ZIP 不进入 Room Shared Config / Proposal（规格 §17.2）。
 */
export const useProposalWebPackageSectionModel = (input: {
  disabled: boolean;
  onActionError(message: string): void;
}): ArenaWebPackageSectionModel => {
  const { downloadingDigest, downloadError, downloadPreset } = useWebPackagePresetDownload();
  const session = useArenaEditorSession();
  const reportFormat = useArenaEditorSelector((state) => state.reportFormat);
  const webPackageRef = useArenaEditorSelector((state) => state.webPackageRef);
  const actions = useArenaEditorActions();
  const { disabled, onActionError } = input;

  const options = useMemo(() => builtinOptions(), []);

  const selected = useMemo((): ArenaWebPackageOptionView | null => {
    if (!webPackageRef) return null;
    const match = options.find((option) => option.digest === webPackageRef.digest);
    if (match) return match;
    if (isBuiltinWebPackageRef(webPackageRef)) {
      const preset = findBuiltinWebPackagePreset(webPackageRef);
      if (preset) {
        return {
          digest: preset.packageRef.digest,
          title: preset.title,
          kind: 'builtin',
          ref: preset.packageRef,
          summary: preset.description,
        };
      }
    }
    // 本地或不可解析 ref 不应出现在提案中；呈现为自由 Web。
    return null;
  }, [webPackageRef, options]);

  const select = useCallback((digest: string | null) => {
    if (session.mode !== 'room-proposal') return;
    try {
      if (!digest) {
        actions.setWebPackageRef(null);
        return;
      }
      const preset = BUILTIN_WEB_PACKAGE_PRESETS.find((item) => item.packageRef.digest === digest);
      if (preset) {
        actions.setWebPackageRef(preset.packageRef);
        return;
      }
      onActionError('多人模式仅支持内置 Web 包预设');
    } catch {
      onActionError('该修改不满足房间安全配置约束');
    }
  }, [session.mode, actions, onActionError]);

  const remove = useCallback(() => {
    actions.setWebPackageRef(null);
  }, [actions]);

  const importFile = useCallback(async () => {
    onActionError('多人模式不支持导入本地 Web 包');
  }, [onActionError]);

  // 多人提案里不存在本地库：不暴露删除/导出，也不提供「保存到本地库」偏好。
  const rejectLibraryManagement = useCallback(async (): Promise<void> => {
    onActionError('多人模式不支持本地 Web 包管理');
  }, [onActionError]);
  const rejectSavePreference = useCallback((): void => {
    onActionError('多人模式不支持本地 Web 包管理');
  }, [onActionError]);

  return {
    disabled,
    active: reportFormat === 'web',
    selected,
    presets: options,
    library: [],
    importFeedback: null,
    downloadError,
    // 多人提案没有本地库，不存在列表读取失败。
    libraryError: null,
    importing: false,
    downloadingDigest,
    busyDigest: null,
    saveImportedToLibrary: false,
    capabilities: {
      importLocal: false,
      downloadPreset: true,
      remove: true,
      replace: true,
      manageLibrary: false,
    },
    actions: {
      select,
      remove,
      downloadPreset,
      downloadFromLibrary: rejectLibraryManagement,
      importFile,
      removeFromLibrary: rejectLibraryManagement,
      setSaveImportedToLibrary: rejectSavePreference,
      // 多人提案没有本地库，也就没有可重试的读取失败。
      reloadLibrary: () => {},
    },
  };
};
