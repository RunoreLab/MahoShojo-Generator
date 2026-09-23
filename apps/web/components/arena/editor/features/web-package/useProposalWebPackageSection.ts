'use client';

import { useCallback, useMemo } from 'react';

import {
  BUILTIN_WEB_PACKAGE_PRESETS,
  findBuiltinWebPackagePreset,
  isBuiltinWebPackageRef,
} from '@mahoshojo/web-package';

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

  const downloadPreset = useCallback(async () => {
    // Proposal 不承担预设下载；下载入口保留在单人 editor。
  }, []);

  const importFile = useCallback(async () => {
    onActionError('多人模式不支持导入本地 Web 包');
  }, [onActionError]);

  return {
    disabled,
    active: reportFormat === 'web',
    selected,
    options,
    localSummary: null,
    importError: null,
    downloadError: null,
    importing: false,
    downloading: false,
    capabilities: {
      importLocal: false,
      downloadPreset: false,
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
